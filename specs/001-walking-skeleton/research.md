# Phase 0 Research: Walking Skeleton

The hub's stack and topology were decided during architecture/design (see `ARCHITECTURE.md`
and the constitution); this document records those decisions in Decision / Rationale /
Alternatives form and resolves the remaining implementation-level questions. There are no
unresolved NEEDS CLARIFICATION items.

## R1 — Single combined always-on process (Express + gateway bot)

- **Decision**: Run the Express webhook router and the discord.js gateway bot in one Node
  process, started by a unified bootstrap (`src/main.ts`), deployed as one Cloud Run service
  with `min-instances=1`.
- **Rationale**: The bot needs a persistent gateway WebSocket, which forces an always-on
  instance regardless; the router then "rides along" at ~$0 extra. One process = shared
  in-memory registries and a single delivery chokepoint with no cross-service coordination.
- **Alternatives**: Two services (router scale-to-zero + always-on bot) — saves pennies, adds
  a second deploy + network hop; deferred until scale demands it (the `core/` seam keeps it
  cheap later). Serverless edge (the `pxp-stripe-webhooks` pattern) — cannot hold a gateway
  connection; explicitly rejected as precedent.

## R2 — discord.js for the bot and Discord delivery

- **Decision**: Use `discord.js` for the gateway client and for the shared REST client. For
  this slice, delivery uses the channel-webhook style (POST to a channel webhook URL).
- **Rationale**: Most mature Discord ecosystem; its REST manager handles per-bucket and global
  rate limits, satisfying Principle III when all writes route through it. Webhook-style
  delivery needs no bot permissions, supports custom username/avatar, and survives bot
  downtime — ideal for fire-and-forget notifications.
- **Alternatives**: Raw `fetch` to Discord — rejected (would bypass rate-limit handling,
  violating the single-chokepoint rule). Bot-REST delivery — deferred to a later feature; the
  `DeliveryService` interface is designed to add it without changing callers.

## R3 — PostgreSQL via a repository interface

- **Decision**: PostgreSQL (Supabase in deployment) behind a thin `Repository` interface; the
  `pg` driver for the implementation; SQL migrations under `migrations/`.
- **Rationale**: The DB holds runtime-mutable routing the operator edits without a deploy
  (Principle IV); Supabase's table editor is the day-one admin surface. `pg` keeps the
  implementation portable so Neon/plain-Postgres is a drop-in swap; the repository interface
  isolates the rest of the code from the backend choice and enables a fake for unit tests.
- **Alternatives**: `supabase-js` client — more coupling to one vendor's SDK; rejected in favor
  of `pg` behind the interface. An ORM — unnecessary weight for four tables and a few queries.

## R4 — ClickUp webhook signature verification

- **Decision**: Verify the `X-Signature` header as an HMAC-SHA256 of the **raw request body**
  keyed by the webhook's signing secret, compared with a constant-time comparison; reject with
  401 on mismatch before any parsing. Capture the raw body via body-parsing limited to the
  webhook routes so the bytes are byte-exact.
- **Rationale**: This is ClickUp's documented webhook authentication scheme and the canonical
  HMAC pattern. Constant-time comparison avoids timing leaks; raw-body integrity is mandatory
  because re-serialized JSON will not match the signature (Principle II). The secret comes from
  configuration by reference, never from the request (FR-002, Principle VII).
- **Alternatives**: Trusting source IP / a shared query token — weaker, rejected. Verifying
  against a parsed-then-restringified body — breaks intermittently; rejected. (The adapter
  interface keeps each provider's scheme — e.g. GitHub's `X-Hub-Signature-256` — isolated to
  its own adapter for later sources.)

## R5 — Inbound acknowledgement + async dispatch (in-process)

- **Decision**: On a verified, well-formed request, acknowledge the sender with 2xx
  immediately, then perform routing + delivery asynchronously in the same process (fire the
  dispatch without awaiting it before responding). No durable queue in this slice.
- **Rationale**: Webhook senders expect a fast 2xx and will retry/disable on slow responses;
  async keeps the endpoint resilient under bursts (spec Clarification + FR-004a). Per-(route,
  event) idempotency protects against the retries this invites.
- **Alternatives**: Process-then-ack (synchronous) — a slow/down Discord delays the response
  and risks sender timeouts; rejected for this slice. Durable outbox (persist → ack → worker
  delivers) — eliminates the crash-window loss but adds infra deliberately deferred; recorded
  as a known later-phase gap (a crash between ack and delivery can drop one in-flight event).

## R6 — Route matching: exact, fan-out to all

- **Decision**: A route matches when its source and **exact** event type equal the event's;
  all enabled matching routes receive the event (independent fan-out), each delivered and
  de-duplicated on its own. The route's event-type field is modeled so a future catch-all/
  wildcard value can be added without restructuring.
- **Rationale**: Fan-out is the useful hub default (one event can belong in several channels)
  and matches the engine's independent-per-route processing (spec Clarifications, FR-006). A
  single indexed lookup on `(source, event_type) WHERE enabled` keeps it fast.
- **Alternatives**: First-match-by-priority or unique-(source,event_type) — both reduce
  usefulness and were rejected; wildcard matching — deferred to a later phase.

## R7 — Idempotency mechanism

- **Decision**: A `UNIQUE (route_id, dedupe_key)` constraint on `delivery_log` plus an
  "already delivered?" pre-check; the canonical event carries a stable `dedupeKey` (ClickUp's
  per-event identifier when present, otherwise a hash of the raw body). A duplicate is recorded
  as `skipped`, not re-posted.
- **Rationale**: Enforcing uniqueness in the store makes idempotency correct even under
  concurrent duplicate deliveries; per-route keying is consistent with fan-out (FR-013).
- **Alternatives**: In-memory dedupe set — lost on restart, not concurrency-safe; rejected.

## R8 — Slash command registration scope

- **Decision**: Register slash-command definitions with Discord via a `deploy-commands.mjs`
  script — guild-scoped in development (instant updates against a configured dev guild) and
  global for production. Dispatch at runtime through one `interactionCreate` listener that
  routes by command name into the command registry.
- **Rationale**: Guild-scoped registration updates immediately, which suits iteration; global
  registration is correct for production reach. Separating registration (deploy step) from
  dispatch (runtime) keeps adding a command to "write a module + register it".
- **Alternatives**: Registering commands on every boot — slower and rate-limited; rejected in
  favor of an explicit deploy step.

## R9 — Least-privilege gateway intents (Message Content avoided)

- **Decision**: Enable only the intents this slice's handlers need: `Guilds` (slash
  interactions) and `GuildMembers` (observe member-join). Do **not** enable the privileged
  Message Content intent.
- **Rationale**: The slice uses a slash command and a member-join observation — neither needs
  to read message text. Avoiding Message Content keeps the bot free of a privileged,
  approval-gated intent and honors "the bot boots and functions with it OFF" (Principle II).
  The intent set is derived from registered handlers so it does not silently drift.
- **Alternatives**: Enabling Message Content pre-emptively — unnecessary privilege; rejected.
  (Text-prefix commands, which would need it, are a later feature exposed as an isolated,
  optional style per `ARCHITECTURE.md` §3.4.)

## R10 — Structured logging with redaction

- **Decision**: Use `pino` with a root logger and per-subsystem child loggers
  (`source=clickup`, `route=…`, `command=…`) and a per-inbound correlation id; configure
  redaction so secrets, tokens, and full inbound payloads never appear at normal levels.
- **Rationale**: JSON logs suit Cloud Logging; redaction enforces FR-023 / Principle VII at the
  logger rather than relying on call-site discipline.
- **Alternatives**: `console.log` (template default) — no structure or redaction; replaced.
