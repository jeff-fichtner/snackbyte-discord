# Implementation Plan: Bot-REST Delivery Path

**Branch**: `003-bot-rest-delivery` | **Date**: 2026-06-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-bot-rest-delivery/spec.md`

## Summary

Add a second outbound delivery mechanism so a route can post into a channel **as the gateway
bot** (`mode='bot'`) alongside the existing channel-webhook path — selected entirely by the
target's recorded mode, with the routing engine, transforms, idempotency, audit, and
secrets-by-reference all reused unchanged. The work is almost entirely behind the existing
`DeliveryService` seam: the engine already calls `delivery.send(target, message)` without
inspecting `target.mode`, the repository's `getTarget` already loads `mode`/`channel_id`/
`guild_id`, the `DeliveryTarget` type already carries `mode: 'webhook' | 'bot'`, and the
`discord_targets` table's `mode` CHECK already permits `'bot'`. The feature turns the existing
single-mode `WebhookDeliveryService` into a mode-dispatching delivery service that routes
webhook-mode targets to the current path and bot-mode targets to a new bot-REST send using
discord.js's authenticated REST client, with transient-vs-permanent retry classing that follows the
webhook path's HTTP-status split (and refines it for the bot path's pre-call misconfiguration cases
— see research §3). The one genuinely new wiring concern — giving the delivery layer
access to the bot's REST client, which today lives only inside the bot-login block of `main.ts` —
is the subject of Phase 0 research.

## Technical Context

**Language/Version**: TypeScript (ESM, strict), Node 24 — unchanged from 001/002.

**Primary Dependencies**: No new runtime dependencies. Reuses `discord.js` (already a dependency;
this feature uses its `REST` client / `@discordjs/rest`, the same client family that registers
slash commands today), `express`, `pg`, `pino`. Vitest + Supertest for tests.

**Storage**: PostgreSQL (Supabase) via the existing repository. **No table-shape migration**: the
`discord_targets` table already has `mode IN ('webhook','bot')`, `guild_id`, and `channel_id`.
One additive migration hardens integrity — a CHECK that a bot-mode row has a `channel_id` and a
webhook-mode row has a `webhook_url_ref` — so an operator who half-configures a target gets a DB
rejection rather than a silent delivery failure. (This validation is optional polish; see
research; the runtime also validates per FR-002/FR-010.)

**Testing**: Vitest + Supertest. Unit: the mode-dispatching delivery service (webhook target →
webhook path unchanged; bot target → bot-REST send; permanent error recorded immediately /
transient error retried then recorded; bad/misconfigured target → permanent failure). Integration:
end-to-end through the engine with a fake delivery proving (a) a bot-mode route and a webhook-mode
route both fire for one event with independent outcomes, (b) idempotency on a bot-mode route, (c)
a permanent bot failure is isolated to its route and the inbound still acks.

**Target Platform**: Same single always-on Cloud Run service; no topology change. Bot-REST
delivery reuses the bot credential the always-on instance already holds.

**Performance Goals**: A matched event posts to a bot-mode channel within a few seconds (parity
with the webhook path). The bot-REST client uses discord.js's built-in per-bucket/global
rate-limit queue, so high fan-out to one channel is throttled centrally, not by ad-hoc sleeps.

**Constraints**: All Discord writes stay on the single chokepoint (Principle III) — the bot path
is added *inside* the delivery service, not as a parallel caller. Delivery mode is data
(`discord_targets.mode`), never event/source-derived (Principle I). Idempotency and the
`delivery_log` outcomes are reused unchanged (FR-007/FR-009). Secrets stay by-reference; the bot
token is config, never a row value (Principle VII).

**Scale/Scope**: One new delivery mode behind the existing interface; a handful of new/edited
source files (delivery service + its wiring in `main.ts`), one optional integrity migration, and
focused unit/integration tests. Low event volume.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

Evaluated against snackbyte-discord Constitution v1.0.0:

| Principle | Gate for this feature | Status |
|-----------|-----------------------|--------|
| I. Patterns Over Instances | The delivery mechanism is selected by `target.mode` (data), not by any source/event property; the engine and transforms never branch on mode. Adding the bot path is one new branch *inside the delivery service* keyed on the target's own mode field — the deliberate variation point, not a special case wired into core. | ✅ PASS |
| II. Verify Before Process | No inbound-verification change; this is purely an outbound mechanism. The bot path posts only already-routed, already-verified events. | ✅ PASS |
| III. Idempotent, Rate-Limited Delivery | Bot-REST delivery is added *behind* the single `DeliveryService` — the same chokepoint all Discord writes use (FR-006); no caller bypasses it. Idempotency is the engine's existing per-(route, dedupeKey) pre-check + partial unique index, untouched. Rate limits ride discord.js's built-in REST bucket queue; transient errors retry honoring `Retry-After`, permanent errors don't (the webhook path's existing model). | ✅ PASS |
| IV. Runtime-Mutable Routing, Compile-Time-Safe Logic | An operator switches a route's delivery path by editing rows only (repoint `target_id`, or a target's `mode`); no deploy (FR-011). The webhook-vs-bot send logic is typed, tested code. | ✅ PASS |
| V. Pinned, Typed, Tested + Speckit-in-Speckit | Node 24, strict TS, `check:all` stays green; shipped code states rules directly, cites no FR/spec/principle. | ✅ PASS |
| VI. Always-On Resilience | Liveness/readiness unchanged. A bot-mode delivery when the bot can't reach Discord degrades exactly like the webhook path: retry transient, then record `failed` while the inbound still acks. The bot login block in `main.ts` stays non-fatal. | ✅ PASS |
| VII. Secrets By Reference | The bot token is already config (`DISCORD_BOT_TOKEN`), resolved at runtime, never a row value or log line. Bot-mode target rows hold only `guild_id`/`channel_id` (non-secret identifiers) — no secret in a row. | ✅ PASS |

**One nuance to record (not a violation):** the delivery service gains a single internal branch on
`target.mode` (webhook path vs. bot path). This is the constitution's *intended* extension point —
Principle III explicitly names "webhook-URL path or bot-REST path" as the two mechanisms behind one
delivery service — not source-name branching in core. The engine and transforms remain entirely
mode-agnostic. This is the only place mode is read, and it reads the target's own data field.

**Result**: PASS — no violations, no Complexity Tracking entries required. (Re-checked after
Phase 1 below: still PASS.)

## Project Structure

### Documentation (this feature)

```text
specs/003-bot-rest-delivery/
├── plan.md              # This file
├── research.md          # Phase 0 output — how the delivery layer gets the bot REST client; retry/error mapping
├── data-model.md        # Phase 1 output — discord_targets bot-mode shape + integrity rule (no shape change)
├── quickstart.md        # Phase 1 output — configure a bot target, route to it, verify the post + outcomes
├── contracts/
│   └── delivery-service.md   # the DeliveryService contract: send(target,msg) dispatch by mode + failure classing
└── tasks.md             # /speckit-tasks output (not created here)
```

### Source Code (repository root)

Extends the existing tree. **New** files marked `NEW`; everything else is reused unchanged except
the precise edits noted. The delivery service is the single touch-point for the new mechanism.

```text
snackbyte-discord/
├── migrations/
│   └── 0005_targets_mode_integrity.sql   # NEW (optional polish): CHECK bot⇒channel_id, webhook⇒webhook_url_ref
├── src/
│   ├── discord/
│   │   ├── delivery.ts            # EDIT: dispatch send() by target.mode; webhook path unchanged; add bot-REST path
│   │   └── rest.ts                # NEW (if research picks the shared-REST approach): construct/hold the bot REST client
│   ├── main.ts                    # EDIT: construct the delivery service with the bot REST client and inject into context
│   └── routing/types.ts           # (no change — DeliveryTarget already has mode/channelId/guildId)
└── tests/
    ├── machinery/
    │   └── bot-delivery.test.ts    # NEW: mode dispatch; bot send happy; permanent-immediate vs transient-retry; bad target
    └── app/
        └── bot-delivery-engine.test.ts  # NEW: engine + fake delivery — dual-mode fan-out, idempotency, isolated failure
```

**Structure Decision**: Pure extension behind the existing delivery seam — no new top-level
structure. The engine (`routing/engine.ts`), repository (`db/*`), transforms, and routing types are
reused **unchanged**; their pre-existing mode-awareness (the `'bot'` enum value, the `channel_id`/
`guild_id` columns, the mode-agnostic `delivery.send` call) means this feature lands almost
entirely in `src/discord/delivery.ts` plus its construction in `main.ts`. The exact split between
`delivery.ts` and a possible `rest.ts` (where the bot REST client is built and how it reaches the
delivery service) is decided in Phase 0 research.

## Complexity Tracking

No constitution violations; no justifications required. (Table omitted.)
