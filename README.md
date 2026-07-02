# snackbyte-discord

A Discord integration hub: receives webhooks from external services (ClickUp and GitHub),
routes them through an operator-editable table to Discord channels — via channel webhooks or as
the bot itself — and runs an always-on Discord bot with self-service member commands (roles,
nicknames). One TypeScript/Node service on Google Cloud Run. Operational guide:
[docs/OPERATIONS.md](docs/OPERATIONS.md).

## Develop

This app runs on Node 24 (see `.nvmrc`); confirm `node --version` prints `v24.x`
(`nvm use` switches to it in an interactive shell).

```bash
node --version   # expect v24.x
cp .env.example .env   # local environment values (PORT, etc.)
npm install
npm run dev      # dev server at the URL Vite prints
```

Create the `.env` from `.env.example` as part of setup — the defaults run without it,
but this app expects a `.env` for its local config, so set it up now rather than later.

## Scripts

```bash
npm run dev          # dev server
npm run build        # build the distribution into dist/
npm run start        # run the built server
npm run lint         # ESLint
npm run format       # Prettier (write)
npm run typecheck    # tsc, frontend + backend
npm test             # Vitest
npm run check:all    # format check + lint + typecheck + test
```

## Rendering

Runtime-driven views render on the client. Where content is known at build time, it can be
prerendered to real HTML so those pages ship as markup rather than an empty shell.

Prerendering runs at **build** time, not in dev — so in `npm run dev` the page is the
empty shell (`<div id="root"></div>`) that React mounts into. Run `npm run build` to see
the prerendered markup.

## CI

A GitHub Action (`.github/workflows/ci-cd.yml`) gates pull requests and, on each push, runs
the checks and **derives a version tag from git history** — `dev` → `vX.Y.Z-dev` (staging),
`main` → `vX.Y.Z` (production). The PATCH is not stored in `package.json` (which holds only
`MAJOR.MINOR`); CI creates and pushes the **tag only**, never a commit. The tag is the deploy
signal.

**One-time setup, before the first push:** enable
**Settings → Actions → General → Workflow permissions → "Read and write permissions"** (so CI
can push the tag), and set branch protection requiring the `validate (merge gate)` check. The
first push tags on success; without write permission the checks pass but the tag step 403s.
See [DEPLOY.md](DEPLOY.md) for the full versioning + CI/deploy model.

## Deploy

```bash
./scripts/deploy.sh <service-name> <gcp-project> [region]   # builds the image and runs gcloud run deploy
```

Deploys a container to Cloud Run. Idle cost is near zero — Cloud Run scales to zero
and bills only while handling a request.

## Version

The app reports its version at `/api/version` and (in non-prod) a small on-page chip. The
server endpoint reads `APP_VERSION` / `BUILD_GIT_COMMIT` / `BUILD_DATE` from **runtime
environment variables** — `scripts/deploy.sh` sets these, so a deployed release reports
its true `vX.Y.Z` / commit / date at `/api/version`. Built and run locally (no deploy
env), it self-reports `0.0.0-dev` / `commit: dev` / `environment: development` — that's
expected, not a bug. (The frontend chip's version comes from `package.json` at build
time; its commit/date are populated only if the build passes them as Docker build-args —
see [DEPLOY.md](DEPLOY.md).)

## Spec-driven development

This project is built with spec-driven development (GitHub Spec Kit). The app's principles
live in the constitution (`.specify/memory/constitution.md`); shipped features live under
`specs/NNN-*/`. Each feature is spec'd and built on its own `spec/NNN-*` branch and merged only
once complete.

**Workflow per feature** — one at a time, one branch per feature:

1. **`/speckit-specify`** → **`/speckit-plan`** → **`/speckit-tasks`** →
   **`/speckit-implement`**.
2. Quality gates: **`/speckit-clarify`** (de-risk an ambiguous spec before planning),
   **`/speckit-checklist`** (validate requirements after planning), **`/speckit-analyze`**
   (cross-artifact consistency before implementing), and **`/speckit-converge`** (reconcile
   built code against spec/plan/tasks and append any remaining work).

The governing principles (full text in the constitution) — a few that shape everything here:

- **Spec stays in spec spaces.** `specs/`, `.specify/`, `.claude/` are AI-assist scaffolding.
  Shipped code (`src/`, `tests/`, `README`, `docs/`, scripts) stands on its own and never
  references specs, FRs, or principle numbers — it states the rule directly.
- **Patterns over instances.** Each source, transform, delivery mode, command, and interaction
  style is an instance of a reusable pattern, never special-cased into core.
- **Pinned, linted, type-safe, tested.** Node 24, TypeScript throughout, `npm run check:all`
  (format + lint + typecheck + test) green on every change.
