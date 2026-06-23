# Architecture Document — Discord Integration Hub

> ⚠️ **TEMPORARY — REMOVE WHEN DONE.** This document is transitional scaffolding: the
> design input that seeds the Spec Kit artifacts under `specs/`. It is **not** a permanent
> shipped doc. **Delete it once its content has been absorbed into the spec artifacts**
> (spec.md / plan.md / data-model.md / contracts/ across the relevant `specs/NNN-*`
> features) — at the latest, once the walking skeleton and bot-depth features are spec'd and
> planned. After that, the durable design record lives in `specs/` (and decision rationale in
> spec/research artifacts); keeping this root doc would duplicate that and drift out of sync,
> and a standalone `ARCHITECTURE.md` is a template-era fingerprint the shipped repo should not
> carry. Until then it remains the single source for design intent. **Removal checklist:**
> (1) every section's content is reflected in a `specs/` artifact; (2) no open question in §12
> is still unresolved-and-unrecorded elsewhere; (3) nothing in `src/`, `tests/`, `README.md`,
> or CI references this file.

**Project:** `snackbyte-discord` — a Discord _integration hub_ (inbound webhooks + outbound posts + gateway bot), broader than "webhooks." Discord-centric by design; a future Slack/other-platform hub would be a separate codebase (e.g. `snackbyte-slack`), sharing only the generic canonical-event + routing core.
**Status:** TEMPORARY architecture / pre-spec scaffolding (see removal banner above). This document is the intended input to **GitHub Spec Kit** (`/speckit-constitution` → `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-implement`).
**Base:** spun up from `snackbyte-base` (TypeScript · Vite · React · Express · Cloud Run · Vitest), used as the template precedent. Governed by the standalone **snackbyte-discord Constitution v1.0.0** (`.specify/memory/constitution.md`), not by the template's own constitution.
**Date:** 2026-06-22.

> **How to read this (Spec Kit mapping).** Sections are partitioned to map onto Spec Kit's phases:
>
> - **§1, §9, §10, §12** → _specify_ material (WHAT / WHY / requirements / constraints / open questions).
> - **§2–§8** → _plan_ material (HOW / architecture / data model / layout / cross-cutting).
> - **§11** → _tasks/milestones_ spine.
>   A spec author should be able to lift requirements from §1/§9/§10 into `spec.md`, and architecture/data-model from §2–§8 into `plan.md` + `data-model.md` + `contracts/`.

> **Constitution compliance note (Principle V — "Speckit Stays in Speckit Spaces").** This document uses **named requirements** (e.g. "signature verification is mandatory"), never FR-numbers, so the Spec Kit author assigns identifiers without them leaking into shipped `src/`/`README.md`/`docs/`. Shipped code comments must describe behavior in terms of the code itself, never cite specs.

---

## 1. Context & Goals

### 1.1 Why this exists

The org runs external services (ClickUp now; GitHub, CI, others later) and a Discord server that should be the operational nerve center. There's no single place that (a) receives webhooks _from_ external services, verifies them, and posts formatted messages into the right Discord channels; (b) posts outbound messages _to_ Discord on demand; and (c) runs a Discord bot for roles, slash commands, moderation, and events. Building one-off services per integration does not scale. The cost of adding the _next_ source or _next_ command must be near-zero.

### 1.2 Intended outcome

A single, always-on TypeScript/Node service — a **one-stop-shop Discord integration hub** — whose defining property is **cheap extension**:

- **Add an inbound source** (e.g. GitHub) = write one adapter module + register it. No router rewiring.
- **Add a bot command or event handler** = drop one self-registering module in a folder. No central switch statement.
- **Register or strike a route** (source/event → Discord target) = edit one row in the routing table. No deploy.

The architecture's job is to **establish the patterns** — adapter interface, canonical event, routing table, command/handler registries, delivery service — so the patterns, not any single integration, are the product.

### 1.3 Decisions already locked (with the user)

- **Three capabilities, all in scope:** (1) post _to_ Discord (incoming webhook URLs and/or bot), (2) _receive_ external webhooks (verify→transform→route), (3) a full-capability gateway **bot** (slash commands, roles/members, reactions/moderation, events) — "anything and all," built to grow.
- **Topology:** ONE combined always-on **Cloud Run** service, `min-instances=1`. Express router + discord.js gateway run in the **same process/container**. The router "rides along" the always-on instance the bot requires, at ~$0 extra. (Future split is a documented evolution — §2.4.)
- **Stack:** TypeScript/Node (ESM, Node 24), `discord.js`, built on **snackbyte-base** conventions. "Most robust" over "what exists." The friend's Python bot is conceptual context only — nothing to port.
- **Persistence:** **Supabase (free-tier Postgres)**, accessed through a thin **repository** layer so Neon/plain-Postgres is a drop-in swap. The DB holds the runtime-mutable **routing table** + state; Supabase's built-in **table editor** is the day-one "register/strike a webhook" admin UI. Adapters + transforms stay in **code**.
- **Stack precedent settled:** `pxp-stripe-webhooks` (Cloudflare Workers + D1) is a deliberate **one-off and NOT a pattern to follow**. The governing standard is **snackbyte-base + its constitution**.

### 1.4 Governing principles carried throughout

- **Patterns over instances.** ClickUp/GitHub/commands are _instances_ of a pattern, never special cases in core.
- **Runtime-mutable routing, compile-time-safe logic.** Routing/enablement in DB (no deploy to change); verification/parsing/transform/command logic in code (typed, tested, reviewed).
- **One always-on process, one container, one entrypoint.** §2.4.
- **Self-contained shipped artifact** (constitution Principle V): spec scaffolding stays in `specs/` and `.specify/`; shipped files don't cite it.
- **App, not template.** This is a _spun-up app_ from snackbyte-base, so domain logic lives here legitimately — constitution Principle III ("skeleton only") governs the _template_, not its spun-up apps.

---

## 2. High-Level Architecture

### 2.1 One process, three faces over one core

One Node 24 process / one Cloud Run service (`min-instances=1`) contains:

1. **Express HTTP server** — inbound external webhooks (`POST /webhooks/:source`), health/readiness (`/api/health`), version (`/api/version`), thin admin/diagnostics. (Day-one admin UI is Supabase's table editor, so the Express admin surface stays minimal.)
2. **discord.js gateway client** — persistent WebSocket; dispatches slash commands + gateway events through registries.
3. **Shared core** — config, DB/repository, structured logging, the routing/dispatch engine, the Discord delivery service. Both faces depend on core; **core depends on neither face** (this is the seam that makes a future split cheap).

### 2.2 ASCII architecture

```text
                         EXTERNAL WORLD
   ┌────────────┐   ┌────────────┐   ┌─────────────────┐
   │  ClickUp   │   │   GitHub   │   │  (future src…)  │
   └─────┬──────┘   └─────┬──────┘   └────────┬────────┘
         │  HTTP POST (signed webhooks)        │
         ▼                ▼                     ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │  CLOUD RUN SERVICE  (single container, min-instances=1, one process)  │
 │                                                                       │
 │  ┌───────────────────────────┐        ┌──────────────────────────┐   │
 │  │  EXPRESS HTTP SERVER       │        │  DISCORD.JS GATEWAY BOT  │   │
 │  │  src/server.ts createApp() │        │  src/bot/client.ts       │   │
 │  │  POST /webhooks/:source ───┼──┐  ┌──┤  interactionCreate       │   │
 │  │  GET  /api/health          │  │  │  │  guildMemberAdd          │   │
 │  │  GET  /api/version         │  │  │  │  messageReactionAdd …    │   │
 │  │  (express.raw on webhooks) │  │  │  └──────────┬───────────────┘   │
 │  └───────────────────────────┘  │  │             │ command &         │
 │            verify+parse+normalize│  │             │ handler registries│
 │                                  ▼  ▼             ▼                   │
 │  ┌─────────────────────────────────────────────────────────────┐    │
 │  │                      SHARED CORE                              │    │
 │  │  Source Adapter Registry ──► CanonicalEvent                  │    │
 │  │            ▼                                                  │    │
 │  │      ROUTING / DISPATCH ENGINE                               │    │
 │  │      match routes → transform → fan out → idempotent log      │    │
 │  │            ▼                                                  │    │
 │  │      DISCORD DELIVERY SERVICE (webhook-URL | bot-REST)        │    │
 │  │   config.ts   logging(pino)   repository (DB adapter)        │    │
 │  └──────────────────────────────┬──────────────┬───────────────┘    │
 └──────────────────────────────────┼──────────────┼────────────────────┘
                                    │              │
                          Discord REST/Webhook   Supabase (Postgres)
                          + Gateway WSS          sources / discord_targets
                                    │            routes / delivery_log
                                    ▼              ▲ table editor =
                        ┌────────────────────┐     │ day-one admin UI
                        │   DISCORD SERVER    │◄────┘ (register/strike route)
                        │  channels / members │
                        └────────────────────┘
```

### 2.3 Primary data flows

- **Inbound (external → Discord):** `POST /webhooks/:source` → raw-body middleware → adapter (`verify`→`parse`→`normalize`) → `CanonicalEvent` → routing engine (lookup enabled routes for `source`+`eventType`) → per-route transform → delivery service → Discord (webhook URL or bot REST) → write `delivery_log`.
- **Bot (Discord → action):** gateway event (`interactionCreate`, `guildMemberAdd`, …) → command/handler registry → handler runs (may read DB, call delivery service, mutate Discord state) → reply/ack.
- **Outbound-on-demand (internal → Discord):** internal code (a command, a cron, an authenticated admin endpoint) calls the **same** delivery service with a target + payload.

### 2.4 Why one process / one container (and the future split)

- The bot **requires** a persistent gateway WS → **requires** `min-instances=1`. That instance is paid for regardless; co-locating Express on it adds ~$0. A separate router would scale-to-zero but cold-start per webhook and add a second deploy.
- One process → shared in-memory state (adapter/command registries, delivery rate-limit queue, the discord.js REST client with built-in bucket handling) with no cross-service coordination.
- **Entrypoint (key decision):** a single unified bootstrap (`src/main.ts`) starts both `createApp().listen(PORT)` and `botClient.login(token)` in one Node process. Preferred over a process supervisor (concurrently/s6) because there is exactly one always-on instance — a supervisor adds a failure mode and obscures the crash signal Cloud Run relies on. `server.ts` keeps `createApp()` exported so supertest mounts the app without a network port or live gateway.
- **Known future evolution:** if volume/scaling demands, split into two Cloud Run services over the **same `src/core` and DB**. The seam is pre-drawn (core depends on neither face), so it's "two thin entrypoints," not a rewrite.

---

## 3. Subsystems & Extension Patterns

### 3.1 Inbound — the Source Adapter pattern

Adding a source = write one adapter + register it. Core never learns the word "ClickUp." A single generic route `POST /webhooks/:source` looks up the adapter by slug and runs a three-step contract.

```ts
// src/sources/types.ts
export interface CanonicalEvent {
  source: string; // adapter slug; matches routes.source
  eventType: string; // discriminator, e.g. "taskStatusUpdated" | "pull_request.opened"
  dedupeKey: string; // stable per-delivery id for idempotency (provider id or body hash)
  occurredAt: string; // ISO-8601 (provider time if available, else receipt time)
  title: string; // human summary the default transform can use without source knowledge
  url?: string; // deep link back into the source
  actor?: { id?: string; displayName?: string; avatarUrl?: string };
  data: Record<string, unknown>; // structured fields a per-route transform may reference
  raw: unknown; // validated raw payload, for advanced transforms/debugging
}
export interface VerifyContext {
  rawBody: Buffer; // exact received bytes — required for HMAC (see raw-body note)
  headers: Record<string, string | string[] | undefined>;
  secret: string; // per-source secret resolved from env/secret manager, never the request
}
export interface SourceAdapter {
  readonly slug: string; // route is POST /webhooks/{slug}; unique
  readonly displayName: string;
  verify(ctx: VerifyContext): boolean | Promise<boolean>; // reject unauthentic
  parse(
    rawBody: Buffer,
    headers: VerifyContext['headers'],
  ): // 0..N canonical events
    CanonicalEvent[] | Promise<CanonicalEvent[]>;
}
```

- **Registry:** `registerSource(a)` / `getSource(slug)` / `allSources()` in `src/sources/registry.ts`; `src/sources/index.ts` is the **single wiring point** importing each adapter.
- **Generic route handler:** `receiveWebhook(req,res)` resolves the adapter (`404` if unknown) and delegates to the engine.
- **Worked example — ClickUp:** `X-Signature` = HMAC-SHA256 of raw body with the webhook secret. `verify`: `crypto.createHmac('sha256', secret).update(rawBody).digest('hex')` + `timingSafeEqual`. `parse`: read `event` (`taskCreated`/`taskStatusUpdated`/`taskCommentPosted`), build `CanonicalEvent` (`url=https://app.clickup.com/t/{task_id}`, `dedupeKey=webhook_id + history_item_id` or body hash).
- **Raw-body footgun (must-have):** Express's JSON parser consumes/reserializes the body and breaks HMAC. Mount `express.raw({ type: '*/*' })` **only** on `/webhooks/*`; keep normal JSON parsing elsewhere. Ordering matters — call out in spec.
- **Why in code, not DB:** verification/parsing are security-critical and provider-shaped → must be typed, unit-tested, reviewed. Only _whether/where_ a source's events route belongs in DB (§4).

### 3.2 Routing / Dispatch engine

Given a `CanonicalEvent`, find every enabled route matching `source`+`eventType` (supporting `eventType='*'` wildcard), apply each route's transform, deliver to each route's target — all driven by DB rows editable live. Routes process **independently** (one failure doesn't block others).

```ts
// src/routing/engine.ts (shape)
export async function dispatch(event: CanonicalEvent, deps: EngineDeps): Promise<DispatchResult> {
  const routes = await deps.repo.findEnabledRoutes(event.source, event.eventType);
  const outcomes = await Promise.allSettled(routes.map((r) => deliverForRoute(event, r, deps)));
  return summarize(routes, outcomes);
}
// deliverForRoute: idempotency check (route.id+dedupeKey) → resolveTransform → getTarget → delivery.send → recordDelivery
```

```ts
// src/routing/types.ts
export interface RouteRecord {
  id: string;
  source: string;
  eventType: string;
  targetId: string;
  transform: string | null; // named code transform; null = default
  config: Record<string, unknown>; // per-route knobs: filters, mention roles, embed color
  enabled: boolean;
  priority: number;
}
```

**Transforms:** named code modules (`registerTransform(key, t)` / `resolveTransform(key)`), `route.transform` selects one, `null` = generic default (title+url+actor → simple embed). Per-route variation (channel, @role, color, filters) lives in `route.config` JSON, so one transform serves many routes. New rendering logic = a new named transform (code change); tuning = a config edit (no deploy).

### 3.3 Discord delivery service

Two mechanisms, one abstraction; each `discord_targets` row declares its `mode`:

- **webhook-URL path** — POST to a channel webhook URL. No bot perms, custom username/avatar, isolated, survives bot downtime. Best for fire-and-forget external notifications.
- **bot-REST path** — bot's authenticated REST client. Required for bot identity, components/buttons, reactions, threads, or posting where no webhook exists. Benefits from discord.js's built-in rate-limit buckets.

```ts
// src/discord/delivery.ts
export interface DiscordMessage {
  content?: string;
  embeds?: Embed[];
  username?: string;
  avatarUrl?: string;
  components?: unknown[];
}
export interface DeliveryTarget {
  id: string;
  mode: 'webhook' | 'bot';
  webhookUrlRef?: string;
  channelId?: string;
  guildId?: string;
}
export interface DeliveryService {
  send(
    target: DeliveryTarget,
    msg: DiscordMessage,
    opts?: { idempotencyKey?: string },
  ): Promise<void>;
}
```

Implementation: retries with backoff on `429`/`5xx`, honors `Retry-After`; the single chokepoint for Discord rate limits (§7).

### 3.4 The bot (discord.js gateway)

Adding a command/handler = drop one self-registering module — no central switch.

```ts
// src/bot/commands/types.ts
export interface SlashCommand {
  data: SlashCommandBuilder; // builds the registration payload
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
}
// registry: registerCommand(c) / getCommand(name) / allCommands(); index.ts imports each command
```

- **Two-step command lifecycle:** (1) _registration_ — push definitions to Discord's REST application-commands endpoint (guild-scoped in dev for instant updates; global in prod) via `scripts/deploy-commands.mjs`; (2) _dispatch_ — one `interactionCreate` listener routes by `commandName` into the registry.

```ts
// src/bot/events/types.ts
export interface EventHandler<K extends keyof ClientEvents = keyof ClientEvents> {
  event: K;
  once?: boolean;
  handle(...args: ClientEvents[K]): Promise<void> | void;
}
// registry binds each handler with client.on/.once at login
```

- **Intents & permissions (least privilege):** enable only the gateway intents the registered handlers need. **Message Content is privileged** (portal opt-in; Discord verification past 100 guilds) → message-content features must be **optional and isolated**; the bot boots/functions with it OFF. Derive the required intent set from registered handlers so it doesn't silently drift. OAuth invite grants only needed permissions (manage roles, etc.).
- Example handlers as instances of the pattern: `guildMemberAdd` (welcome/auto-role), `messageReactionAdd` (reaction-role/moderation), `interactionCreate` (command router).

#### Interaction surface is itself an extension axis (one-stop-shop)

The bot must be able to expose a capability through **any** Discord interaction style, not just
slash commands — slash commands, text-prefix commands (`!role`), message components
(buttons / select menus), context menus (user / message), modals, and reaction-driven actions —
and remain open to styles Discord adds later. Command style is therefore **not** a fixed choice;
it is a pluggable axis, the same way inbound sources are. The same capability (e.g. self-assign a
role) can be offered through several styles at once, all delegating to one shared piece of logic.

Concretely, the bot layers a small set of **interaction-handler registries** over the gateway, one
per style, each populated by drop-in self-registering modules and dispatched generically from the
relevant gateway event:

- slash / chat-input commands → dispatched from `interactionCreate` (shown above)
- text-prefix commands → dispatched from `messageCreate` (requires the privileged Message Content
  intent, so this style stays **optional and isolated** per the intents rule above — the bot boots
  and all other styles work with it OFF)
- message components (buttons, selects) → dispatched from `interactionCreate` by `customId`
- context-menu commands (user / message) → registered alongside slash commands, dispatched from
  `interactionCreate`
- modals → dispatched from `interactionCreate` by `customId`
- reaction actions → dispatched from `messageReactionAdd` / `messageReactionRemove`

The shared rule (Principle I, Patterns Over Instances): **a capability is logic; an interaction
style is an adapter onto that logic.** Adding a new style = add one registry + one dispatch binding;
adding a new capability = add one module and register it under whichever style(s) should expose it.
Core never enumerates styles or capabilities in a switch statement. Phase 1 ships only the
slash-command path; the registries for the other styles arrive with the features that need them.

---

## 4. Data Model

**Principle:** DB = runtime-mutable routing/registry/state; code = verification/parsing/transforms/commands/handlers; env/secret-manager = credentials. Target Postgres (Supabase) behind a repository interface (Neon/Postgres swap). SQL migrations under `migrations/`. Use `timestamptz`.

**`sources`** — known inbound sources. `slug` PK (matches code adapter + `CanonicalEvent.source`), `display_name`, `enabled` (master kill-switch, no deploy), `secret_ref` (reference name of signing secret in secret manager — **never the value**), `created_at`. Authoritative adapter list is the code registry; rows are operational enablement.

**`discord_targets`** — where messages go. `id` uuid PK, `name`, `mode CHECK IN ('webhook','bot')`, `guild_id`, `channel_id` (req. when bot), `webhook_url_ref` (secret ref, req. when webhook), `enabled`, `created_at`.

**`routes`** — the routing table (operators edit this). `id` uuid PK, `source` FK→sources.slug, `event_type` (exact or `'*'`), `target_id` FK→discord_targets.id, `transform` (named key or NULL=default), `config` jsonb DEFAULT '{}', `enabled`, `priority` int, `created_at`. Index `(source, event_type) WHERE enabled`. Register = insert; strike = `enabled=false` or delete — zero deploy via table editor.

**`delivery_log`** — audit + idempotency. `id`, `route_id` FK, `source`, `event_type`, `dedupe_key`, `target_id` FK, `status ('ok'|'failed'|'skipped')`, `error` (redacted), `created_at`. **`UNIQUE (route_id, dedupe_key)`** → duplicate provider deliveries short-circuit (no double-post). Doubles as operator-visible history.

**`bot_state` / kv (optional, phase 3)** — `(guild_id, key) → jsonb` for runtime bot config (welcome text, reaction-role maps, per-guild flags) editable without deploy.

**What lives where:** DB (table-editor-editable, no deploy) = the above. Code (typed/tested/reviewed/deployed) = adapters, transforms, commands, handlers, engine, repository, delivery. Env/secret manager = bot token, DB URL/Supabase key, per-source signing secrets, channel webhook URLs (values behind the `*_ref` columns).

---

## 5. Configuration & Secrets

- **Single config source:** extend snackbyte-base `src/config.ts` (currently just `PORT`) into a validated object read once at boot, failing fast on missing required values: `PORT`, `DISCORD_BOT_TOKEN`, `DISCORD_APP_ID`, `DISCORD_DEV_GUILD_ID` (dev command sync), `DATABASE_URL`, `SUPABASE_SERVICE_KEY?`, `LOG_LEVEL`, per-source signing secrets.
- **Cloud Run secrets:** inject via **Google Secret Manager** as env, not baked into the image, not committed. Dockerfile already ships only `dist/`. Local dev uses gitignored `.env` (base loads it via `scripts/load-env.mjs`); ship `.env.example` with names only.
- **Secret-reference indirection:** DB columns store a reference _name_ (e.g. `secret_ref='clickup_webhook_secret'`); the app resolves it to the value at runtime. Keeps the table editor usable as admin UI without browsable live secrets. (Relaxing this for low-stakes secrets behind Supabase RLS is an open question — §12.)

---

## 6. Directory / Module Layout

Matches snackbyte-base conventions: ESM, explicit `.js` on relative imports, `createApp()`/`registerRoutes()`, compiled to `dist/server/`. The four **★** folders + the repository seam are the extension points; each has an `index.ts` that is the single import/registration site.

```text
snackbyte-discord/
├── Dockerfile                     # base multi-stage; CMD → dist/server/main.js (unified bootstrap)
├── package.json                   # add discord.js, pino, pg/supabase-js; "start": node dist/server/main.js
├── .env.example                   # extends base: bot token, app id, DATABASE_URL, signing secrets
├── migrations/0001_init.sql       # sources, discord_targets, routes, delivery_log
├── scripts/
│   ├── dev.mjs                    # base dev runner; also spawns the bootstrap (Express + bot)
│   └── deploy-commands.mjs        # push slash-command defs (guild in dev, global in prod)
├── specs/  .specify/  .claude/    # Spec Kit scaffolding — NOT shipped logic (constitution Principle V)
├── src/
│   ├── main.ts                    # ★ UNIFIED BOOTSTRAP: Express.listen + bot.login + lifecycle (container CMD)
│   ├── server.ts                  # createApp(): Express; registerRoutes(app) — no listen here
│   ├── config.ts                  # ★ single config source (extended, validated)
│   ├── routes/{index,health,version,webhooks}.ts   # webhooks.ts = generic POST /webhooks/:source (express.raw)
│   ├── core/{logger,errors,lifecycle}.ts           # pino logger, typed errors, graceful shutdown/readiness
│   ├── db/{client,repository,supabase-repository}.ts  # ★ Repository interface + swappable impl
│   ├── sources/                   # ★ INBOUND ADAPTERS — add a source here
│   │   ├── {types,registry,index}.ts
│   │   └── clickup/{adapter,adapter.test}.ts
│   ├── routing/
│   │   ├── {types,engine}.ts
│   │   └── transforms/{types,registry,default,index}.ts   # ★ named transforms
│   ├── discord/{delivery,rest}.ts # ★ DeliveryService (webhook|bot) + shared REST client (rate limits)
│   └── bot/
│       ├── client.ts              # discord.js Client; intents derived from registered handlers
│       ├── commands/{types,registry,index,ping}.ts        # ★ SLASH COMMANDS
│       └── events/{types,registry,index,interaction-create,guild-member-add}.ts  # ★ GATEWAY HANDLERS
└── tests/{app,machinery}/         # supertest over createApp(); unit tests for adapters/engine/registries
```

**Bootstrap note:** base `server.ts` listens when run as main; here both _listen_ and _bot login_ move to `src/main.ts` (new entrypoint → container `CMD`). `server.ts` keeps `createApp()` for supertest.

---

## 7. Cross-Cutting Concerns

- **Structured logging (template lacks it → add `pino`):** root logger + child loggers per subsystem (`source=clickup`, `route=…`, `command=…`) + per-request correlation id. JSON → Cloud Logging. **Never log secrets/tokens/full payloads at info.**
- **Error handling:** typed errors in `core/errors.ts`; central Express error middleware (401 bad signature, 404 unknown source, 2xx accepted). Bot `execute` wrapped so one command's throw never crashes the gateway; reply ephemeral on error.
- **Retries / idempotency:** inbound via `UNIQUE(route_id, dedupe_key)` + `alreadyDelivered` (providers retry). Outbound exponential backoff on `429`/`5xx` honoring `Retry-After`; terminal outcome in `delivery_log`. **Recommended:** verify synchronously, return `2xx` fast, dispatch async (so retry storms don't pile up) — see open question §12.2.
- **Discord rate limits (first-class):** centralize ALL Discord writes through the delivery service / shared REST client so per-bucket + global limits are respected once; do not bypass discord.js's REST manager with ad-hoc fetch. Throttle per channel on high fan-out.
- **Observability/health:** `/api/health` liveness always-200 while process up (keeps Cloud Run from cycling the instance); a separate readiness signal (DB reachable, gateway `isReady()`) that does NOT gate liveness, so a transient DB blip doesn't kill the always-on instance.

---

## 8. Reuse of snackbyte-base (match these exactly)

- **ESM only** (`"type":"module"`), **Node 24**, TS strict, `moduleResolution: bundler`, `verbatimModuleSyntax` → explicit `.js` on relative imports.
- `src/server.ts` exports **`createApp(): Express`**, registers middleware then calls **`registerRoutes(app)`**; route handlers are named exports `(req: Request, res: Response): void` in `src/routes/*` (health at `/api/health`). Keep this; move `listen` into `main.ts`.
- `src/config.ts` is the single config source — extend it (don't scatter `process.env`).
- Dev: `scripts/dev.mjs` spawns children (vite + `tsx watch`); add the bot/bootstrap process here.
- Prod: multi-stage **Dockerfile**, final `CMD` runs the bootstrap; ships only `dist/`.
- Tests: **vitest + supertest**, `// @vitest-environment node`, under `tests/app` (integration) + `tests/machinery` (unit).
- CI/CD: GitHub Actions `ci-cd.yml`, versioning derived from git tags, deploy to Cloud Run.
- **Add to the base:** `discord.js`, `pino`, a Postgres client (`pg` recommended for portability behind the repository), migrations tooling.

---

## 9. Non-Functional Requirements & Constraints

- **Always-on:** `min-instances=1`; gateway must persist; liveness independent of downstream health.
- **Cost:** bot mandates one always-on instance; router rides along ~$0; no second service until scale demands it.
- **Security:** signature verification **mandatory** before parsing (reject `401`, don't dispatch); raw-body integrity required for HMAC; secrets in env/Secret Manager referenced by name (never plaintext in git/rows); least-privilege intents + OAuth permissions; Message Content optional/isolated.
- **Reliability / degradation:** Discord down → deliveries retry/backoff, then log `failed`, inbound still `2xx`; bot auto-reconnects (discord.js resumes). DB down → routing fails `5xx` (provider retries, correct); DB-free bot commands still work; liveness stays green. Crash → Cloud Run restarts; bootstrap re-establishes both faces.
- **Idempotency:** duplicate webhook deliveries must not double-post (unique key per route+event); bot interactions acked once.
- **Performance:** inbound = verify + fast `2xx` + async dispatch; hot route lookup = one indexed query.

---

## 10. Constitution Compliance (snackbyte-discord v1.0.0)

This app has its own **standalone** constitution (`.specify/memory/constitution.md`, v1.0.0,
7 principles I–VII). The snackbyte-base template's constitution is precedent only and does not
govern here. This design maps to the 7 principles as follows:

- **I — Patterns Over Instances:** source adapters, transforms, bot commands, and event/
  interaction handlers are self-registering modules behind registries; core never names a
  specific source or command (§3.1, §3.4).
- **II — Verify Before Process:** mandatory signature verification on the raw body before any
  parse/route; least-privilege intents, Message Content optional/isolated (§3.1, §3.4).
- **III — Idempotent, Rate-Limited Delivery:** one delivery service chokepoint; per-route
  dedupe key; Discord rate-limit handling (§3.3).
- **IV — Runtime-Mutable Routing, Compile-Time-Safe Logic:** routing in the DB (no deploy to
  change); verification/parsing/transforms in typed, tested code (§3.2, §4).
- **V — Pinned, Typed, Tested + Speckit stays in Speckit spaces:** Node 24, strict TS,
  `check:all` green; shipped `src/`/`tests/`/`README.md`/`docs/` must NOT cite FRs/specs/
  principles — use named rules. This doc already does. (Enforce in code review.)
- **VI — Always-On Resilience:** single always-on Cloud Run service; liveness independent of
  downstream; defined degradation (§2.4, §7, §9).
- **VII — Secrets By Reference:** credentials in env/secret manager, referenced from DB rows by
  name, never logged (§5).
- **App, not template:** this is a spun-up app, so domain/hub logic lives here legitimately —
  do not push it back into the snackbyte-base template.
- **Workflow:** follow `/speckit-constitution → specify → plan → tasks → implement`; decisions
  live in `specs/NNN-*/` artifacts, not shipped `docs/`. (The standalone constitution — once
  open question §12.11 — now exists.)

---

## 11. Phasing / Roadmap (Spec Kit milestone spine)

**Phase 1 — Walking skeleton (exercise every seam once, thinly).**

- Spin up from snackbyte-base; `src/main.ts` unified bootstrap (Express + bot one process); extend `config.ts`; add pino; Dockerfile `CMD` → `dist/server/main.js`.
- DB + repository: `migrations/0001_init.sql` (sources, discord_targets, routes, delivery_log); `Repository` interface + Supabase impl.
- One inbound source end-to-end: **ClickUp** adapter (verify+parse) → generic `/webhooks/:source` (raw body) → engine (idempotent) → default transform → **webhook-URL** delivery → `delivery_log`.
- One bot slice: client logs in; `/ping` slash command (proves command registry + deploy-commands + `interactionCreate`); one event handler (`guildMemberAdd` log) (proves handler registry).
- Tests: supertest webhook happy/forbidden; unit tests for adapter, engine idempotency, registries; health/readiness.
- **Outcome:** a real ClickUp event reaches a Discord channel via a DB-driven route, and a slash command responds — the whole architecture demonstrated.

**Phase 2 — Breadth:** second source (**GitHub**, `X-Hub-Signature-256`) proving the adapter pattern; bot-REST delivery path; named transforms beyond default; per-route `config` (mentions, filters, colors); admin/diagnostics endpoint(s).

**Phase 3 — Bot depth:** role/member commands, reaction-roles, moderation (Message Content opt-in, isolated), `bot_state`/kv, scheduled jobs reusing the delivery service.

- **BED-BOT parity (requirement, not just an example).** The hub MUST be a superset of the
  collaborator's self-hosted bot (`Bjarkirzz/BED-BOT`): self-assignable **roles** (toggle a role on
  yourself), a **list** of which roles are self-assignable, self-service **nicknames** (set / reset,
  enforcing Discord's 32-char limit), and the **whitelist safety model** (only explicitly allowed
  roles can be self-assigned — never staff/admin). In our build the whitelist is operator-editable
  runtime state (`bot_state`/a roles table), not a hard-coded list in source. These capabilities are
  exposed through the interaction-handler registries (§3.4) — slash commands to start, and any other
  style (text-prefix, components, etc.) as desired, all delegating to one shared capability. This is
  a distinct feature spec after the walking skeleton, sequenced in this phase.

**Phase 4 — Hardening/ops:** retry/backoff tuning, metrics endpoint, delivery-log retention/pruning, alerting on repeated `failed`, secret-rotation runbook, richer admin UI if the table editor outgrows its role.

**Phase 5 (known evolution, not committed) — Service split:** two Cloud Run services (router + bot) over the same `src/core` + DB if scale demands. Seam pre-drawn → two thin entrypoints, not a rewrite.

---

## 12. Open Questions / Decisions for the Spec Author

1. **Secrets in DB rows vs reference-only.** Reference-only (recommended) keeps live secrets out of the browsable table editor but adds indirection. Allow low-stakes secrets (e.g. a channel webhook URL) directly behind Supabase RLS? Define the `*_ref` policy.
2. **Sync vs async dispatch on inbound (biggest reliability trade-off).** Recommended: verify sync, `2xx` fast, dispatch async — but async-in-process means a crash between ack and delivery loses the event (no queue). Acceptable for phase 1, or process-then-ack (slower; idempotency covers retries)?
3. **Durable outbox?** Need a DB-backed outbox so Discord downtime can't lose events, or is retry-then-`failed` acceptable? Affects `delivery_log` (add `pending`/retry-count?).
4. **Route lookup caching.** Per-event read (always fresh, "edit a row → instant") vs TTL cache (faster under load). Recommend per-event read in phase 1.
5. **Command scope.** Guild-scoped (instant, per-guild) in dev vs global (~1h propagation) in prod — confirm + define `deploy-commands` strategy.
6. **Multi-guild from day one?** `discord_targets.guild_id` / `bot_state.guild_id` anticipate it; confirm whether phase 1 assumes a single guild.
7. **DB library.** `pg` (thin, keeps Neon swap cleanest) vs `supabase-js` (RLS/auth conveniences, more coupling). Recommend `pg` behind the repository.
8. **Admin surface boundary.** How long does Supabase's table editor remain the only admin UI before a real authenticated admin endpoint/UI is warranted? Define the trigger.
9. **`dedupeKey` fallback.** Body hash when no provider id — confirm acceptable (byte-identical re-fire suppressed, usually desired).
10. **Naming — RESOLVED.** Named `snackbyte-discord` (matches the `snackbyte-` family; Discord-centric by design). A future Slack/other-platform hub would be a separate codebase (`snackbyte-slack`), sharing only the generic canonical-event + routing core — the bots stay separate (the delivery side and gateway are deeply platform-specific). Use `snackbyte-discord` for repo / Cloud Run service / subdomain identifiers.
11. **Own constitution? — RESOLVED.** This hub carries its own **standalone** constitution
    (`.specify/memory/constitution.md`, v1.0.0, 7 principles), ratified before `/speckit-specify`.
    It does not inherit from snackbyte-base; it restates the overlapping good conventions in this
    app's own terms and adds the hub-specific rules (e.g. all Discord writes through the delivery
    service = Principle III).

---

## Verification (how to prove the walking skeleton end-to-end)

Once Phase 1 is built (post-Spec-Kit), verify:

1. **Local boot:** `npm run dev` starts Express + the bot in one process; `GET /api/health` returns 200; bot shows online in Discord; logs are structured (pino).
2. **Webhook receipt (happy):** POST a signed ClickUp-shaped payload to `/webhooks/clickup` with a valid HMAC → `2xx`; the message appears in the configured Discord channel; a `delivery_log` row is `ok`.
3. **Webhook receipt (auth):** POST with a bad signature → `401`; nothing posted; no `delivery_log` `ok` row.
4. **Idempotency:** POST the same payload twice (same `dedupeKey`) → posted once; second is `skipped`/short-circuited.
5. **Routing via DB:** insert/disable a `routes` row in Supabase's table editor (no redeploy) → next event routes/stops accordingly.
6. **Bot command:** run `/ping` in Discord → bot replies (proves command registry + `interactionCreate`).
7. **Tests/gates:** `npm test` (supertest webhook happy/forbidden + unit tests for adapter/engine/registries) and `npm run typecheck`/lint pass on a fresh copy.
8. **Delivery paths:** (phase 2) verify a `mode='bot'` target posts via bot REST and a `mode='webhook'` target posts via webhook URL.
