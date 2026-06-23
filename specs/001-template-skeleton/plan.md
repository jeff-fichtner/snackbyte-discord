# Implementation Plan: snackbyte-base Template Skeleton

**Branch**: `001-template-skeleton` | **Date**: 2026-05-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-template-skeleton/spec.md`

## Summary

Establish `snackbyte-base` as a single reusable GitHub-template skeleton: Vite +
React + TypeScript, an Express server present in the skeleton, a `static`/`server`
deploy-mode switch chosen once at spin-up, Vitest tests, ESLint + Prettier, a pinned
Node 24 LTS runtime, and Cloud Run deploy artifacts for both modes. The skeleton
carries conventions (folder structure, tooling, scripts, the mode switch, deploy
artifacts) but no application-specific business logic. Conventions are a stripped,
React-and-Vitest-adapted subset of the proven `tonic` app.

## Technical Context

**Language/Version**: TypeScript ~5.9 on Node 24 LTS (pinned via `.nvmrc` +
`package.json` `engines`).

**Primary Dependencies**: Vite (build/dev), React + ReactDOM (UI), Express (server
mode), Vitest (test). Frontend prerender for build-time-known static content.

**Storage**: N/A — the skeleton ships no datastore. Apps add their own in server mode.

**Testing**: Vitest (reuses `vite.config`, ESM-native). Replaces tonic's Jest +
ts-jest + jsdom.

**Target Platform**: Google Cloud Run (containerized) for both deploy modes;
Artifact Registry for images. Cloud Storage + Cloud CDN is a documented
performance-only opt-in for static apps.

**Project Type**: Web application — a single repo containing a React frontend and an
Express backend that share one build pipeline, with the backend optional at deploy
time (the mode switch).

**Performance Goals**: Spin-up to running dev server in under 5 minutes (SC-001);
React + ReactDOM (~45KB gzipped) is acceptable; static content is prerendered so
first paint does not wait on JS.

**Constraints**: Single template (no forks); mode switch MUST NOT require application
source rewrites (FR-005); skeleton MUST contain no business logic (FR-012); one
deploy path (Cloud Run) for both modes (FR-003/FR-004).

**Scale/Scope**: One solo maintainer; one skeleton consumed by many independent
subdomain apps. Multi-contributor workflows out of scope for v1.

No NEEDS CLARIFICATION items remain — all technical choices are fixed by the
constitution, the spec, and `research.md`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Plan compliance |
|---|---|
| I. Single Template, Mode Switch | One skeleton; mode is a single config value (`DEPLOY_MODE`) in one discoverable location; no source rewrite to switch. ✅ |
| II. Convention Over Configuration | Pre-wired lint/format/typecheck/test scripts; documented spin-up <5 min; no tooling re-decisions. ✅ |
| III. Skeleton Only — No Application Logic | Only demonstrative content that proves the skeleton (a prerendered sample page, a sample API route guarded behind server mode). No domain logic. ✅ |
| IV. Two-Tier Propagation | Skeleton concerns only; visual identity deferred to `@snackbyte/ui` (out of scope here). ✅ |
| V. Uniform Deploy Path (Cloud Run Default) | Ships `Dockerfile`, `.dockerignore`, deploy script; both modes deploy to Cloud Run; CDN documented as opt-in. ✅ |
| VI. Prerender By Default | Static-mode build prerenders build-time-known content to HTML; CSR available but not default. ✅ |
| VII. Pinned, Linted, Type-Safe, Tested | Node 24 LTS pinned; TypeScript throughout; ESLint + Prettier + Vitest runnable on fresh copy; `.gitignore` excludes artifacts/deps/env. ✅ |

**Result**: PASS. No violations; Complexity Tracking left empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-template-skeleton/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── deploy-mode.md   # The DEPLOY_MODE contract + script behavior contract
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

The skeleton is a single web-app repo with a shared build pipeline and an optional
backend. Layout is a stripped, React-adapted subset of `tonic`'s conventions
(`config/` holds tooling configs; `src/server.ts` is the Express entry; `src/web/`
is the frontend; tests sit beside a `tests/` tree).

```text
snackbyte-base/
├── .nvmrc                      # Node 24 LTS pin
├── package.json                # engines.node, scripts (dev/build/lint/format/typecheck/test), deps
├── tsconfig.json               # base TS config (shared)
├── tsconfig.web.json           # frontend (DOM lib, JSX)
├── tsconfig.build.json         # backend emit for server mode
├── vite.config.ts              # Vite + React plugin; Vitest `test` block; prerender of build-time content
├── Dockerfile                  # single container for both modes (serves files; +API in server mode)
├── .dockerignore
├── .gitignore                  # excludes node_modules, dist, .env*, build output
├── .env.example                # documents DEPLOY_MODE, PORT
├── README.md                   # spin-up steps + static-vs-server mode choice
├── config/                     # tooling configs (eslint, prettier)
│   ├── eslint.config.ts
│   └── .prettierrc.json
├── scripts/
│   └── deploy.sh               # gcloud run deploy wrapper (mode-aware)
├── cloudbuild.yaml             # optional Cloud Build CI
├── src/
│   ├── server.ts               # Express entry — serves built frontend; mounts API routes in server mode
│   ├── mode.ts                 # reads/derives DEPLOY_MODE (single discoverable source)
│   ├── routes/
│   │   └── health.ts           # sample API route (server mode only) — proves the path, not business logic
│   └── web/                    # React frontend
│       ├── index.html          # Vite HTML entry (root div + module script); prerender injects into it
│       ├── main.tsx            # client entry / hydration
│       ├── App.tsx             # sample prerendered page (proves prerender, not domain content)
│       └── prerender.tsx       # build-time render entry for static prerendering
└── tests/
    ├── unit/
    │   └── mode.test.ts        # mode resolution
    └── integration/
        └── server.test.ts      # server serves built frontend; health route in server mode
```

**Structure Decision**: Single web-app repo (frontend + optional backend sharing one
build pipeline). Chosen over a two-package split because the mode switch must keep
both paths in one unmodified skeleton (Principle I); a split would reintroduce the
two-template problem the constitution forbids. `config/`, `src/server.ts`,
`src/web/`, and `tests/` mirror tonic's proven conventions; React, Vitest, the
`mode.ts` switch, and the prerender entry are the new work.

## Complexity Tracking

> No constitution violations. Section intentionally empty.
