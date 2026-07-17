<!--
SYNC IMPACT REPORT
==================
Version change: 1.0.0 → 2.0.0
Bump rationale: MAJOR. The hub is multi-tenant: one Discord application, installed per
  guild, serving many independent owners who configure it through a web surface and who
  cannot ship code. v1.0.0 was written for a single owner with repo access and database
  access, and two of its principles encode that assumption in ways that are now wrong
  rather than merely narrow:
    - Principle IV placed `commands` on the compile-time-only side of the line. That
      forbids the product's central capability (a tenant defining a command in their own
      guild). REDEFINED — see below.
    - Principle VII justified reference-indirection with "the database is operator-editable
      (its table editor is the day-one admin UI)". That premise is false: tenants cannot be
      given the table editor. The principle survives; its rationale and its storage backend
      do not.
  Both are principle redefinitions, hence MAJOR.

Principles (8):
  - I.    Patterns Over Instances                                   [AMENDED — tenancy]
  - II.   Verify Before Process                                     [AMENDED — tenant selection]
  - III.  Idempotent, Rate-Limited Delivery                         [AMENDED — noisy neighbor]
  - IV.   Compile-Time-Safe Primitives, Runtime-Composed Instances  [REDEFINED — was
            "Runtime-Mutable Routing, Compile-Time-Safe Logic"]
  - V.    Pinned, Typed, Tested — and Speckit Stays in Speckit Spaces  [unchanged]
  - VI.   Always-On Resilience                                      [AMENDED — blast radius]
  - VII.  Secrets By Reference                                      [AMENDED — rationale
            replaced, env disqualified as a tenant secret store]
  - VIII. Tenant Isolation By Default                               [NEW]

Sections:
  - Core Principles (8)
  - The Tenancy Model            [NEW — the layering every principle below assumes]
  - Technology & Platform Constraints   [AMENDED — one application; connection manager
      deferred explicitly]
  - Development Workflow & Quality Gates  [unchanged]
  - Governance                            [unchanged]

Templates reviewed for alignment:
  - .specify/templates/plan-template.md   ✅ "Constitution Check" is a generic gate slot;
      populated per-feature. No edit needed.
  - .specify/templates/spec-template.md   ✅ no mandatory-section conflicts.
  - .specify/templates/tasks-template.md  ✅ task categories accommodate the new
      tenant-scoping and authorization tasks.
  - .claude/skills/speckit-*/SKILL.md     ✅ generic; no stale-principle references.

Runtime guidance docs — PROPAGATION DONE in this change:
  - ARCHITECTURE.md ✅ restructured. The prior §5 Q6 composer analysis concluded "Tier 3 is
      judged redundant… skip it permanently unless the operator population changes." That
      trigger has fired — but the conclusion SPLITS rather than inverts: Tier 3 stays
      rejected for a NEW reason (it is a hosting platform, not a Discord hub), while the
      redundancy argument itself is now false, and Tier 2.5 is promoted from exploratory to
      committed. The totality test, the three break-out axes, and the total-DSL constraints
      all survive the decision and are now NORMATIVE — recorded as ARCHITECTURE §4 rather
      than as an open question. The settled tenancy model is §2; the build plan is §3.
  - docs/ROADMAP.md ✅ re-cut. 009 (was "admin-diagnostics", P2 operator surface) is now
      the tenant onboarding surface and is load-bearing — without it there is no tenant.
      013-multi-secret-per-source ("conditional — build only if the need arises") is now
      required and absorbed into 011-inbound-per-tenant; the need has arisen. The prior flat
      dependency graph is void — it was flat only because nothing was owned. Stub specs
      renumbered: the deferred backlog moved to 014–018 so that 007–013 read as the
      multi-tenant build order.
  - CLAUDE.md / README.md — no principle citations to reconcile.

Follow-up TODOs: none from this amendment. Specs 007, 008, 010, 012, 013 are named in the
  roadmap but not yet stubbed — they are created by /speckit-specify, not by this change.
  RATIFICATION_DATE unchanged (2026-06-22).
-->

# snackbyte-discord Constitution

snackbyte-discord is a multi-tenant Discord integration hub. It runs **one** Discord
application, installed per guild by independent owners. It receives webhooks from external
services (ClickUp, GitHub, and more over time), posts messages into Discord under faces the
hub itself mints, and runs an always-on gateway bot (slash commands, roles/members,
reactions, moderation, events) — all in one combined always-on Cloud Run service. This
constitution is standalone: it governs this application on its own and does not depend on
any other repository's constitution. It supersedes ad-hoc convention; spec, plan, and task
artifacts MUST conform to it.

The hub's reason for existing is cheap extension — for its engineers _and for its tenants_.
Adding the next source or route must be near-zero effort for an engineer; adding the next
command, face, or rule must be near-zero effort for a tenant who cannot ship code and never
will. These principles exist to keep both true as the hub grows.

## The Tenancy Model

Every principle below assumes this layering. It is normative.

- **Platform layer** — the Discord application, the process, the database. Owned by the
  hub. Not tenant-scoped, and MUST NOT pretend to be. Its singular values (one application,
  one bot token, one app id) are _correct_, not placeholders for something bigger.
- **Tenant layer** — installations, sources, routes, targets/faces, commands, secrets.
  Every row belongs to exactly one tenant.
- **The guild install is the tenant boundary.** A tenant's rights over a guild derive from
  the bot being installed there by someone holding `MANAGE_GUILD` — a fact the platform can
  verify — never from a value the tenant supplied.
- **Faces are not applications.** A tenant's custom identity is a webhook the hub mints,
  names, avatars, wears per message, and deletes. It is not a second Discord application.
  Tenants own faces; the platform owns the one application.
- **A tenant bringing their own Discord application is not yet built, and is expected** —
  Discord's global rate limit is per-token and shared, so past some tenant count the only
  way to get more buckets is more applications. The schema MUST therefore keep it a data
  change rather than a rewrite (a nullable tenant reference on the application record), and
  every consumer MUST resolve by application id. Building it requires a connection manager
  that is deliberately unbuilt; see Technology & Platform Constraints.

## Core Principles

### I. Patterns Over Instances

Every integration point MUST be an instance of a reusable pattern, never a special case
wired into core code. Concretely:

- Inbound sources MUST implement the shared source-adapter contract (verify → parse →
  normalize to the canonical event) and self-register in the source registry. Core code
  MUST NOT name or branch on a specific source.
- Bot slash commands and gateway event handlers MUST be self-registering modules in their
  registries, dispatched generically (one `interactionCreate` router by command name; one
  binding loop for event handlers). No central switch statement enumerates them.
- Adding a source, command, or handler MUST be "write one module + register it at the one
  wiring point," with no edits to the routing engine, delivery service, or dispatch core.
- **No tenant may be a special case.** Core code MUST NOT name or branch on a specific
  tenant, guild, or channel. The first tenant is an instance of the pattern, not the
  pattern's definition.

**Rationale**: The product is the set of patterns, not any one integration — and not any
one tenant. Special-casing sources or commands into core code is the failure mode that
makes the Nth integration as expensive as the first; special-casing a tenant is the same
failure one level up, and it is the failure mode that makes the second tenant impossible.

### II. Verify Before Process

No inbound webhook payload may be parsed, routed, or delivered until its authenticity is
verified.

- Every source adapter MUST verify the request signature (HMAC or the provider's scheme)
  against a secret resolved from configuration — never from the request itself — using a
  constant-time comparison. A request that fails verification MUST be rejected as
  unauthorized (HTTP 401 — a permanent failure the provider should not retry) and MUST NOT
  be parsed or dispatched. This is distinct from an infrastructure failure during
  processing, which fails closed so the provider retries (see Principle VI).
- Signature verification MUST operate on the exact received bytes. The raw body MUST be
  preserved for verification (raw-body capture is mounted only on the webhook routes);
  re-serialized bodies are not acceptable inputs to verification.
- **Tenant selection precedes verification, and the selector is untrusted.** A multi-tenant
  inbound request MUST carry a non-secret tenant/installation identifier (in the path) used
  ONLY to select which candidate secret to verify against. That identifier MUST NOT be
  treated as authentication, MUST NOT grant anything on its own, and an unknown identifier
  MUST fail exactly like a bad signature — 401, no parsing, and no response that
  distinguishes "no such tenant" from "wrong signature".
- Bot gateway intents and OAuth permissions MUST follow least privilege: enable only what
  registered handlers require. Privileged intents (e.g. Message Content) MUST be optional
  and isolated — the bot MUST boot and function with them off.

**Rationale**: The hub posts into Discord on behalf of external triggers; an unverified
webhook is an open command channel. Verification before any processing is the load-bearing
security boundary, and HMAC integrity depends on byte-exact bodies. Multi-tenancy adds a
chicken-and-egg — you must know whose secret to check before you can check it — and the
only safe resolution is that the thing telling you _whose_ is a hint for lookup, never a
claim of identity. Distinguishing "unknown tenant" from "bad signature" in the response
would turn that hint into an enumeration oracle.

### III. Idempotent, Rate-Limited Delivery

All delivery to Discord MUST be idempotent and rate-limit-aware, and MUST flow through one
delivery service.

- Every Discord write (webhook path or bot-REST path, inbound-triggered or on-demand) MUST
  go through the single delivery service / shared REST client. Ad-hoc direct calls to
  Discord that bypass it are prohibited.
- Each canonical event MUST carry a stable dedupe key, and a delivery MUST be short-
  circuited if the same (route, dedupe key) has already been delivered. Duplicate webhook
  deliveries MUST NOT produce duplicate Discord messages.
- The delivery service MUST respect Discord rate limits (per-bucket and global), honoring
  `Retry-After` and backing off on 429/5xx. The delivery outcome MUST be recorded.
- **Tenants share the platform's rate limit, so no tenant may consume it without bound.**
  Delivery MUST be fair across tenants: one tenant's burst MUST NOT starve or 429 another.
  Where the global limit is the contended resource, the delivery service is the one place
  that can see the contention and MUST be the one place that arbitrates it.

**Rationale**: External providers retry webhooks, and Discord enforces rate limits. A single
chokepoint is the only place these can be enforced once and correctly; bypassing it
reintroduces double-posts and rate-limit bans the rest of the system assumes away. With one
application serving every tenant, Discord's global limit is a _shared_ resource that no
tenant knows they are sharing — which makes noisy-neighbor starvation the hub's problem to
solve, not the tenant's to notice.

### IV. Compile-Time-Safe Primitives, Runtime-Composed Instances

What an engineer writes and what a tenant composes MUST stay on opposite sides of a
deliberate line. The line falls between **vocabulary** and **sentence** — not between code
and configuration.

- **Effect primitives** — the verbs an instance can perform (reply, react, pick from a set,
  assign a role, post as a face, apply a sanction, …) — MUST live in code: typed, reviewed,
  tested, and enumerable. The vocabulary is finite and grows only by engineering.
- **Instances** — command definitions, triggers, routing, enablement, per-guild
  configuration, faces — MUST live in the database, scoped to a tenant, and be changeable
  without a deploy. A tenant composes instances from the primitive vocabulary. A tenant
  never authors a primitive.
- **Verification and parsing MUST NOT be composable.** No row, in any table, may change how
  a signature is verified or how a payload is parsed. This is absolute and survives every
  future composition capability.
- **A tenant MUST NOT author, upload, or inject executable behavior.** If a desired
  capability cannot be expressed as a composition of existing primitives, the answer is a
  new primitive in code — never an escape hatch, an expression evaluator, or a sandbox.

**Rationale**: Tenants cannot ship code and never will, so a hub whose behavior is
extensible only by `git push` is not a hub for them — it is a hub for its owner. But
arbitrary authored behavior imports every problem of a hosting platform (sandboxing,
resource limits, cross-tenant exfiltration, an arbitrary-code debugging surface) into a
product that is not one. Composition from a finite, typed vocabulary gives tenants total
freedom over _instances_ while keeping every executable path reviewed — a tenant builds any
sentence they like and cannot invent a verb.

The prior form of this principle placed `commands` on the code-only side. That was correct
for a single-owner repo and wrong for a multi-tenant one: a command **definition** was never
security-critical logic, only its primitives are. The two collapsed into one word because
one person owned both. They do not collapse here.

### V. Pinned, Typed, Tested — and Speckit Stays in Speckit Spaces

The toolchain and quality gates are fixed, and the shipped artifact stands on its own.

- The project MUST pin Node 24, use TypeScript in strict mode (ESM), and keep ESLint,
  Prettier, and Vitest configured and runnable. `npm run check:all` (format, lint,
  typecheck, test) MUST pass on a clean checkout before code is considered green.
- The spec workflow (`specs/`, `.specify/`, `.claude/`) is AI-assist scaffolding. Shipped
  files — `src/`, `tests/`, `README.md`, `docs/`, build/CI files, scripts — MUST NOT
  reference specs, FRs, NFRs, user stories, or constitution principles by name or number.
  Comments and docs state the underlying rule directly. If `specs/` and `.specify/` were
  deleted, every remaining file MUST still make sense.

**Rationale**: Pinned, pre-wired quality gates keep behavior identical in dev and CI and
stop quality from being re-litigated per feature. Keeping spec-workflow citations out of
shipped code keeps the codebase self-contained and free of dangling references.

### VI. Always-On Resilience

The service is always-on, its liveness MUST NOT be hostage to downstream health, and no
tenant's failure may become another tenant's outage.

- The liveness endpoint MUST stay green while the process is up, independent of Discord or
  database availability, so a transient downstream blip does not cause the platform to cycle
  the instance. Readiness MAY reflect downstream state but MUST be separate from liveness.
- Degradation MUST be graceful and defined: when Discord is unavailable, deliveries retry
  then record failure while inbound still acknowledges the provider; when the database is
  unavailable, routing fails closed (the provider is told to retry) while bot functionality
  that does not need the database still works. The gateway connection MUST auto-reconnect,
  and a crash MUST result in a clean restart that re-establishes both the HTTP server and
  the bot.
- **A tenant-scoped failure MUST stay tenant-scoped.** A revoked install, a deleted face, a
  misconfigured route, or a tenant's own downstream outage MUST NOT mark the service
  unready, crash the process, or degrade another tenant. Health that is genuinely global
  (the process, the database, the one gateway connection) MAY gate readiness; nothing
  tenant-specific may.

**Rationale**: A bot needs a persistent gateway connection, so the instance must stay alive
through downstream hiccups. Coupling liveness to downstream health turns a brief outage into
a restart loop; defined degradation keeps partial outages partial. With many tenants in one
process, "partial" acquires a second meaning: the blast radius of any one tenant's problem
must be that tenant. A global readiness flag driven by tenant-specific state would let the
worst-configured tenant decide whether everyone is serving.

### VII. Secrets By Reference

Secrets MUST NOT live in source control, in browsable data rows, or in process configuration
that a tenant would need to differ.

- Credentials (bot token, database credentials, per-source signing secrets, Discord webhook
  URLs) MUST come from a secret manager, never from committed files and never as plaintext
  in database rows.
- Where a routing, target, or application row needs to reach a secret, it MUST store a
  reference name resolved to the value at runtime — not the value itself.
- **Environment variables are platform configuration, not a tenant secret store.** A value
  belongs in the environment only if it is genuinely process-wide and no second tenant would
  ever need it to differ (the bot token, the app id, the database URL, log level). **If a
  second tenant would need a different value, it is data — not config.** Tenant-scoped
  secrets MUST resolve from a store that is writable at runtime, because a tenant adding an
  integration MUST NOT require a deploy.
- A webhook URL is a credential in the strongest sense: possession is total authority over
  that face — execute, rename, re-avatar, delete — with no membership or permission check.
  It MUST be treated as a secret, never as an address.
- Logs MUST NOT contain secrets, tokens, or full inbound payloads at normal log levels.

**Rationale**: Reference indirection keeps configuration legible without exposing live
credentials, and it is the seam that lets the storage backend change without touching a
single row.

The prior rationale — "the database is operator-editable (its table editor is the day-one
admin UI)" — is void. Tenants cannot be handed the table editor, so the admin surface is a
product requirement rather than a borrowed tool, and "don't publish secrets to every
operator" understates it: rows are now visible to people who are not the owner. Worse, the
prior backend cannot survive the model. Environment variables are set by a deploy, and a
deploy restarts the service and drops the gateway connection for **every** tenant — so
"tenant adds an integration" and "everyone briefly goes offline" would be the same event.
The reference seam was always right. The store behind it was single-tenant.

### VIII. Tenant Isolation By Default

Every persisted row belongs to exactly one tenant, and nothing is reachable without being
scoped.

- Every tenant-owned table MUST carry a tenant reference, and every query against it MUST be
  scoped by that reference. An unscoped read or write is a defect, not a shortcut.
- **Authorization MUST be verifiable, never claimed.** A tenant's right to act on a guild,
  channel, or face MUST derive from a fact the platform can check — the bot is installed
  there; the actor holds `MANAGE_GUILD`; the hub minted this face — never from an identifier,
  URL, or id the requester supplied. A value a user hands you is a claim; a value the
  platform can confirm is a right.
- **Scoping is not authorization, and the tenant reference MUST be derived — never
  accepted.** A scoped query prevents an _accident_; it does nothing about an _attack_. The
  same call is safe or fatal depending only on where its tenant reference came from: derived
  from something the platform verified (the session's owner, the guild the event arrived
  from, the installation the URL resolved to) is a right; taken from the request body, a
  query parameter, or any other caller-supplied value is a claim. The type system cannot
  tell these apart, so the derivation MUST be structural — a tenant reference MUST NOT be
  constructible from untrusted input.
- **The two authorization layers MUST NOT be merged.** _Tenant_ authorization ("does this
  tenant own this guild at all?") and _member_ authorization ("does this user hold this
  Discord permission here?") answer different questions at different layers. Tenant
  authorization is more fundamental than any bot capability and MUST live in core, reachable
  by every face — never inside a moderation or command module because that is where
  "permissions" happen to live.
- **Row presence MUST NOT be treated as authorization** once more than one party can insert
  rows. Any invariant of the form "the existence of this row IS the permission" is void and
  MUST be replaced by an explicit check against verifiable ownership.
- Nothing that identifies or belongs to a tenant may live in process configuration, be
  inferred from the process, or be defaulted when absent. Tenant identity MUST be an
  argument, never an ambient.
- Platform infrastructure (the application, the process, the database) is NOT tenant-scoped
  and MUST NOT be given a tenant reference to look symmetrical.

**Rationale**: The hub's failure mode is not a crash — it is a missing `WHERE`. A single
unscoped query silently serves one tenant another's configuration, or posts into a guild
that never asked; nothing errors, nothing alerts, and the damage is discovered by the
victim. This is why tenant identity must be an argument rather than an ambient: an argument
that is missing fails at compile time, while an ambient that is wrong fails in production,
quietly, for someone else. The single-owner design read identity from the process, which was
safe only because the process and the owner were the same thing.

## Technology & Platform Constraints

The platform shape is fixed; deviation requires a constitution amendment.

- **Language/runtime**: TypeScript (ESM), Node 24, strict mode.
- **HTTP/bot**: Express for the webhook router and health/admin surface; discord.js for the
  gateway bot. Both run in one process, started by a single unified bootstrap.
- **Discord application**: exactly **one**, platform-owned, installed per guild. It is
  recorded as data (one row, one token reference) rather than read from the process, so that
  identity is always a lookup and never a constant. Nothing may write a second row.
- **The multi-connection manager is deliberately unbuilt, and is expected.** Holding more
  than one gateway connection — whether for sharding (Discord _requires_ it past ~2500
  guilds) or for a tenant's own application — means a connection, member cache, intent set,
  and reconnect lifecycle _per connection_, which the one-warm-instance deploy shape cannot
  hold and which Cloud Run cannot autoscale (it scales on requests; gateways are
  connections). Every consumer MUST therefore resolve its client and REST **by application
  id**, so the manager can be introduced behind that seam without touching a call site.
  Introducing it changes the platform shape and is therefore an amendment — a deliberate
  gate, so the deploy-shape decision is made once and explicitly rather than discovered.
- **Privileged intents are a scale gate, not merely a permission.** The bot requests
  `GuildMembers` unconditionally and `MessageContent` behind a flag; both are privileged, and
  Discord requires application verification at **100 guilds** to keep them. Least privilege
  (Principle II) is therefore also a _scaling_ constraint: every privileged intent MUST be
  justifiable in a Discord review, and one that cannot be justified MUST NOT be requested.
- **Persistence**: a Postgres-compatible database (Supabase) accessed through a thin
  repository layer so the storage backend stays swappable. Schema changes go through
  migrations.
- **Secrets**: a runtime-writable secret manager. Environment variables are limited to
  platform configuration (see Principle VII).
- **Deploy**: one combined always-on Google Cloud Run service (`min-instances=1`). The
  webhook router and the bot are not split into separate services unless and until scale
  demands it; such a split MUST preserve the rule that core depends on neither face.
- **Observability**: structured logging (pino), subject to the secret-redaction rule in
  Principle VII.

## Development Workflow & Quality Gates

- **Spec-driven development**: features follow the Spec Kit flow —
  `/speckit-constitution` → `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` →
  `/speckit-implement`. Specs live at `specs/NNN-short-name/`.
- **Constitution gate**: every plan MUST pass a Constitution Check against these principles;
  any violation MUST be justified in writing in the plan's Complexity Tracking, or the
  design changed. Unjustified complexity is rejected.
- **Quality gate**: `npm run check:all` MUST pass before a change is merged. CI re-runs the
  gate; a failing gate blocks the merge and the release tag.
- **Durable decision record**: architecture decisions and their rationale live in the
  feature's spec artifacts under `specs/`, and in `ARCHITECTURE.md` for cross-feature
  design — never as spec-workflow citations inside shipped code (Principle V).

## Governance

This constitution supersedes other practices for snackbyte-discord. When guidance
conflicts, the constitution wins.

- **Amendments** require an explicit edit to this file with a Sync Impact Report and a
  version bump, plus propagation to any dependent templates and docs in the same change.
- **Versioning policy** (semantic):
  - **MAJOR** — backward-incompatible governance changes, or principle removals/
    redefinitions.
  - **MINOR** — a new principle or section, or materially expanded guidance.
  - **PATCH** — clarifications, wording, and non-semantic refinements.
- **Compliance review**: plans and specs are checked against these principles before
  implementation; reviews verify that changes either comply or carry a written
  justification. The Technology & Platform Constraints are fixed — changing them is an
  amendment, not a per-feature decision.

**Version**: 2.0.0 | **Ratified**: 2026-06-22 | **Last Amended**: 2026-07-16
