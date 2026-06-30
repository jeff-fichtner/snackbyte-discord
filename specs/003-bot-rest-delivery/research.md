# Phase 0 Research: Bot-REST Delivery Path

This feature lands almost entirely behind the existing `DeliveryService` seam. The one genuine
design decision is **how the delivery layer obtains an authenticated bot REST client**, since the
gateway `Client` is constructed later and conditionally in `main.ts`. The rest is mechanical reuse.
Findings below; each is a local architecture decision grounded in the existing code, not new
external technology.

## 1. How the delivery service gets the bot's REST client

**Decision**: Construct a **standalone `REST` client** (discord.js's `REST` from `@discordjs/rest`,
already transitively present via discord.js) seeded with `DISCORD_BOT_TOKEN`, and pass it into the
delivery service at construction in `main.ts`. The delivery service holds an optional REST client;
when it is absent (no token configured), a bot-mode delivery records a permanent failure with a
clear reason, exactly as a misconfigured target would.

**Rationale**:
- Posting a channel message is a pure REST call (`POST /channels/{channelId}/messages`) and does
  **not** require the gateway WebSocket to be connected. Decoupling delivery from the gateway
  `Client` means a bot-mode delivery works even while the gateway is mid-reconnect — which is the
  correct behavior for the spec's "bot offline / gateway disconnected" edge case (treat as
  transient, retry, then record failure; never crash).
- The bot token is already loaded as config (`DISCORD_BOT_TOKEN`) and resolved once at boot. A
  standalone `REST` client reuses that one credential — no new secret, no second connection,
  honoring Secrets By Reference and the "reuse the existing credential" assumption in the spec.
- discord.js's `REST` client has the **built-in per-bucket and global rate-limit queue**. Routing
  bot writes through it satisfies Principle III's "respect Discord rate limits, honor `Retry-After`"
  with no hand-rolled bucket logic — the same managed client family that registers slash commands
  today.
- It keeps `main.ts`'s ordering intact: the delivery service is constructed before the gateway
  login block, and a standalone REST client can be built right there from config, independent of
  whether/when the gateway `Client.login()` succeeds.

**Alternatives considered**:
- **Reuse `client.rest` from the gateway `Client`.** Rejected: the `Client` is created *after* the
  delivery service and only inside the `if (config.discordBotToken)` block; threading it back into
  an already-injected delivery service forces lazy/mutable wiring and couples delivery to gateway
  lifecycle for no benefit (the REST call doesn't need the gateway). discord.js itself builds its
  internal REST from the same token, so a standalone client is equivalent for message posting.
- **Lazy injection (construct delivery, set REST on `ClientReady`).** Rejected: adds a mutable
  "rest client set later" state and a window where bot-mode delivery would fail purely on ordering;
  the standalone client is available immediately at boot with no such window.
- **Hand-rolled `fetch` to the Discord API with manual bucket handling.** Rejected: reimplements
  discord.js's rate-limit queue, the exact ad-hoc-bypass Principle III prohibits.

**Placement**: A small `src/discord/rest.ts` constructs and exports the bot `REST` client from the
token. There is already a working precedent for exactly this construction in `src/bot/deploy-commands.ts`
(`new REST({ version: '10' }).setToken(token)`, used to register slash commands) — `rest.ts` factors
that same construction out so both the command-registration path and the delivery path build the
client the same way. `main.ts` builds it from `config.discordBotToken` and passes it to the delivery
service. This keeps `delivery.ts` free of token/transport-construction concerns and unit-testable
with a fake REST client.

## 2. Webhook vs. bot dispatch inside the delivery service

**Decision**: Turn the current `WebhookDeliveryService` into a single delivery service whose
`send(target, msg)` switches on `target.mode`: `'webhook'` runs today's path unchanged; `'bot'`
runs the new bot-REST path. The interface (`DeliveryService.send`) and the engine's call site are
unchanged.

**Rationale**: The engine already calls `delivery.send(target, message)` with no knowledge of mode
(verified in `routing/engine.ts`); `DeliveryTarget` already carries `mode`/`channelId`/`guildId`.
The single internal branch on `target.mode` is the constitution's intended extension point
(Principle III names both paths behind one service), not source-name branching. One service, one
chokepoint, two mechanisms.

**Alternatives considered**:
- **Two services + a selector in the engine.** Rejected: pushes mode-awareness into the engine,
  violating "the engine never learns which mechanism a target uses" (FR-004) and Patterns Over
  Instances.
- **A registry of delivery modes (mirroring the source/transform registries).** Rejected as
  over-engineering for two fixed, security-relevant mechanisms; the constitution fixes the platform
  to exactly these two paths, and a registry would invite data-driven delivery logic that Principle
  IV warns against. Revisit only if a third mechanism appears.

## 3. Mapping Discord REST outcomes to transient vs. permanent (the clarified retry policy)

**Decision**: Reuse the webhook path's classification, mapped onto discord.js REST errors:
- **Transient (retry with backoff, honor `Retry-After`)**: HTTP 429 (rate limited — discord.js's
  REST queue largely handles this itself), 5xx, and network/timeout errors (gateway/bot unable to
  reach Discord).
- **Permanent (record immediately, no retry)**: 403 (missing permission), 404 (unknown channel),
  401 (bad/again-revoked token), and any target-misconfiguration detected before the call (bot-mode
  target with no `channelId`, or no REST client available). These surface as a recorded `failed`
  delivery with an operator-actionable reason.

**Rationale**: This mirrors the webhook path's `429/5xx ⇒ retry, other 4xx ⇒ permanent` HTTP-status
split (see `delivery.ts`) and matches the spec clarification (transient retried; permanent —
missing permission / unknown channel / bot not in guild / misconfiguration — recorded at once).
discord.js raises a typed `DiscordAPIError` carrying the HTTP status and a Discord error code,
which the bot path inspects to classify; `HTTPError`/network failures are treated transient.

**One deliberate refinement, not literal parity**: the existing `WebhookDeliveryService` `catch`
block retries *thrown/network* errors unconditionally up to `MAX_ATTEMPTS`, and it has no
pre-call misconfiguration concept (a webhook target's only addressing is its URL ref, checked
once). The bot path is intentionally *stricter*: pre-call misconfiguration (no `channelId`, no REST
client) and the permanent HTTP statuses (403/404/401) throw immediately with **no** retry, because
retrying them cannot succeed and only delays the operator-actionable record. So the bot path shares
the webhook path's HTTP-status split and `MAX_ATTEMPTS`/backoff bound, but is a refinement of — not
a byte-for-byte copy of — `sendWebhook`'s error handling. Tests must assert the bot path's
per-class behavior, not parity with `sendWebhook`'s unconditional network-error retry.

**Alternatives considered**:
- **Retry everything uniformly.** Rejected by the clarification — wastes attempts and delays the
  operator-actionable record on permanent errors.
- **Let discord.js's REST retry handle it and never classify.** Rejected: discord.js retries
  rate-limits but surfaces 4xx as errors; without our classing, a 403 (permanent) would be recorded
  the same as an exhausted-retry transient, losing the "recorded immediately" guarantee and
  conflating the diagnosable reason.

## 4. Reuse audit, idempotency, and the message shape (no change)

**Decision**: No change to `delivery_log`, the idempotency pre-check + partial unique index, or the
`DiscordMessage` shape. The engine records `ok`/`failed`/`skipped`/`filtered` identically for
bot-mode deliveries because it already does so mode-agnostically (the `delivery.send` call is the
only mode-specific step, and it throws on failure exactly like the webhook path so the engine's
existing `catch → recordDelivery('failed')` applies).

**Rationale**: FR-007/FR-009 require identical idempotency and outcomes regardless of mode. The
engine already provides this; the bot path only needs to *throw on permanent/exhausted failure and
return on success*, matching the `WebhookDeliveryService` contract. The `DiscordMessage` fields
(`content`, `embeds`) map directly to the REST create-message body; webhook-only cosmetic fields
(`username`, `avatarUrl`) are simply ignored on the bot path (a bot posts under its own identity by
definition), which is correct and needs no new transform (FR-005).

**Alternatives considered**:
- **A `delivery_log.mode` column.** Rejected: not required by any FR; `target_id` already
  identifies the target (and thus its mode) for diagnosis. Out of scope; revisit only if operators
  need mode-filtered audit queries.

## 5. Target integrity: require channel_id for bot, webhook_url_ref for webhook

**Decision**: Add one **optional, additive** migration `0005_targets_mode_integrity.sql` with a
table CHECK: a `mode='bot'` row must have a non-null `channel_id`; a `mode='webhook'` row must have
a non-null `webhook_url_ref`. The runtime *also* validates (FR-010 records a permanent failure for
a misconfigured target), so the migration is defense-in-depth, not the sole guard.

**Rationale**: The `discord_targets` table comment already says "channel_id required when mode='bot'"
and "webhook_url_ref required when mode='webhook'" but never enforced it. Enforcing it at the DB
turns an operator's half-configured row into an immediate, obvious rejection in the table editor
rather than a delivery-time failure. It is additive (a CHECK constraint), runs once via the
existing migration ledger, and does not alter existing valid rows.

**Alternatives considered**:
- **Runtime validation only (no migration).** Acceptable and the feature works without the
  migration; the runtime already classes a missing `channelId` as a permanent failure. Kept the
  migration as low-cost polish that improves the operator experience, but it can be dropped from
  scope without affecting correctness — `/speckit-tasks` should mark it the lowest-priority,
  independently-droppable task.
- **Application-level target validation on write.** Rejected: there is no app write path for
  targets (operators edit rows directly in the table editor), so a DB CHECK is the only place that
  catches it at edit time.

## Resolved unknowns

All Technical Context items are resolved; no `NEEDS CLARIFICATION` remain. The retry-bound that the
spec deferred to planning is inherited verbatim from the webhook path (`MAX_ATTEMPTS = 4`,
exponential backoff honoring `Retry-After`) — the bot path uses the same bound for symmetry.
