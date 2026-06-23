# Contract: Deploy Mode + Skeleton Scripts

This template is consumed by developers, not called over a network. Its "interface"
is therefore (a) the spin-up mode-resolution contract and (b) the behavior contract of
the documented scripts. Each clause below is independently testable and maps to a spec
requirement / success criterion.

## C1. Spin-up mode resolution

| Aspect | Contract |
|---|---|
| Resolver | `node scripts/init.mjs --mode=<static\|server> [--name=…]` |
| Values | exactly `static` or `server` |
| Invalid value | hard error with a clear message — never a silent default |
| Result | one clean single-mode app: the chosen mode baked into source, the other mode and all mode/init scaffolding removed, `init` self-deleted |
| Mode at rest | no runtime mode flag/env/config; mode is which code is present |

**Maps to**: FR-002, Principle I. **Tested by**: `tests/machinery/init.test.ts`.

## C2. `static` build

- **Given** an app resolved to **static**, **when** `npm run build` runs, **then** the
  output is a set of static assets, and build-time-known content is present as rendered
  HTML (not an empty root element).
- By default these assets are served by a container on Cloud Run that exposes **no**
  API routes. The assets are also capable of serverless CDN serving (the documented
  performance-only opt-in), but the container is the default.

**Maps to**: FR-003, FR-006, SC-003. **Tested by**: `tests/machinery/prerender.test.ts`
(rendered markup) and `tests/machinery/init.test.ts` (static app serves, no API).

## C3. `server` build + start

- **Given** an app resolved to **server**, **when** it is built and started, **then**
  an Express server serves the built frontend **and** exposes API routes (the liveness
  `/api/health` route responds).

**Maps to**: FR-004. **Tested by**: `tests/machinery/init.test.ts` (server app serves
frontend + API; static app has no API).

## C4. Mode switch is a documented source edit

- **Given** a resolved app, **when** the developer follows the documented switch
  procedure, **then** build/start behavior changes to the other mode via a small,
  enumerated set of source edits — reversible and visible in version control, never a
  config toggle.

**Maps to**: FR-005, SC-002, Principle I.

## C5. Quality-gate scripts

- **Given** a fresh, unmodified copy, **when** each of `npm run lint`, `npm run
  format` (check), `npm run typecheck`, and `npm test` runs, **then** each completes
  successfully with zero additional configuration.

**Maps to**: FR-007, FR-008, SC-004, Principle VII.

## C6. Cloud Run deploy artifacts

- The repo MUST contain a `Dockerfile`, a `.dockerignore`, and a documented deploy
  path (`scripts/deploy.sh` / `gcloud run deploy` and/or `cloudbuild.yaml`). Both
  modes use this one Cloud Run path; the mode difference is only whether API routes
  are exposed. A Cloud Storage + CDN path MUST be documented as a performance-only
  opt-in, not the default.

**Maps to**: FR-003, FR-003a, FR-004, FR-004a, Principle V. **Tested by**: presence/
review check (artifacts exist; README documents both the default and the opt-in).

## C7. Spin-up time + skeleton purity

- A developer goes from "Use this template" to a running dev server in under 5
  minutes via documented steps only (SC-001).
- The template contains no application-specific business logic (SC-005, FR-012) —
  verifiable by review; only demonstrative content that proves the skeleton.

**Maps to**: SC-001, SC-005, FR-010, FR-012, Principles II & III.
