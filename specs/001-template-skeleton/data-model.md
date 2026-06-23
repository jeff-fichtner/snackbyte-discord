# Phase 1 Data Model: snackbyte-base Template Skeleton

This feature is a template skeleton, not a data-backed application, so it has no
runtime persistence. The "entities" are the configuration and structural concepts
the template defines. They are drawn from the spec's Key Entities section.

## Entity: Deploy Mode

A build-time identity that determines build and serve behavior. Not a runtime value.

- **Type**: one of two — `static` | `server`
- **Where it lives**: in the app's source, baked at spin-up. A `server` app has the
  API routes and server wiring present; a `static` app does not. There is no runtime
  mode variable, env var, or config field to read (FR-002, Principle I).
- **Resolution**: the template is mode-neutral; the `init` resolver bakes exactly one
  mode into the source at spin-up and removes the other (and all mode scaffolding),
  leaving a clean single-mode app.
- **State transitions**: `static` ⇄ `server` is a deliberate, documented set of source
  edits (reversible, visible in version control) — never a config toggle (FR-005).
- **Behavioral effect**:
  - `static` → build produces prerendered static assets; the container serves files
    and exposes NO API routes.
  - `server` → the container serves the built frontend AND mounts API routes.

## Entity: App Skeleton

The reusable file/folder structure, tooling configuration, and scripts every
spun-up app inherits.

- **Fields (constituents)**:
  - Tooling config: `tsconfig*.json`, `vite.config.ts`, Vitest config, ESLint +
    Prettier in `config/`.
  - Runtime pin: `.nvmrc`, `package.json` `engines.node` = Node 24 LTS.
  - Scripts: `dev`, `build`, `lint`, `format`, `typecheck`, `test`, plus an aggregate
    gate and a deploy script.
  - Deploy artifacts: `Dockerfile`, `.dockerignore`, `scripts/deploy.sh`,
    `cloudbuild.yaml`.
  - Source layout: `src/server.ts`, `src/mode.ts`, `src/web/` (React), `tests/`.
  - Docs: `README.md` (spin-up + mode choice), `.env.example`.
- **Validation rules (invariants)**:
  - MUST contain no application-specific business logic — skeleton only (FR-012,
    Principle III). Demonstrative content is allowed only to prove the skeleton works.
  - Lint, format, type-check, and test scripts MUST all pass on a fresh, unmodified
    copy (FR-007, FR-008, SC-004).
  - Build artifacts, dependencies, and local env files MUST be git-excluded (FR-011).
- **Relationships**: An App Skeleton is parameterized by exactly one Deploy Mode.
  Visual identity (theme, Header/Footer, shared components) is NOT part of the
  skeleton — it belongs to the future `@snackbyte/ui` package (Principle IV,
  out of scope here).
