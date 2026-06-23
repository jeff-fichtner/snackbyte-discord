# Implementation Plan: Derived-Tag Versioning & Branch-as-Environment Staging

**Branch**: `main` (feature dir `002-derived-tag-staging`) | **Date**: 2026-06-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-derived-tag-staging/spec.md`

## Summary

Build derived-tag versioning + branch-as-environment staging into the template **as the polished,
designed-in model** (the template is the source of truth). The infra/runtime pieces are ported from
snackbyte-site's proven-live as-built files; the versioning derivation is a **refinement** — a symmetric
`git tag --points-at HEAD` reuse + global-max advance + promotion gate that supersedes snackbyte-site's
jamming `git describe` ancestry logic, and is verified by fresh spin-up (not assumed proven). CI commits
nothing; the patch is a global build-id derived from tags. The work: **build the template clean** (the
`ci-cd` workflow, cloudbuild.yaml, Dockerfile/vite/prerender build-args, noindex middleware, deploy.sh,
branch-protection setup, `init.mjs` rework, DEPLOY.md), then **verify by spinning a fresh app**.
snackbyte-site (the guinea pig / direct extension, not a downstream consumer) provides a live feedback
loop — defects found there fold back into the template. Existing apps are rebuilt, not migrated (nothing
is in production use); there is no migration tooling, and downstream consumer apps are out of frame.

## Technical Context

**Language/Version**: TypeScript ~5.9+ on Node 24 LTS (unchanged). Shell (bash) for the CI derivation;
YAML for the workflow; Dockerfile; `gcloud`/`gh` for infra/branch-protection (documented, not executed by
the template).

**Primary Dependencies**: Vite + React (frontend), Express (server mode), Vitest (test) — unchanged. New
surface is build/release tooling: GitHub Actions, Cloud Build (`cloudbuild.yaml`), Docker build-args,
GitHub branch protection.

**Storage**: N/A — git tags are the version store (the patch lives in tags + the built image +
`/api/version`, never in `package.json`).

**Testing**: Vitest for the runtime invariants (env label, noindex middleware, chip build-arg). The
derivation logic is verified by a **fresh-app spin-up** exercising the acceptance matrix (and the
snackbyte-site feedback loop), not by unit tests — it is git/CI behavior, not in-process code.

**Target Platform**: Google Cloud Run behind the shared global external HTTPS LB; Artifact Registry for
images; Certificate Manager cert-map for TLS (unchanged platform, corrected runbook).

**Project Type**: Template/skeleton repo (web app: React frontend + optional Express backend, shared
build) plus its release/deploy tooling. This feature touches the tooling tier primarily.

**Performance Goals**: N/A (build/release tooling). Spin-up-to-running remains <5 min (Principle II).

**Constraints**: Prod path byte-identical for non-staging apps (NFR-001); `check:all` green after changes
(NFR-002); `SPINUP:` mode axes preserved (NFR-003); no spec/FR citations in shipped files (Principle
VIII / FR-028); CI commits nothing (FR-003); collisions structurally impossible (global-max, FR-006).

**Scale/Scope**: One solo maintainer; one template consumed by many apps. ~9 template files (workflow,
cloudbuild, Dockerfile, vite/prerender, server, deploy.sh, init.mjs, package.json, DEPLOY.md). No
NEEDS CLARIFICATION items — the design is fully resolved in the spec (the divergence log + the locked
versioning model).

## Constitution Check

*GATE: Must pass before Phase 0. Re-check after Phase 1.*

| Principle | Compliance |
|---|---|
| I. Single Template, Mode Resolved at Spin-Up | No new mode axis. Staging is **always-on** (both branch triggers ship); the `--points-at HEAD` check is the runtime switch, not a spin-up flag. The mode (static/server, prerender/dynamic) axes are untouched. ✅ |
| II. Convention Over Configuration | Apps inherit the release flow with zero re-decisions. Branch protection is a one-time documented `gh api` step. No new per-app tooling choices. ✅ |
| III. Skeleton Only — No Application Logic | All additions are build/release plumbing + a generic noindex middleware. No domain logic. The `deploy` job's concrete GCP values stay per-app/doc, not shipped. ✅ |
| IV. Two-Tier Propagation | This is a skeleton concern (toolchain/CI/deploy). Existing apps adopt it by re-spinning from the template (the tier-1 "one-time copy" path), not by in-place backport — appropriate since nothing is in production use. ✅ |
| V. Uniform Deploy Path (Cloud Run Default) | Same Cloud Run path; `cloudbuild.yaml` is the documented Cloud Build config Principle V already anticipates. ✅ |
| VI. Prerender By Default | `prerender.mjs` change only swaps the version/chip source (build-arg vs package.json); prerender remains default and must stay byte-identical for prod (NFR-001). ✅ |
| VII. Pinned, Linted, Type-Safe, Tested | Node 24 pin unchanged; `check:all` must pass after changes (NFR-002); new runtime behavior (noindex, env label, chip) gets Vitest coverage. ✅ |
| VIII. Speckit Stays in Speckit Spaces | **Active constraint.** snackbyte-site's as-built files carry `see spec 001 (FR-…)` citations; porting MUST strip them and restate the rule (FR-028). The two old-app docs and DEPLOY.md must not cite the spec workflow. The resolver must leave no spec references. Enforced as an explicit implementation rule + a verification grep. ✅ (by construction) |

**Result**: PASS. No violations; Complexity Tracking empty. Principle VIII is the one to actively police
during porting — captured as a task and a verification step.

## Project Structure

### Documentation (this feature)

```text
specs/002-derived-tag-staging/
├── plan.md              # This file
├── research.md          # Phase 0 — design decisions already settled (consolidates the locked model)
├── quickstart.md        # Phase 1 — how an app uses staging + how to verify
├── contracts/
│   ├── versioning.md    # The derivation contract (inputs → tag), incl. all traced scenarios
│   └── deploy-env.md    # The runtime/build env contract (APP_ENV, APP_IS_PRODUCTION, APP_VERSION, noindex)
└── checklists/
    └── requirements.md  # Spec quality checklist (done)
```

### Source Code (repository root) — files this feature changes

```text
snackbyte-base/
├── .github/workflows/
│   ├── main.yml                 # DELETE → replaced by ci-cd.yml
│   └── ci-cd.yml                # NEW — dual-branch triggers; validate + version-and-tag;
│                                #       derived-tag (--points-at HEAD reuse + global-max advance);
│                                #       guards (fetch-depth:0, anchored regex, fail-loud, concurrency).
│                                #       SHIPS validate + version-and-tag only; deploy job is per-app/doc.
├── cloudbuild.yaml              # NEW — stamp date; build with APP_VERSION/APP_IS_PRODUCTION/commit/date
│                                #       build-args; tag image vX.Y.Z[-dev]-sha; deploy with runtime env
│                                #       (NODE_ENV=production, APP_ENV only-when-nonempty). Per-target subs.
├── Dockerfile                   # +ARG APP_VERSION, +ARG APP_IS_PRODUCTION; thread into the build step.
├── vite.config.ts               # __APP_VERSION__ from APP_VERSION build-arg (drop pkgVersion read);
│                                #       __IS_PRODUCTION__ from APP_IS_PRODUCTION (not NODE_ENV).
├── scripts/
│   ├── prerender.mjs            # Mirror vite.config.ts exactly (APP_VERSION + APP_IS_PRODUCTION).
│   ├── deploy.sh                # Reconcile: version is passed/derived, NOT from package.json patch.
│   └── init.mjs                 # Rework workflow rewrite: emit ci-cd (no AUTO_BUMP / commit-bump /
│                                #       [skip ci]); app-appropriate header, no spin-up references.
├── src/
│   ├── version.ts               # ALREADY DONE (APP_ENV ?? NODE_ENV) — verify + add test coverage.
│   ├── web/version.ts           # VERIFY only: chip `display` reads __IS_PRODUCTION__ (build-keyed);
│   │                            #       no change expected, confirm prod-default unchanged.
│   └── server.ts                # +noindex middleware keyed on APP_ENV==='staging' (mode-agnostic,
│                                #       OUTSIDE the SPINUP:server-only markers).
├── package.json                 # Version → MAJOR.MINOR form (patch dropped from the file's meaning).
├── DEPLOY.md                    # Replace obsoleted staging/commit-bump sections; document the locked
│                                #       model, promotion gate, build-id trade-offs, branch-protection
│                                #       setup, corrected infra runbook (cert-map/DNS-auth/invoker).
└── tests/                       # +coverage: env label, noindex header, chip build-arg behavior.
```

No migration/backport docs are produced (existing apps are re-spun, not migrated). The snackbyte-site
feedback loop happens in that sibling repo, not here; downstream consumer apps are out of frame.

**Structure Decision**: Single template repo; this feature concentrates on the release/deploy tooling
tier (CI workflow, Cloud Build, Docker build-args) plus two runtime touch-points (the noindex middleware
and the already-done env label). The app-specific `deploy` job and all GCP resource creation stay in
documentation, never shipped — preserving Principle III. The template is the source of truth; existing
apps are re-spun from it.

## Execution (build → verify → re-spin)

The template is built clean, then verified; nothing gates on a live system first.

- **Build the template.** Author the `ci-cd.yml` with the refined derivation (`--points-at HEAD` reuse +
  global-max advance + promotion gate); add `cloudbuild.yaml`; thread build-args
  (Dockerfile/vite/prerender); add the noindex middleware; reconcile `deploy.sh`; set `package.json` to
  MAJOR.MINOR; rework `init.mjs`; rewrite `DEPLOY.md`. Strip all Principle-VIII citations during porting.
  Keep prod byte-identical (NFR-001); `check:all` green (NFR-002).
- **Verify by fresh spin-up.** Spin a fresh app and run the acceptance matrix
  ([contracts/versioning.md](contracts/versioning.md), SC-001..SC-008): derived-tag versioning, staging
  deploy + noindex, FF promotion, resume-direct-to-main, the chip, the resolver, the gate.
- **Feedback loop via snackbyte-site** (the guinea pig / direct extension — not a downstream consumer).
  Exercise the model there; if a live defect surfaces, **fold it back into the template** (feedback path,
  not a blocker).

## Complexity Tracking

> No constitution violations. Section intentionally empty.
