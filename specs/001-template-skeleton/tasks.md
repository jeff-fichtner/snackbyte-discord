---

description: "Task list for snackbyte-base template skeleton"
---

# Tasks: snackbyte-base Template Skeleton

**Input**: Design documents from `/specs/001-template-skeleton/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/deploy-mode.md, quickstart.md

**Tests**: INCLUDED. The spec mandates a Vitest setup (FR-008), the constitution requires tests to
pass on a fresh copy (Principle VII), and contracts C1–C7 define concrete, testable behavior. Test
tasks below cover mode resolution and the static-vs-server serve behavior.

**Organization**: Tasks are grouped by user story (US1 spin-up, US2 mode switch, US3 prerender) so
each can be implemented and tested independently.

> **SUPERSEDED (mode model)**: Tasks below were completed as written, then the deploy-mode model was
> redefined during review — from a runtime `DEPLOY_MODE` config value to a **build-time identity**
> resolved at spin-up by `scripts/init.mjs` (constitution v2.0.0, spec FR-002/FR-005, research R1a).
> Consequently `src/mode.ts` was deleted, `DEPLOY_MODE` was removed throughout, the mode-config tests
> were replaced by `tests/machinery/init.test.ts` (validates both resolved modes), and tests were
> re-tiered into `tests/machinery/` (template's own) vs `tests/app/` (the spun-up app's). The task
> text below reflects the original implementation; the current behavior is per the updated spec.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths are included in each description.

## Path Conventions

Web-app skeleton at repository root (per plan.md): `src/` (backend + `src/web/` frontend),
`tests/`, `config/`, `scripts/`. This is a template, so "implementation" means establishing the
skeleton, not building application features.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, runtime pin, and tooling that every spun-up app inherits.

- [X] T001 Initialize `package.json` at repo root with name, `type: module`, `engines.node` set to Node 24 LTS, and empty `scripts` block to be filled by later tasks
- [X] T002 Create `.nvmrc` at repo root pinning Node 24 LTS (matches `engines.node`) — satisfies FR-009
- [X] T003 [P] Update `.gitignore` at repo root to exclude `node_modules/`, `dist/`, build output, and `.env*` (keep `.env.example`) — satisfies FR-011
- [X] T004 Install runtime + dev dependencies via npm: `vite`, `@vitejs/plugin-react`, `react`, `react-dom`, `express`, `vitest`, `typescript`, `eslint`, `typescript-eslint`, `@eslint/js`, `prettier`, `eslint-config-prettier`, `tsx`, `@types/node`, `@types/express`, `@types/react`, `@types/react-dom`
- [X] T005 [P] Create base `tsconfig.json` at repo root (shared compiler options, strict mode) — adapted from tonic conventions
- [X] T006 [P] Create `tsconfig.web.json` at repo root (extends base; DOM lib, `jsx: react-jsx`) for the React frontend
- [X] T007 [P] Create `tsconfig.build.json` at repo root (extends base; backend emit) for server-mode compilation
- [X] T008 [P] Create `config/eslint.config.ts` (typescript-eslint flat config + `eslint-config-prettier`) — satisfies FR-007
- [X] T009 [P] Create `config/.prettierrc.json` and `config/.prettierignore` — satisfies FR-007
- [X] T010 Add `package.json` scripts: `dev`, `build`, `preview`, `lint`, `format`, `format:check`, `typecheck`, `test`, and an aggregate `check:all` (format:check + lint + typecheck + test) — satisfies FR-007, FR-008, C5

**Checkpoint**: `npm install` succeeds; `npm run lint`/`format:check`/`typecheck` run (even with no source yet).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The deploy-mode switch and shared build/serve pipeline that BOTH P1 stories depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T011 Create `.env.example` at repo root documenting `DEPLOY_MODE` (values `static`|`server`, default `server`) and `PORT` — single discoverable source per data-model.md
- [X] T012 Implement `src/mode.ts`: read `DEPLOY_MODE` from env, validate it is exactly `static`|`server`, default to `server` when unset, throw a clear error on any other value — satisfies FR-002, contract C1
- [X] T013 Create `vite.config.ts` at repo root: React plugin, project root pointing at `src/web/`, build output to `dist/` — shared by both modes
- [X] T014 Add a Vitest `test` block to `vite.config.ts` (single shared config — no separate `vitest.config.ts`): default `environment: 'node'`, with `jsdom` applied to `*.test.tsx` via `environmentMatchGlobs` (component tests need DOM; server/integration tests run in node); glob `tests/**` — satisfies FR-008
- [X] T015 Create minimal React entry skeleton: `src/web/index.html` (Vite HTML entry with `<div id="root">` + module script — the template the prerender step injects into), `src/web/App.tsx` (demonstrative content only, no business logic — FR-012), `src/web/main.tsx` (client hydration entry)
- [X] T016 Implement `src/server.ts`: Express app that serves the built frontend from `dist/`; mounts API routes ONLY when `mode === 'server'` (reads `src/mode.ts`) — the shared serve path for both modes

**Checkpoint**: Mode resolves and validates; Express serves built files; the mode gate exists. User stories can now proceed.

---

## Phase 3: User Story 1 - Spin up a new app from the template (Priority: P1) 🎯 MVP

**Goal**: A fresh copy installs, runs `npm run dev`, and renders a React + TypeScript app in the
browser with lint/format/typecheck/test already wired — no extra tooling decisions.

**Independent Test**: Clone a fresh copy, run documented install + dev commands, confirm the React
app renders via Vite and the four quality scripts run successfully (SC-001, SC-004).

### Tests for User Story 1

- [X] T017 [P] [US1] Unit test `tests/unit/mode.test.ts`: asserts default `server`, accepts `static`/`server`, throws on invalid value, and resolves solely from the `DEPLOY_MODE` env var (single discoverable source — no second location) — covers contracts C1, FR-002
- [X] T018 [P] [US1] Smoke test `tests/unit/app.test.tsx`: renders `src/web/App.tsx` and asserts demonstrative content is present — proves the React+test pipeline works on a fresh copy (SC-004)

### Implementation for User Story 1

- [X] T019 [US1] Wire `dev` script to run Vite (and, in server mode, the Express API via `tsx` concurrently) so `npm run dev` renders the app — satisfies FR-001, acceptance scenario US1-1
- [X] T020 [US1] Verify the four quality scripts (`lint`, `format:check`, `typecheck`, `test`) pass on the skeleton as-is — satisfies FR-007, FR-008, SC-004, acceptance scenario US1-2
- [X] T021 [US1] Write `README.md`: spin-up steps (Use this template → install → choose mode → dev), the static-vs-server mode choice, and where `DEPLOY_MODE` lives — satisfies FR-010, acceptance scenario US1-3, SC-001

**Checkpoint**: Fresh copy → running dev server in <5 min; all quality gates green. MVP is functional.

---

## Phase 4: User Story 2 - Choose static vs server deploy mode (Priority: P1)

**Goal**: Setting `DEPLOY_MODE` makes build/serve behavior follow from that one choice; static
produces CDN-ready assets with no API routes, server runs Express with API routes — both via one
Cloud Run deploy path, with no application-source rewrite to switch.

**Independent Test**: In a `static` copy, build yields deployable assets servable with no running
server and no API routes. In a `server` copy, Express serves the frontend and the sample API route
responds. Switching the mode changes behavior without source edits (SC-002).

### Tests for User Story 2

- [X] T022 [P] [US2] Integration test `tests/integration/server.test.ts` (server mode): build a `dist/` fixture (or run the build in test setup), start `src/server.ts` with `DEPLOY_MODE=server`, assert built frontend is served AND the `health` route returns 200 — covers contract C3
- [X] T023 [P] [US2] Integration test in `tests/integration/server.test.ts` (static mode): with a built `dist/` and `DEPLOY_MODE=static`, assert files are served AND the `health` route is absent (404) — covers contracts C2, C4

### Implementation for User Story 2

- [X] T024 [US2] Create `src/routes/health.ts`: a sample `GET /api/health` route (demonstrative, not business logic — FR-012) mounted only in server mode by `src/server.ts`
- [X] T025 [US2] Implement the `build` script branching on `DEPLOY_MODE`: `static` → `vite build` only (no server bundle); `server` → `vite build` + backend emit via `tsconfig.build.json` — satisfies FR-003, FR-004, acceptance scenarios US2-1/US2-2
- [X] T026 [US2] Confirm mode switch requires no application source edits — only `DEPLOY_MODE` + deploy target change — satisfies FR-005, SC-002, acceptance scenario US2-3, contract C4
- [X] T027 [P] [US2] Create `Dockerfile` (Node 24 base; build + run `src/server.ts`; serves files, +API in server mode) and `.dockerignore` — satisfies FR-004a, contract C6
- [X] T028 [P] [US2] Create `scripts/deploy.sh` (wraps `gcloud run deploy`) and `cloudbuild.yaml` for the one Cloud Run path used by both modes — satisfies FR-004a, FR-003, contract C6
- [X] T029 [US2] Document in `README.md` the Cloud Run default for both modes AND the Cloud Storage + Cloud CDN performance-only opt-in for static apps — satisfies FR-003a, contract C6

**Checkpoint**: Both modes build and serve from one unmodified copy by changing only `DEPLOY_MODE`.

---

## Phase 5: User Story 3 - Static content is prerendered, not client-rendered (Priority: P2)

**Goal**: In static mode, build-time-known content is rendered to real HTML at build time, not
shipped as an empty shell; CSR remains available for runtime-driven apps.

**Independent Test**: Build a static-mode app with known content; confirm the output HTML contains
the rendered markup (not an empty root element) — SC-003, contract C2.

### Tests for User Story 3

- [X] T030 [P] [US3] Build-output test `tests/integration/prerender.test.ts`: run the static build, read the emitted HTML, assert it contains the rendered content from `App.tsx` (not an empty `<div id="root">`) — covers contract C2, SC-003

### Implementation for User Story 3

- [X] T031 [US3] Create `src/web/prerender.tsx`: a build-time render step using `react-dom/server` `renderToString` that takes a **list of entry pages** (one for a single-purpose app, several for a multi-page app) and renders each to static HTML — no SSG plugin — satisfies FR-006
- [X] T032 [US3] Wire the prerender step into the static `build` path: for each entry, inject its `renderToString` output into the Vite HTML template, emitting one HTML file per entry in `dist/`; keep CSR available for opt-in runtime-driven apps. (Request-dependent pages use SSR in server mode via the same API — out of scope for the default path.) — satisfies FR-006, acceptance scenarios US3-1/US3-2
- [X] T033 [US3] Document in `README.md` the prerender-by-default behavior and how an app opts into CSR — satisfies FR-006

**Checkpoint**: Static build emits real HTML for known content; CSR opt-in path documented.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final validation that the skeleton meets every success criterion and stays a skeleton.

- [X] T034 Run the full `quickstart.md` walkthrough end-to-end on a fresh clone; fix any step that exceeds 5 minutes or requires undocumented configuration — validates SC-001
- [X] T035 Run `npm run check:all` and confirm format/lint/typecheck/test all pass on the clean skeleton — validates SC-004, contract C5
- [X] T036 Review the repo for application-specific business logic; confirm only demonstrative content remains (App.tsx sample page, health sample route) — validates FR-012, SC-005, contract C7
- [X] T037 [P] Confirm the spec artifacts (spec.md, research.md) stay consistent with the built skeleton; note any drift
- [X] T038 Verify no shipped file (`README.md`, `src/`, `tests/`, scripts, `Dockerfile`) references the spec workflow — no "FR-0xx", spec numbers, Principle names, or User Story IDs. Shipped files state rules directly

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Stories (Phase 3–5)**: All depend on Foundational completion.
  - US1 (P1) and US2 (P1) are both MVP-critical; US2 depends on the mode switch from Phase 2 but not on US1.
  - US3 (P2) depends on Phase 2 and is naturally validated after US2's static build exists.
- **Polish (Phase 6)**: Depends on all targeted stories being complete.

### User Story Dependencies

- **US1 (P1)**: After Foundational. No dependency on other stories.
- **US2 (P1)**: After Foundational. Independent of US1 (uses the same `mode.ts` + `server.ts`).
- **US3 (P2)**: After Foundational; its build-output test (T030) presumes the static `build` path from US2 (T025) exists — sequence US2 before US3 if running serially.

### Within Each User Story

- Tests (T017/T018, T022/T023, T030) are written to FAIL first, then implementation makes them pass.
- `src/mode.ts` and `src/server.ts` (Phase 2) before any story that branches on mode.
- Build scripts before build-output tests.

### Parallel Opportunities

- Setup: T003, T005, T006, T007, T008, T009 are all [P] (different files).
- US1 tests T017 and T018 run in parallel.
- US2 tests T022 and T023 are [P]; deploy artifacts T027 and T028 are [P].
- With two developers post-Foundational: Dev A takes US1, Dev B takes US2; US3 follows US2.

---

## Parallel Example: User Story 2

```bash
# Launch both US2 tests together (they exercise different modes / assertions):
Task: "Integration test (server mode) in tests/integration/server.test.ts"
Task: "Integration test (static mode) in tests/integration/server.test.ts"

# Build the deploy artifacts in parallel (different files):
Task: "Create Dockerfile + .dockerignore"
Task: "Create scripts/deploy.sh + cloudbuild.yaml"
```

---

## Implementation Strategy

### MVP First (US1 + US2 — both P1)

1. Phase 1: Setup
2. Phase 2: Foundational (mode switch + serve pipeline — CRITICAL)
3. Phase 3: US1 (spin-up renders + quality gates green)
4. Phase 4: US2 (both deploy modes build/serve from one copy)
5. **STOP and VALIDATE**: a fresh copy spins up in <5 min and both modes work. This is the template's MVP.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. US1 → fresh-copy spin-up works → demo (the minimum viable template).
3. US2 → static/server both deploy via Cloud Run → demo.
4. US3 → prerender default for static content → demo.
5. Polish → validate all success criteria on a clean clone.

---

## Notes

- This is a **template skeleton**: "implementation" establishes reusable structure, not app features.
  Any sample content (App.tsx page, health route) exists only to prove the skeleton works.
- **Speckit stays out of shipped files**: the FR/SC/contract citations in the task descriptions
  above are for traceability within this (speckit-space) file. The files those tasks *produce* —
  `README.md`, `src/`, `tests/`, scripts, `Dockerfile` — MUST state rules directly and MUST NOT
  cite FRs, spec numbers, Principle names, or User Story IDs. The shipped skeleton reads as a
  self-contained codebase. (T038 verifies this.)
- [P] tasks = different files, no dependencies.
- Verify each test fails before implementing the code that satisfies it.
- Commit after each task or logical group (commits carry no attribution per current settings).
- The `@snackbyte/ui` shared-identity layer is OUT OF SCOPE here (extracted later from snackbyte-site).

## Implementation deviations (recorded honestly)

All 38 tasks are complete. A few implementation choices differed from the task text
because the installed tool versions or runtime required it:

- **T008/eslint config** is `config/eslint.config.js` (ESM flat config), not `.ts` —
  avoids needing a TS loader to read the lint config. Added a `globals` dependency so
  Node/browser globals resolve.
- **T014/Vitest env**: `environmentMatchGlobs` is deprecated in the installed Vitest
  3.2. Implemented as a global `jsdom` environment with a per-file
  `// @vitest-environment node` pragma on the server/prerender integration tests.
- **JSX runtime**: the build's prerender step runs `.tsx` under `tsx`, which needed
  `--tsconfig tsconfig.web.json` (automatic JSX runtime) plus `jsx: react-jsx` in the
  base tsconfig; `src/web/prerender.tsx` uses `createElement` rather than JSX.
- **Express 5**: the SPA fallback route is `/*splat` (named wildcard), not `'*'` —
  Express 5 / path-to-regexp v8 rejects the bare star.
- **Stack versions** resolved to current majors (React 19, Express 5, Vite 8, Vitest
  3, TypeScript 6) rather than the versions implied at planning time; no behavior gap.
- **T024 health route** was pulled forward into Phase 2 because `src/server.ts` wires
  it as a foundational dependency. **T031/T032 prerender** were pulled forward into
  Phase 4 because the build script depends on them.
