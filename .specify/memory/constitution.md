<!--
SYNC IMPACT REPORT
==================
Version change: (none) → 1.0.0
Bump rationale: Initial ratification of the snackbyte-discord constitution. This is a
  STANDALONE constitution (it does not inherit from or depend on the snackbyte-base
  template constitution, which the spin-up resolver removed from this repo). Several
  principles overlap with good Snackbyte-wide conventions by design; the rest are
  specific to a Discord integration hub. Derived from ARCHITECTURE.md (§1.4 governing
  principles, §7 cross-cutting concerns, §9 non-functional requirements, §10 compliance).

Principles defined (7):
  - I.   Patterns Over Instances
  - II.  Verify Before Process
  - III. Idempotent, Rate-Limited Delivery
  - IV.  Runtime-Mutable Routing, Compile-Time-Safe Logic
  - V.   Pinned, Typed, Tested — and Speckit Stays in Speckit Spaces
  - VI.  Always-On Resilience
  - VII. Secrets By Reference

Sections defined:
  - Core Principles (7)
  - Technology & Platform Constraints
  - Development Workflow & Quality Gates
  - Governance

Templates reviewed for alignment:
  - .specify/templates/plan-template.md   ✅ reviewed — "Constitution Check" is a generic
      gate slot; it will be populated per-feature from these principles. No edit needed.
  - .specify/templates/spec-template.md   ✅ reviewed — no mandatory-section conflicts; the
      security/idempotency/resilience principles surface as functional + non-functional
      requirements, which the template already accommodates.
  - .specify/templates/tasks-template.md  ✅ reviewed — task categories (foundational,
      error handling/logging, security hardening, per-story) accommodate principle-driven
      tasks (delivery chokepoint, signature verification, idempotency, migrations). No edit.
  - .claude/skills/speckit-*/SKILL.md     ✅ reviewed — generic, no outdated agent-name or
      stale-principle references requiring change.

Runtime guidance docs:
  - ARCHITECTURE.md is the design source; it already states these rules as named
      requirements (not FR-numbers), consistent with Principle V. No edit required.
  - README.md / CLAUDE.md — no principle citations to reconcile.

Follow-up TODOs: none. RATIFICATION_DATE = 2026-06-22 (today; initial adoption).
-->

# snackbyte-discord Constitution

snackbyte-discord is a Discord integration hub: it receives webhooks from external
services (ClickUp, GitHub, and more over time), posts messages into Discord, and runs an
always-on gateway bot (slash commands, roles/members, reactions, moderation, events) — all
in one combined always-on Cloud Run service. This constitution is standalone: it governs
this application on its own and does not depend on any other repository's constitution. It
supersedes ad-hoc convention; spec, plan, and task artifacts MUST conform to it.

The hub's reason for existing is cheap extension: adding the next source, command, or route
must be near-zero effort. These principles exist to keep that true as the hub grows.

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

**Rationale**: The product is the set of patterns, not any one integration. Special-casing
sources or commands into core code is the failure mode that makes the Nth integration as
expensive as the first — the exact opposite of a one-stop-shop hub.

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
- Bot gateway intents and OAuth permissions MUST follow least privilege: enable only what
  registered handlers require. Privileged intents (e.g. Message Content) MUST be optional
  and isolated — the bot MUST boot and function with them off.

**Rationale**: The hub posts into Discord on behalf of external triggers; an unverified
webhook is an open command channel. Verification before any processing is the load-bearing
security boundary, and HMAC integrity depends on byte-exact bodies.

### III. Idempotent, Rate-Limited Delivery

All delivery to Discord MUST be idempotent and rate-limit-aware, and MUST flow through one
delivery service.

- Every Discord write (webhook-URL path or bot-REST path, inbound-triggered or on-demand)
  MUST go through the single delivery service / shared REST client. Ad-hoc direct calls to
  Discord that bypass it are prohibited.
- Each canonical event MUST carry a stable dedupe key, and a delivery MUST be short-
  circuited if the same (route, dedupe key) has already been delivered. Duplicate webhook
  deliveries MUST NOT produce duplicate Discord messages.
- The delivery service MUST respect Discord rate limits (per-bucket and global), honoring
  `Retry-After` and backing off on 429/5xx. The delivery outcome MUST be recorded.

**Rationale**: External providers retry webhooks, and Discord enforces rate limits. A single
chokepoint is the only place these can be enforced once and correctly; bypassing it
reintroduces double-posts and rate-limit bans the rest of the system assumes away.

### IV. Runtime-Mutable Routing, Compile-Time-Safe Logic

What an operator changes at runtime and what an engineer changes in code MUST stay on
opposite sides of a deliberate line.

- Routing and enablement (which source/event goes to which Discord target, on/off, per-
  route configuration) MUST live in the database and be changeable without a deploy.
- Verification, parsing, transforms, commands, and event handlers MUST live in code —
  typed, reviewed, and tested. Security- or correctness-critical logic MUST NOT be made
  data-driven in a way that lets a row edit change how a payload is verified or parsed.
- Secrets are never the thing stored in routing rows; see Principle VII.

**Rationale**: Operators need to register and strike routes instantly; engineers need
critical logic to pass type-checking and review. Putting routing in code forces a deploy per
change; putting verification/parsing in data removes the safety net. The split preserves
both.

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

The service is always-on, and its liveness MUST NOT be hostage to downstream health.

- The liveness endpoint MUST stay green while the process is up, independent of Discord or
  database availability, so a transient downstream blip does not cause the platform to cycle
  the instance. Readiness MAY reflect downstream state but MUST be separate from liveness.
- Degradation MUST be graceful and defined: when Discord is unavailable, deliveries retry
  then record failure while inbound still acknowledges the provider; when the database is
  unavailable, routing fails closed (the provider is told to retry) while bot functionality
  that does not need the database still works. The gateway connection MUST auto-reconnect,
  and a crash MUST result in a clean restart that re-establishes both the HTTP server and
  the bot.

**Rationale**: A bot needs a persistent gateway connection, so the instance must stay alive
through downstream hiccups. Coupling liveness to downstream health turns a brief outage into
a restart loop; defined degradation keeps partial outages partial.

### VII. Secrets By Reference

Secrets MUST NOT live in source control or in browsable data rows.

- Credentials (bot token, database/connection credentials, per-source signing secrets,
  Discord channel webhook URLs) MUST come from environment / a secret manager, never from
  committed files and never as plaintext in database rows.
- Where a routing or target row needs to reach a secret, it MUST store a reference name
  resolved to the value at runtime — not the value itself.
- Logs MUST NOT contain secrets, tokens, or full inbound payloads at normal log levels.

**Rationale**: The database is operator-editable (its table editor is the day-one admin UI),
so plaintext secrets in rows are effectively published to every operator. Reference
indirection keeps the admin surface usable without exposing live credentials.

## Technology & Platform Constraints

The platform shape is fixed; deviation requires a constitution amendment.

- **Language/runtime**: TypeScript (ESM), Node 24, strict mode.
- **HTTP/bot**: Express for the webhook router and health/admin surface; discord.js for the
  gateway bot. Both run in one process, started by a single unified bootstrap.
- **Persistence**: a Postgres-compatible database (Supabase) accessed through a thin
  repository layer so the storage backend stays swappable. Schema changes go through
  migrations.
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

**Version**: 1.0.0 | **Ratified**: 2026-06-22 | **Last Amended**: 2026-06-22
