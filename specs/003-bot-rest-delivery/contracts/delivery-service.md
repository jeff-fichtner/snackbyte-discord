# Contract: DeliveryService (mode-dispatching)

The internal interface between the routing engine and Discord. This feature extends the existing
`DeliveryService` so one service handles both delivery mechanisms, selected by the target's mode.
The engine's call site and the interface signature are **unchanged**; only the implementation
behind `send` gains a bot path.

## Interface (unchanged signature)

```ts
// src/discord/delivery.ts
interface DiscordMessage {
  content?: string;
  embeds?: unknown[];
  username?: string;   // webhook-mode cosmetic; IGNORED on bot path (bot posts as itself)
  avatarUrl?: string;  // webhook-mode cosmetic; IGNORED on bot path
}

interface DeliveryService {
  send(target: DeliveryTarget, msg: DiscordMessage): Promise<void>;
}
```

- The engine calls `delivery.send(target, message)` with **no awareness of mode** (it does not read
  `target.mode`). This call site does not change.
- `send` **returns** on success and **throws** on permanent failure or exhausted transient retries.
  The engine's existing `try/catch` records `ok` on return and `failed` (with the thrown reason) on
  throw — identical for both modes.

## Dispatch behavior

`send` selects the mechanism by `target.mode`:

| `target.mode` | Mechanism | Addressing | Behavior |
|---------------|-----------|------------|----------|
| `'webhook'`   | POST to channel webhook URL (today's path) | `webhookUrlRef` → resolved secret | **Unchanged** from current implementation |
| `'bot'`       | discord.js `REST` → `POST /channels/{channelId}/messages` | `channelId` (required); bot token from config | **New** — posts as the bot |

A target with an unrecognized mode, or whose required addressing for its mode is missing, is a
**permanent failure** (throws immediately; no retry).

## Bot-path send (`mode='bot'`)

1. **Preconditions (permanent failure if unmet, no retry):**
   - a bot REST client is available (constructed from `DISCORD_BOT_TOKEN`); if absent → throw
     "bot delivery unavailable: no bot token configured".
   - `target.channelId` is present; if absent → throw "bot target {id} has no channel_id".
2. **Build the create-message body** from `DiscordMessage`: `{ content, embeds }`. `username`/
   `avatarUrl` are ignored (the bot posts under its own identity).
3. **POST** `channels/{channelId}/messages` via the discord.js `REST` client (its built-in
   per-bucket/global rate-limit queue applies — no ad-hoc throttling).
4. **On success** (2xx): return.
5. **On failure**, classify (research §3):
   - **Transient** — HTTP 429, 5xx, or network/timeout: retry with backoff honoring `Retry-After`,
     same bound as the webhook path (`MAX_ATTEMPTS = 4`, `2**attempt * 250ms` fallback). After the
     last attempt, throw → recorded `failed`.
   - **Permanent** — 403 (missing permission), 404 (unknown channel), 401 (bad token), or a target
     misconfiguration detected before the call: throw **immediately**, no retry → recorded `failed`
     with an operator-actionable reason.

## Construction & wiring

- A bot `REST` client is built once at boot from `config.discordBotToken` (research §1), in
  `src/discord/rest.ts`, and passed into the delivery service constructor in `main.ts`.
- When no bot token is configured, the delivery service still constructs (webhook deliveries keep
  working); bot-mode deliveries then fail permanently with the clear "no bot token" reason — the
  same graceful-degradation posture the bootstrap already uses (DB down / bot offline are non-fatal).

## Invariants (verifiable)

- **Single chokepoint**: bot-mode delivery happens only inside `DeliveryService.send`; no other code
  posts to Discord (Principle III). No new caller of the Discord API is introduced outside this
  service and the slash-command registration path that already exists.
- **Mode-agnostic engine**: the engine and transforms never read `target.mode`; removing the bot
  branch would change *only* `delivery.ts`.
- **Idempotency unchanged**: a duplicate (route, dedupeKey) is short-circuited to `skipped` by the
  engine's pre-check before `send` is ever called — independent of mode.
- **Outcome parity**: a bot-mode delivery records exactly one of `ok`/`failed`/`skipped`/`filtered`,
  the same set as webhook-mode.
