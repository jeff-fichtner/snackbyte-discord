# Implementation Plan: Walking Skeleton — first end-to-end slice of the Discord hub

**Branch**: `001-walking-skeleton` | **Date**: 2026-06-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-walking-skeleton/spec.md`

## Summary

Build the thinnest end-to-end slice that exercises every architectural seam of the Discord
integration hub once: a verified inbound webhook from one source (ClickUp) is normalized into
a canonical event, matched against runtime-editable routes in a database, formatted, delivered
to a Discord channel through a single delivery path (de-duplicated per route, outcome
recorded), all behind a fast acknowledgement; plus an always-on bot that logs in over the
gateway, answers one slash command, and observes one server event. The service runs as one
always-on process (Express webhook router + discord.js gateway bot) started by a unified
bootstrap, deployed as a single Cloud Run service. Technical approach is fixed by
`ARCHITECTURE.md` and the project constitution; this slice implements the smallest concrete
instance of each pattern (one source adapter, one transform, one slash command, one event
handler) so that adding the next of each is cheap.

## Technical Context

**Language/Version**: TypeScript (ESM, strict), Node 24 LTS (pinned via `.nvmrc`).

**Primary Dependencies**: Express 5 (already present, webhook router + health), `discord.js`
(gateway bot + REST delivery), `pino` (structured logging), `pg` (PostgreSQL client behind a
repository interface). Dev/test toolchain already present: Vitest, Supertest, ESLint, Prettier,
tsx, Vite.

**Storage**: PostgreSQL (Supabase free tier in deployment) accessed through a thin repository
interface so the backend is swappable; SQL migrations under `migrations/`. Tables:
`sources`, `discord_targets`, `routes`, `delivery_log`.

**Testing**: Vitest + Supertest. Integration tests under `tests/app/` exercise the webhook
endpoint via `createApp()`; unit tests under `tests/machinery/` cover the ClickUp adapter
(verify + parse), the routing engine (matching + idempotency), the registries, and the default
transform. Repository is exercised against a test database or an in-memory/fake implementation
of the repository interface for unit tests.

**Target Platform**: Linux container on Google Cloud Run, single always-on service
(`min-instances=1`); the bot's gateway connection requires the instance to stay warm.

**Project Type**: Web service (HTTP webhook router) + long-lived gateway client, one process.
Spun up from `snackbyte-base` in `server` mode; the React frontend is incidental (not used by
this feature beyond the existing health/version surface).

**Performance Goals**: Inbound request acknowledged within a couple of seconds under normal
conditions (verify + fast 2xx, then async delivery); a matched event appears in Discord within
a few seconds (SC-002); bot command reply within a couple of seconds (SC-005). Route lookup is
a single indexed query.

**Constraints**: Always-on; liveness independent of downstream health (FR-020); secrets by
reference, never in source/rows/logs (FR-022/023); all Discord writes through one delivery path
respecting rate limits (FR-011/012); raw request body preserved for signature verification on
webhook routes only.

**Scale/Scope**: One external source (ClickUp), one Discord server, one delivery style
(channel-webhook URL), one slash command, one event handler. Low event volume (operational
notifications), not a high-throughput pipeline.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

Evaluated against snackbyte-discord Constitution v1.0.0 (7 principles):

| Principle | Gate for this feature | Status |
|-----------|-----------------------|--------|
| I. Patterns Over Instances | Source = adapter implementing a shared contract + registry; slash command + event handler are self-registering modules dispatched generically; one transform via a transform registry. Core never names "clickup". Adding the next source/command is one module + one registration. | ✅ PASS |
| II. Verify Before Process | ClickUp adapter verifies HMAC (constant-time) against a configured secret before any parse/route; raw body preserved on webhook routes; failed verification → 401, no dispatch (FR-002/003). Least-privilege intents; Message Content NOT required by this slice (slash command + member-join only). | ✅ PASS |
| III. Idempotent, Rate-Limited Delivery | All Discord writes go through one delivery service; per-(route,event) dedupe via a unique constraint + pre-check; delivery service handles 429/5xx backoff + `Retry-After` (FR-011/012/013). | ✅ PASS |
| IV. Runtime-Mutable Routing, Compile-Time-Safe Logic | Routing (`sources`/`discord_targets`/`routes`) in DB, operator-editable, no deploy (FR-007); verify/parse/transform/command logic in typed, tested code; secrets not stored in rows (FR-022). | ✅ PASS |
| V. Pinned, Typed, Tested + Speckit-in-Speckit | Node 24, strict TS, `check:all` gate stays green; shipped `src/`/`tests/` use named rules, never cite FRs/specs/principles; spec scaffolding stays in `specs/`. | ✅ PASS |
| VI. Always-On Resilience | Liveness always-200 while process up, independent of Discord/DB (FR-020); readiness separate (FR-021); Discord-down → retry then record failed, inbound still acked; DB-down → fail closed so sender retries, DB-free bot command still works (FR-019); gateway auto-reconnects. | ✅ PASS |
| VII. Secrets By Reference | Bot token, ClickUp signing secret, Discord channel webhook URL all from env/secret manager; DB rows hold reference names (`secret_ref`, `webhook_url_ref`), not values; logs redact secrets + full payloads (FR-022/023). | ✅ PASS |

**Result**: PASS — no violations, no Complexity Tracking entries required. (Re-check after
Phase 1 below.)

## Project Structure

### Documentation (this feature)

```text
specs/001-walking-skeleton/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── inbound-webhook.md     # POST /webhooks/:source contract
│   ├── health-readiness.md    # GET /api/health, GET /api/ready contract
│   └── bot-interactions.md    # /ping slash command + guildMemberAdd handler
└── tasks.md             # Phase 2 output (/speckit-tasks command — NOT created here)
```

### Source Code (repository root)

Extends the existing `snackbyte-base` (server-mode) skeleton. Today the repo has
`src/server.ts` (exports `createApp()`, listens when run as main), `src/config.ts`,
`src/routes/{index,health,version}.ts`, and `src/web/*`. This feature adds the hub modules and
moves process startup into a unified bootstrap. The four ★ folders are the extension points,
each with an `index.ts` as the single registration site.

```text
snackbyte-discord/
├── migrations/
│   └── 0001_init.sql              # sources, discord_targets, routes, delivery_log
├── scripts/
│   ├── dev.mjs                    # existing; also runs the bootstrap (Express + bot)
│   └── deploy-commands.mjs        # register slash-command definitions with Discord
├── src/
│   ├── main.ts                    # ★ unified bootstrap: createApp().listen + bot login + lifecycle
│   ├── server.ts                  # existing createApp(); listen moves to main.ts (keep createApp export)
│   ├── config.ts                  # existing; extend (validated): bot token, app id, DATABASE_URL, secrets, LOG_LEVEL
│   ├── routes/
│   │   ├── index.ts               # existing registerRoutes(); add webhooks + readiness
│   │   ├── health.ts              # existing liveness
│   │   ├── ready.ts               # NEW readiness (DB reachable, gateway ready)
│   │   ├── version.ts             # existing
│   │   └── webhooks.ts            # NEW generic POST /webhooks/:source (raw body)
│   ├── core/
│   │   ├── logger.ts              # pino root + child loggers; secret/payload redaction
│   │   ├── errors.ts              # typed errors + central error middleware
│   │   └── lifecycle.ts           # graceful shutdown, readiness state
│   ├── db/
│   │   ├── client.ts              # pg pool from config
│   │   ├── repository.ts          # ★ Repository interface (storage-agnostic)
│   │   └── pg-repository.ts       # PostgreSQL implementation
│   ├── sources/                   # ★ INBOUND ADAPTERS — add a source here
│   │   ├── types.ts               # SourceAdapter, CanonicalEvent, VerifyContext
│   │   ├── registry.ts            # registerSource / getSource / allSources
│   │   ├── index.ts               # the single wiring point (registers clickup)
│   │   └── clickup/adapter.ts     # ClickUp adapter: verify (HMAC) + parse → CanonicalEvent
│   ├── routing/
│   │   ├── types.ts               # RouteRecord, DispatchResult
│   │   ├── engine.ts              # match (exact, fan-out all) → transform → deliver → record (idempotent)
│   │   └── transforms/
│   │       ├── types.ts           # Transform
│   │       ├── registry.ts        # registerTransform / resolveTransform
│   │       ├── default.ts         # default embed transform (summary + link)
│   │       └── index.ts           # registers transforms
│   ├── discord/
│   │   ├── delivery.ts            # ★ DeliveryService (webhook-URL path this slice) + dedupe/retry chokepoint
│   │   └── rest.ts                # shared discord.js REST client (rate-limit buckets)
│   └── bot/
│       ├── client.ts              # discord.js Client; intents derived from registered handlers
│       ├── commands/
│       │   ├── types.ts           # SlashCommand
│       │   ├── registry.ts        # registerCommand / getCommand / allCommands
│       │   ├── index.ts           # registers commands
│       │   └── ping.ts            # /ping
│       └── events/
│           ├── types.ts           # EventHandler
│           ├── registry.ts        # binds handlers at login
│           ├── index.ts           # registers handlers
│           ├── interaction-create.ts  # routes interactions → command registry
│           └── guild-member-add.ts    # observes member-join (log)
└── tests/
    ├── app/                       # supertest over createApp(): webhook happy/forbidden/unknown, readiness
    └── machinery/                 # unit: clickup adapter, engine (match+idempotency), registries, default transform
```

**Structure Decision**: Single combined service (web service + gateway client in one process),
extending the existing server-mode `snackbyte-base` layout under `src/`. Chosen over a
multi-package or two-service layout because the constitution fixes one always-on Cloud Run
service for this phase, and `core/` depends on neither the HTTP face nor the bot face so a
future split stays cheap. No `frontend/backend` split — the React frontend is incidental.

## Complexity Tracking

No constitution violations; no justifications required. (Table omitted.)
