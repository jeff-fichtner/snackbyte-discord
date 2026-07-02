# Architecture Document — Discord Integration Hub (forward-looking)

> ⚠️ **TEMPORARY — shrinking toward deletion.** This file began as the full pre-spec design
> input for the hub. **As each piece of work is spec'd and built, its content is deleted from
> here** — the durable record lives in the per-feature specs (`specs/NNN-*/`), the operations
> runbook (`docs/OPERATIONS.md`), and the constitution (`.specify/memory/constitution.md`). This
> is not a changelog: shipped work is removed, never marked "done." What remains is only the
> **not-yet-built** roadmap and the cross-cutting context a future spec needs. When nothing
> forward-looking is left, delete this file.

**Project:** `snackbyte-discord` — a Discord integration hub (inbound webhooks, outbound posts,
and a gateway bot). Discord-centric by design; a future Slack/other-platform hub would be a
separate codebase (e.g. `snackbyte-slack`), sharing only the generic canonical-event + routing
core.

**Governed by:** the standalone **snackbyte-discord Constitution v1.0.0**
(`.specify/memory/constitution.md`).

---

## 1. Goal & framing (carried into every phase)

The hub's reason for existing is **cheap extension**: adding the next inbound source, bot
command/interaction, or route must be near-zero effort. The architecture's job is to keep that
true as the hub grows. Governing principles (full text in the constitution): patterns over
instances; verify before process; idempotent, rate-limited delivery through one chokepoint;
runtime-mutable routing vs. compile-time-safe logic; always-on resilience; secrets by reference.

These patterns already exist as working code (source-adapter registry, canonical event, routing
table + engine, single delivery service, command/event registries, liveness/readiness split).
Future work extends the _instances_, not the patterns.

---

## 2. The bot's interaction surface is an extension axis (future bot-depth design)

The slash-command path exists, and the capability/adapter split is now proven in code (the
self-service role/nickname capabilities live in `src/bot/members/`, invoked by thin slash-command
adapters). The hub must still expose those capabilities through **other** Discord interaction styles
— text-prefix commands (`!role`), message components (buttons / selects), context menus, modals, and
reaction-driven actions — and stay open to styles Discord adds later. Interaction style is a
**pluggable axis**, the same way inbound sources are: one capability (e.g. self-assign a role) can be
offered through several styles at once, all delegating to the one shared piece of logic.

The bot layers a small set of **interaction-handler registries** over the gateway, one per
style, each populated by drop-in self-registering modules and dispatched generically:

- slash / chat-input commands → dispatched from `interactionCreate`
- text-prefix commands → dispatched from `messageCreate` (requires the privileged Message
  Content intent, so this style stays **optional and isolated** — the bot boots and all other
  styles work with it OFF)
- message components (buttons, selects) → dispatched from `interactionCreate` by `customId`
- context-menu commands (user / message) → registered alongside slash commands
- modals → dispatched from `interactionCreate` by `customId`
- reaction actions → dispatched from `messageReactionAdd` / `messageReactionRemove`

The shared rule (Principle I): **a capability is logic; an interaction style is an adapter onto
that logic.** Adding a style = one registry + one dispatch binding; adding a capability = one
module registered under whichever style(s) should expose it. Core never enumerates styles or
capabilities in a switch statement.

---

## 3. Non-functional constraints that bind future phases

- **Always-on:** the gateway connection requires `min-instances=1` in production; liveness must
  stay independent of downstream (Discord/DB) health. (Staging runs `min-instances=0`, toggled
  on for test sessions — see `docs/OPERATIONS.md`.)
- **Security:** signature verification mandatory before parsing; least-privilege intents
  (Message Content opt-in and isolated); secrets by reference, never in git/rows/logs.
- **Reliability / degradation:** Discord down → deliveries retry/backoff then record `failed`,
  inbound still acks; DB down → routing fails closed (`503`, sender retries) while DB-free bot
  commands keep working; gateway auto-reconnects; a crash restarts cleanly.
- **Idempotency:** duplicate deliveries must not double-post (enforced per route+event).

These already hold in the built core; new features must preserve them.

---

## 4. Phasing / Roadmap (remaining)

**Phase 2 — Breadth (remaining).** **Admin/diagnostics endpoint(s)** beyond the Supabase table
editor (inspect routes, view/replay `delivery_log`, and an in-Discord operator command to curate
the self-assignable-role whitelist).

**Phase 3 — Bot depth, remaining (BED-BOT parity is a requirement, not an example).** Core parity —
self-assignable roles, the assignable-role list, self-service nicknames, and the operator-editable
whitelist safety model — is built. What remains in this phase, exposed through the interaction-handler
registries (§2) over the shared capability logic already in place:

- **reaction-roles** (assign a role by reacting) and other interaction styles (buttons / selects,
  text-prefix) over the existing role/nickname capabilities;
- **moderation** (requires the privileged Message Content intent — opt-in and isolated), including
  growing `/nick` to nickname *other* members (the piece Discord's built-in `/nick` can't do);
- **`bot_state`/kv** for free-form per-guild config, and **scheduled jobs** reusing the delivery
  service.

**Phase 4 — Hardening/ops.** Retry/backoff tuning, a metrics endpoint, delivery-log
retention/pruning, alerting on repeated `failed`, a secret-rotation runbook, and a richer admin
UI if the table editor outgrows its role. (A durable store-and-forward **outbox** to close the
acknowledge-then-deliver crash window — the known trade-off in the current in-process delivery —
belongs here.)

**Phase 5 (known evolution, not committed) — Service split.** If volume/scaling demands, split
into two Cloud Run services (router + bot) over the same core + DB. The seam is pre-drawn (core
depends on neither face), so it's two thin entrypoints, not a rewrite.

---

## 5. Open questions still live for future specs

(Open questions already resolved are recorded in their feature's `specs/NNN-*/`. These remain
unresolved and relevant to later phases.)

1. **Durable outbox?** Whether to add a DB-backed outbox so Discord downtime / a crash between
   ack and delivery can't lose an event (currently acknowledge-then-deliver in-process). Affects
   `delivery_log` (a `pending`/retry-count column). Phase 4.
2. **Multiple secrets per source.** The hub uses one signing secret per source slug
   (`sources.secret_ref`). Supporting many webhooks per source (e.g. several ClickUp workspaces),
   each with its own secret, needs per-webhook source rows or a secret-per-webhook lookup.
3. **Route lookup caching.** Per-event DB read (always fresh, "edit a row → instant") vs. a TTL
   cache (faster under load) — revisit if inbound volume grows.
4. **Admin surface boundary.** When the Supabase table editor stops being a sufficient admin UI
   and a purpose-built authenticated admin endpoint/UI is warranted.
5. **Separate Discord application per environment.** Prod and staging currently can share one bot
   app; cleaner isolation is a distinct app per environment so staging can't post to prod
   channels or collide on command registration.

---

## ⚠️ TODO before this file is deleted — rotate all setup-exposed tokens

During the live setup/e2e session, several real credentials passed through the working
session (e.g. when saving `.env`). Rotate ALL of them, then update the running services via
`./scripts/set-secrets.sh prod` (and `staging`). Treat every secret touched during setup as
exposed:

- **Discord bot token** — Developer Portal → Bot → Reset Token (instantly invalidates the old
  one), then update `.env` + push to Cloud Run.
- **ClickUp API token** — the personal token used to create the webhook; revoke it in ClickUp
  (it was a one-time setup tool, not needed at runtime).
- **ClickUp webhook signing secret** — rotate if you want a clean baseline (recreate the
  webhook to get a fresh secret, then update `CLICKUP_WEBHOOK_SECRET`).
- **Discord channel webhook URL** (`DEMO_CHANNEL_WEBHOOK`) — regenerate the channel webhook if
  treating it as exposed.
- **Supabase** — rotate the database password (and any service key) if it was handled during
  setup; update `DATABASE_URL`.

Once rotated and re-pushed, confirm `/api/ready` is `ready: true` on each environment.
