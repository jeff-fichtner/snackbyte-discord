<!--
SYNC IMPACT REPORT
==================
Version change: 1.1.1 → 2.0.0
Bump rationale: MAJOR — Principle I redefined. Deploy mode moves from a runtime
  configuration value (DEPLOY_MODE, "switching MUST NOT require source rewrites") to a
  build-time identity resolved once at spin-up by an init resolver, where switching IS
  a documented source edit. This removes a former MUST and changes the template's core
  model, so it is backward-incompatible. Propagated to spec (Context, FR-002, FR-005,
  US2 AS-3, Key Entities), data-model, tasks, and scripts (mode.ts deleted, init.mjs
  added, DEPLOY_MODE removed throughout).

Prior amendment (1.1.0 → 1.1.1): PATCH — runtime pin Node 22 → Node 24 LTS.
Prior amendment (1.0.0 → 1.1.0): MINOR — added Principle VIII (Speckit Stays in
  Speckit Spaces).

Modified principles: none redefined
Added principles:
  - VIII. Speckit Stays in Speckit Spaces
Modified sections:
  - Development Workflow & Quality Gates — durable decision record repointed off
    the (now-removed) docs/DECISIONS.md to the spec/research artifacts.
Removed sections: none

Prior ratification (1.0.0) added:
  - I.   Single Template, Mode Resolved at Spin-Up
  - II.  Convention Over Configuration
  - III. Skeleton Only — No Application Logic
  - IV.  Two-Tier Propagation (Template vs Package)
  - V.   Uniform Deploy Path (Cloud Run Default)
  - VI.  Prerender By Default
  - VII. Pinned, Linted, Type-Safe, Tested
  - Technology Stack, Development Workflow & Quality Gates sections

Templates requiring review for alignment:
  - .specify/templates/plan-template.md   ✅ reviewed — Constitution Check gate generic, compatible
  - .specify/templates/spec-template.md   ✅ reviewed — no mandatory-section conflicts
  - .specify/templates/tasks-template.md  ✅ reviewed — task categories accommodate testing/lint/deploy gates
  - .specify/templates/checklist-template.md ✅ reviewed — no constitution-specific coupling

Follow-up TODOs: none. RATIFICATION_DATE unchanged (2026-05-31).
-->

# snackbyte-base Constitution

snackbyte-base is the reusable technical skeleton for the snackbyte.io family of
one-off applications. Each app is spun up from this template (GitHub "Use this
template"), then deployed independently to its own subdomain. This constitution
governs what the template guarantees to every app spun up from it. It supersedes
ad-hoc convention; spec, plan, and task artifacts MUST conform to it.

## Core Principles

### I. Single Template, Mode Resolved at Spin-Up

There is exactly ONE template skeleton, not a family of forks. The template itself is
mode-neutral: it carries both `static` and `server` capability, marked, until a
one-time spin-up step resolves it to exactly one. After resolution the app simply IS
that mode — there is no runtime mode flag, no mode configuration value, and no trace
of the other mode. Deploy mode is a build-time identity baked into the source, not a
setting read at boot.

Switching mode later is a deliberate, documented source edit (reversible, visible in
version control) — NOT a config toggle. This is intentional: mode is a property of
the app, not an environment knob.

**Rationale**: Two templates double the maintenance surface for a solo maintainer and
let the two paths drift. One mode-neutral template, resolved once at spin-up, gives
every app the same proven base AND a clean single-mode identity that doesn't read as
"generated from a template." Modeling mode as runtime config was rejected: it left the
app's fundamental nature in an environment value and made every app carry both code
paths forever. (The per-mode wiring is sprawled across a few files today; it is slated
to consolidate into a versioned runtime package once the interface is proven, which
will shrink the switch surface to a single call site — see the build order.)

### II. Convention Over Configuration

Spin-up MUST require no re-deciding of tooling, structure, or conventions. A fresh
copy MUST yield a running dev server and a buildable app via documented commands, in
under five minutes, with zero additional configuration decisions. Linting,
formatting, type-checking, and testing MUST already be configured and runnable.

**Rationale**: The entire purpose of the template is fast, uniform spin-up. If the
developer must re-decide tooling each time, the template has failed and the apps
diverge.

### III. Skeleton Only — No Application Logic

The template MUST NOT contain application-specific business logic. It ships
structure, tooling, configuration, scripts, and deploy artifacts — nothing that
belongs to one app's domain. Demonstrative placeholder content is allowed only where
it proves the skeleton works (e.g. a rendered page proving prerender), never as
domain logic.

**Rationale**: Business logic in the skeleton would be copied into every app whether
relevant or not, and would have to be deleted on every spin-up — the opposite of a
clean starting point.

### IV. Two-Tier Propagation (Template vs Package)

Change propagation has exactly two tiers, and each kind of change uses the correct
one. Skeleton concerns — toolchain, configs, folder conventions, the mode switch,
deploy artifacts — live in this template and propagate by manual backport (rare,
accepted, because the skeleton stabilizes). Shared visual identity — theme, Header/
Footer, shared components — does NOT live here; it belongs to the future
`@snackbyte/ui` versioned npm package and propagates by version bump.

**Rationale**: GitHub templates are a one-time copy, bad at keeping
frequently-changing styling in sync across subdomains; a versioned package is built
for exactly that. The skeleton stabilizes, so a one-time copy is fine for it.

### V. Uniform Deploy Path (Cloud Run Default)

Both deploy modes target Google Cloud Run by default. A static-mode app is a
container that serves built files and exposes no API routes; a server-mode app is the
same container plus API routes. The template MUST ship the artifacts for this single
path: a `Dockerfile`, a `.dockerignore`, and a documented deploy path (`gcloud run
deploy` and/or a Cloud Build config). Cloud Storage + Cloud CDN is a documented
performance-only opt-in for static apps (instant response, global edge) — never the
default and never chosen on cost grounds.

**Rationale**: One deploy path for every app maximizes uniformity for a solo
maintainer and gives a static app a free promotion to server mode. Cost is a tie at
~$0 (scale-to-zero, per-request-ms billing), so cost cannot decide the default;
uniformity does.

### VI. Prerender By Default

Static, build-time-known content MUST be prerendered to real HTML at build time, not
shipped as an empty shell rendered in the browser. Client-side rendering MUST remain
available for genuinely runtime-driven apps (games, interactive tools), but is the
exception, not the default.

**Rationale**: CSR-ing static content wastes first paint and SEO for content that
never changes. The anti-pattern is client-rendering static content — not using React,
which prerenders cleanly at this scale.

### VII. Pinned, Linted, Type-Safe, Tested

Every app MUST agree on its runtime and quality gates. The template MUST pin Node 24
LTS, use TypeScript throughout, and ship runnable ESLint + Prettier and Vitest
configurations. Lint, format, type-check, and test scripts MUST all run successfully
on a fresh, unmodified copy. The repository MUST exclude build artifacts,
dependencies, and local environment files from version control.

**Rationale**: A pinned runtime and pre-wired quality gates are what make every
spun-up app behave the same in development and production, and what stop quality from
being re-litigated per app.

### VIII. Speckit Stays in Speckit Spaces

The spec workflow (`specs/`, `.specify/`, `.claude/`) is AI-assist scaffolding. The
shipped artifact MUST stand on its own without it.

- If `specs/` and `.specify/` were deleted, every other file in the repository MUST
  still make sense to a reader.
- Source code (`src/`, `tests/`) MUST NOT reference specs, FRs, NFRs, Constitution
  Principles, User Stories, or any other spec-workflow artifact by name or number.
  Comments describe what the code does and why in terms of the code itself.
- Shipped documentation (`README.md`, `docs/`, build/CI files, scripts) MUST NOT
  reference the spec workflow either. The `docs/` tree is the shipped reference; it
  describes the system, not how the system came to be specified.
- When a comment or doc would say "(per FR-003)" or "see spec 001," it MUST instead
  state the underlying rule directly, or be removed if the citation was the only
  meaning.
- The constitution (`.specify/memory/constitution.md`) is the source of truth for
  these principles and SHOULD be referenced from spec-workflow artifacts (specs,
  plans, tasks). It MUST NOT be cited from `src/`, `tests/`, `README.md`, or `docs/`.
- Exception: `.claude/CLAUDE.md` MAY reference the spec workflow — it is
  AI-instruction space, not a shipped artifact.

**Rationale**: A template is copied into many apps. If shipped files cite FRs or
spec numbers, every spun-up app inherits dangling references to a spec it never had.
The shipped skeleton must read as a self-contained codebase; the spec scaffolding is
how it was built, not part of what ships.

## Technology Stack

The skeleton's stack is fixed (deviation requires a constitution amendment):

- **Language**: TypeScript (non-negotiable).
- **Build/dev server**: Vite.
- **UI framework**: React (chosen because the shared `@snackbyte/ui` layer is a
  component-library problem best-trodden in React; React does not force server mode).
- **Backend**: Express, present in the skeleton, deployed only in `server` mode.
- **Tests**: Vitest (reuses `vite.config`, ESM-native).
- **Runtime**: Node 24 LTS, pinned.
- **Lint/format**: ESLint (typescript-eslint) + Prettier.
- **Host**: Google Cloud Platform — Cloud Run (default deploy path for both modes),
  Artifact Registry for images.

Conventions are adapted from the existing `tonic` app, with Jest replaced by Vitest
and React adopted as the UI layer. `tonic` proved the toolchain; it did NOT prove the
static/server mode switch, the stripped skeleton, or the shared-UI layer — those are
the new, unproven work this template establishes.

## Development Workflow & Quality Gates

- **Spec-driven development**: features follow the Spec Kit flow —
  `/speckit-constitution` → `/speckit-specify` → `/speckit-plan` → `/speckit-tasks`
  → `/speckit-implement`. Specs live at `specs/NNN-short-name/spec.md`, one git
  branch per feature.
- **Constitution gate**: every plan MUST pass a Constitution Check; any violation of
  a principle MUST be justified in writing or the design changed. Unjustified
  complexity is rejected.
- **Quality gate**: lint, format, type-check, and Vitest MUST pass on a fresh copy
  before the skeleton is considered green. These are the same gates every spun-up app
  inherits.
- **Durable decision record**: architecture decisions and their rationale live in the
  feature's spec artifacts (`spec.md`, `research.md`) within `specs/`, never in the
  shipped `docs/` tree (per Principle VIII). Cross-feature platform context lives in
  agent memory.

## Governance

This constitution supersedes other practices for snackbyte-base. When guidance
conflicts, the constitution wins.

- **Amendments** require an explicit edit to this file with a Sync Impact Report and
  a version bump, plus propagation to any dependent templates and docs in the same
  change.
- **Versioning policy** (semantic):
  - **MAJOR** — backward-incompatible governance changes or principle removals/
    redefinitions.
  - **MINOR** — a new principle or section, or materially expanded guidance.
  - **PATCH** — clarifications, wording, and non-semantic refinements.
- **Compliance review**: plans and specs are checked against these principles before
  implementation; reviews verify that changes either comply or carry a written
  justification. The stack in Technology Stack is fixed — changing it is an amendment,
  not a per-app decision.

**Version**: 2.0.0 | **Ratified**: 2026-05-31 | **Last Amended**: 2026-06-01
