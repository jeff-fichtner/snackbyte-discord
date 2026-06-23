---
description: "Task list for derived-tag versioning & branch-as-environment staging"
---

# Tasks: Derived-Tag Versioning & Branch-as-Environment Staging

**Input**: Design documents from `/specs/002-derived-tag-staging/`

**Prerequisites**: plan.md, spec.md, research.md, contracts/ (versioning.md, deploy-env.md), quickstart.md

**Tests**: Included — the spec requires Vitest coverage of the runtime invariants (env label, noindex,
chip) and `check:all` green (NFR-002), plus verification by spinning a fresh app.

**Organization**: This is a template-hardening feature. Several files serve multiple user stories at once
(the `ci-cd.yml` workflow + `cloudbuild.yaml` + Dockerfile build-args underpin US1/US2/US3 together), so
that shared versioning/build core lives in Foundational. Story phases then layer the
environment-specific behavior, the resolver, the runbook, and verification on top.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no incomplete dependencies)
- **[Story]**: US1–US6 from spec.md; Setup/Foundational/Polish have no story label
- All paths are repo-root-relative in `snackbyte-base/`

## Constitution guardrails (apply to every code/doc task)

- **Principle VIII**: shipped files (`src/`, `scripts/`, `Dockerfile`, CI, `DEPLOY.md`, `cloudbuild.yaml`)
  MUST NOT cite spec/FR numbers or the spec workflow. When porting snackbyte-site's files, strip every
  `see spec 001 (FR-…)` citation and restate the rule directly. (FR-028)
- **NFR-001**: the prod path stays byte-identical for a non-staging app — defaults
  (`APP_IS_PRODUCTION=true`, empty `APP_ENV`) reproduce today's behavior.
- **NFR-003**: respect the `SPINUP:server-only` / `SPINUP:prerender-only` marker axes.

---

## Phase 1: Setup

**Purpose**: Establish the reference material and a clean working baseline.

- [X] T001 Open the three source references side-by-side for the port: snackbyte-site's as-built
      `.github/workflows/ci-cd.yml`, `cloudbuild.yaml`, `Dockerfile`, `vite.config.ts`,
      `scripts/prerender.mjs`, `src/server.ts` (proven-live infra/runtime), and this feature's
      `contracts/versioning.md` + `contracts/deploy-env.md` (the authoritative behavior). Confirm the
      `git rev-parse --is-shallow-repository` guard is available on `ubuntu-latest` (git ≥ 2.15).
- [X] T002 Confirm baseline `npm run check:all` is green on the current template before any change
      (so later breakage is attributable).

---

## Phase 2: Foundational — the versioning & build core (BLOCKS US1/US2/US3)

**Purpose**: The derived-tag workflow + the build-arg version pipeline. Every deploy/version user story
depends on this. This is the NEW, refined logic (not a verbatim port) — verify against
`contracts/versioning.md` carefully.

**⚠️ CRITICAL**: No user-story phase begins until Phase 2 is complete.

- [X] T003 Set `package.json` `version` to `MAJOR.MINOR` form (e.g. `1.1`) and update `package-lock.json`
      to match; the patch is no longer meaningful in the file. (FR-004)
- [X] T004 Author `.github/workflows/ci-cd.yml` (rename from `main.yml`; delete `main.yml`): name `ci-cd`;
      triggers `push` + `pull_request` on `[main, dev]`; jobs `validate (merge gate)` (PR-only, runs
      `check:all` on PRs) and `version-and-tag` (push-only). Do NOT ship a concrete `deploy` job (per-app —
      documented in `DEPLOY.md`, see T025). Remove `AUTO_BUMP`, `RELEASE_TOKEN`, and all
      commit-the-bump / `[skip ci]` logic. (FR-001, FR-002, FR-003, FR-010, FR-013)
- [X] T005 Implement the `version-and-tag` derivation in `ci-cd.yml` EXACTLY per `contracts/versioning.md`:
      checkout `fetch-depth: 0` + tags; **shallow guard** = fail iff `git rev-parse
      --is-shallow-repository` is `true` (NOT a commit-count heuristic); `MM` from package.json; reuse via
      `git tag --points-at HEAD` (opposite-suffix sibling) else **global-max** advance `max(all v<MM>.*)+1`;
      `dev`→`vMM.P-dev`, `main`→`vMM.P`; anchored regex parsing; fail-loud if the target tag already
      exists; `concurrency: group: version-${{ github.ref }}`, `cancel-in-progress: false`; push the TAG
      only (no commit, no branch push); emit `version`/`tag` outputs. (FR-005..008, FR-014..017)
- [X] T006 Re-run the gate: `version-and-tag` runs `check:all` on push and tags ONLY on pass (the
      authoritative backstop). (FR-011)
- [X] T007 [P] Add `APP_VERSION` + `APP_IS_PRODUCTION` build-args to `Dockerfile` (defaults `0.0.0` /
      `true`), threaded into the build step; keep `NODE_ENV=production` in the build so the real version is
      read. Strip any spec citations. (FR-023, deploy-env contract)
- [X] T008 [P] Author `cloudbuild.yaml`: stamp UTC build date; build forwarding
      `APP_VERSION`/`APP_IS_PRODUCTION`/`BUILD_GIT_COMMIT`/`BUILD_DATE`; tag image
      `${_SERVICE}:${TAG}-${SHORT_SHA}` (+ `:${TAG}`, `:latest`); push to Artifact Registry; `gcloud run
      deploy` setting runtime env (`NODE_ENV=production`, `APP_VERSION`, `BUILD_GIT_COMMIT`, `BUILD_DATE`,
      and `APP_ENV` **only when non-empty**); `logging: CLOUD_LOGGING_ONLY`; `images:`/`tags:` set;
      per-target subs `_SERVICE`/`_APP_ENV`/`_APP_IS_PRODUCTION` default to production. Strip citations.
      (FR-022, deploy-env contract)
- [X] T009 Update `vite.config.ts`: `__APP_VERSION__` from the `APP_VERSION` env (drop the `package.json`
      `pkgVersion` read); `__IS_PRODUCTION__` from `APP_IS_PRODUCTION` (NOT `NODE_ENV`). Keep the literal
      `globalThis.__X__` tokens for `define` substitution. (FR-009, FR-020, FR-021)
- [X] T010 Update `scripts/prerender.mjs` to read `APP_VERSION` and `APP_IS_PRODUCTION` **identically** to
      `vite.config.ts` (drop the package.json read) — or prerender/hydration will mismatch. (FR-021)

**Checkpoint**: The template builds an image whose version comes from a build-arg, and the workflow
derives/pushes tags with no commits. Foundation ready.

---

## Phase 3: User Story 1 — Derived-tag versioning with zero release plumbing (P1) 🎯 MVP

**Goal**: A spun-up app pushes to `main` and gets `vMM.P` tags with CI committing nothing; first push
mints the first tag; `package.json` untouched.

**Independent Test**: On a fresh app with no `dev` branch and no tags, a `main` push tags `vMM.0` with
`main` unmoved; a second push tags `vMM.1`; a failing `check:all` produces no tag.

- [X] T011 [US1] Verify the first-push path in `ci-cd.yml`: no tags + non-shallow clone ⇒ mint `vMM.0`
      (main) / `vMM.0-dev` (dev), regardless of commit count (acceptance rows 1/1d). (FR-007, FR-014)
- [X] T012 [US1] Verify the no-`dev` self-increment path: consecutive `main` pushes ⇒ `vMM.0`, `vMM.1`, …
      via global-max; CI commits nothing; `package.json` unchanged (acceptance rows 2/12; SC-001).
- [X] T013 [US1] Verify fail-loud + shallow guard: existing target tag ⇒ fail (no deploy); shallow
      checkout ⇒ fail (acceptance rows 6/11; SC-005 partial).

**Checkpoint**: Core derived-tag versioning works for any app, staging or not. **This is the MVP.**

---

## Phase 4: User Story 2 — Deploy to staging by pushing `dev` (P1)

**Goal**: Pushing `dev` derives `vMM.P-dev` and deploys staging with `APP_ENV=staging`; `/api/version`
reports the real number + `environment: staging`; the response carries `noindex`.

**Independent Test**: Push `dev` → `vMM.P-dev` on the pushed commit, staging serves the build, `dev`
unmoved; `/api/version` shows the real number + `staging` (never `0.0.0-dev`); response has
`X-Robots-Tag: noindex`.

- [X] T014 [P] [US2] Verify `src/version.ts` reports `environment = APP_ENV ?? NODE_ENV ?? 'development'`
      with `isBuild` still keyed on `NODE_ENV==='production'` (already in template — confirm + ensure the
      comment states the rule, no spec citation). (FR-018)
- [X] T015 [US2] Add the `noindex` middleware to `src/server.ts`: emit `X-Robots-Tag: noindex` when
      `process.env.APP_ENV === 'staging'`, registered before static/routes, **OUTSIDE** the
      `SPINUP:server-only` markers (mode-agnostic). Comment states the rule directly (no spec citation).
      (FR-019, NFR-003)
- [X] T016 [P] [US2] Add Vitest coverage in `tests/` for the env label (APP_ENV=staging + NODE_ENV=production
      ⇒ `environment:"staging"` with a real number) and the noindex middleware (header present under
      staging, absent otherwise). (FR-018, FR-019; SC-002)

**Checkpoint**: A `dev` push produces a labeled, noindex'd staging build with a real version.

---

## Phase 5: User Story 3 — Promote staging to production (P1)

**Goal**: Fast-forward `main` to the `dev` commit; CI reuses the `-dev` number (suffix dropped), deploys
prod with `environment: production` and no noindex; no second number minted.

**Independent Test**: FF `dev`→`main` ⇒ `main` reuses the on-HEAD `-dev` number, tags `vMM.P`, deploys
prod; same commit carries both tags; no `vMM.(P+1)`.

- [X] T017 [US3] Verify the reuse path in `ci-cd.yml`: a `-dev` sibling on HEAD ⇒ `main` reuses that patch,
      drops the suffix; the commit ends dual-tagged; no double-increment (acceptance row 5; SC-003).
- [X] T018 [US3] Verify resume-direct-to-main + dev-resync + global-max-jump (acceptance rows 7/8/9): these
      are the refinement over snackbyte-site's jamming `git describe`; confirm clean advance, not a jam.
- [X] T019 [US3] Verify prod posture: prod `/api/version` ⇒ `environment:"production"`, NO `X-Robots-Tag`;
      prod build hides the chip (defaults). (NFR-001; SC-003, SC-006 partial)
- [X] T020 [US3] Document the **promotion gate** (`main` ⊆ `dev`, fast-forwardable) — both as the
      branch-protection "require up to date before merging" option (see T024) and as the documented
      promotion reflex. (FR-008a)

**Checkpoint**: Full version stream (push dev → promote → prod) works on one commit with one number.

---

## Phase 6: User Story 4 — Distinguish staging from production at a glance (P2)

**Goal**: Staging shows the version chip + reports `environment: staging`; prod hides the chip + reports
`production`; never via `NODE_ENV`.

**Independent Test**: Staging-style build (`APP_IS_PRODUCTION=false`, `APP_ENV=staging`) shows the chip
in prerendered HTML + after hydration; prod-default build is byte-identical to pre-feature.

- [X] T021 [P] [US4] Add Vitest/build coverage that the staging-style build (`APP_IS_PRODUCTION=false`)
      renders the chip in prerendered HTML and the client bundle (no hydration mismatch), and the
      prod-default build (`APP_IS_PRODUCTION=true`) omits it. (FR-020, FR-021; SC-006)
- [X] T022 [US4] Confirm the chip's `display` logic in `src/web/version.ts` reads `__IS_PRODUCTION__`
      (build-keyed) and the prod-default prerendered HTML is unchanged from pre-feature (NFR-001 diff
      check).

**Checkpoint**: Environment is legible at a glance, build-keyed, with prod unchanged.

---

## Phase 7: User Story 5 — Stand up staging infra from a correct runbook (P2)

**Goal**: `DEPLOY.md` reflects the corrected GCP reality so an operator avoids the cert-SAN no-op, the LB
403, and the SAN-validation dead end.

**Independent Test**: An operator with only `DEPLOY.md` can stand up a second-TLD staging env without
hitting any of the three known traps; each is pre-warned with the correct path.

- [X] T023 [US5] Rewrite `DEPLOY.md` versioning sections: replace the obsoleted commit-the-bump model AND
      the earlier `## Staging environment` recommendation (which described `--no-ff`/`[skip ci]`/
      branch-scoped-bump). Document: the symmetric `--points-at HEAD` reuse + global-max advance; patch =
      **global build-id** (gaps/cross-branch influence normal); the promotion gate + why; the build-id
      trade-offs; the tag-pushed-but-deploy-failed recovery (re-run the `deploy` job alone). No spec
      citations. (FR-027; Clarification 2026-06-09)
- [X] T024 [US5] Add the **branch-protection setup** to `DEPLOY.md` (a `gh api` call/procedure): require
      the `validate (merge gate)` check context (the **job name**) on `main` + `dev`;
      `required_pull_request_reviews=null`; `enforce_admins=false`; `allow_force_pushes=true`; optionally
      "require branches up to date before merging" to enforce the promotion gate. (FR-012, FR-008a)
- [X] T025 [US5] Add the **corrected infra runbook** to `DEPLOY.md`: Certificate Manager **cert-map +
      per-domain DNS authorization + `*.<tld>` wildcard** (NOT a SAN on the classic cert); `allUsers
      run.invoker` **in addition to** LB-only ingress (name the Google-HTML 403 as the missing-invoker
      signature); registrar-gated manual DNS (apex `A` + `_acme-challenge` CNAME, TTL 600); the per-app
      `deploy` job (project/SA/WIF/connected-repo) the template intentionally does NOT ship; reuse of the
      existing WIF pool + deploy SA. No spec citations. (FR-002, FR-027; SC-008)
- [X] T026 [P] [US5] Reconcile `scripts/deploy.sh` (manual no-CI deploy): it MUST NOT imply the patch
      comes from `package.json`; document that a manual deploy's version is whatever is passed, not a
      `package.json` patch. Strip citations. (FR-024)

**Checkpoint**: The runbook is correct end-to-end; an operator can stand up staging without the known
traps.

---

## Phase 8: User Story 6 — Spin-up resolver produces a coherent app (P2)

**Goal**: `scripts/init.mjs` emits the derived-tag `ci-cd` workflow with no `AUTO_BUMP`/commit-bump/
`[skip ci]` and no template/spin-up references; resolved app is green.

**Independent Test**: Run the resolver on a fresh copy → workflow is `ci-cd`, no `AUTO_BUMP`/`chore:
release`; `npm run check:all` passes.

- [X] T027 [US6] Rework `scripts/init.mjs`: replace the old workflow-rewrite block (which flipped
      `AUTO_BUMP` and rewrote the commit-the-bump header) with logic appropriate to `ci-cd.yml` — an
      app-appropriate header, no `AUTO_BUMP`/`[skip ci]`/commit-bump, no template/spin-up references, no
      dangling reference to the resolver after it self-deletes. (FR-025, Principle VIII)
- [X] T028 [US6] Update/extend the resolver's machinery tests (`tests/machinery/init.test.ts` pre-resolve)
      so they assert the resolved workflow is `ci-cd` with none of the old-model markers, then run the
      resolver on a throwaway copy and confirm `check:all` passes. (FR-026; SC-007)

**Checkpoint**: A freshly spun-up app describes and runs the new model coherently.

---

## Phase 9: Polish & Verification

**Purpose**: Cross-cutting correctness, the Principle VIII sweep, and the fresh-app acceptance run.

- [X] T029 [P] Principle VIII sweep: grep all shipped files (`src/`, `scripts/`, `Dockerfile`, `.github/`,
      `cloudbuild.yaml`, `DEPLOY.md`) for `spec`, `FR-`, `NFR-`, `001-staging`, `002-derived` — ensure ZERO
      citations survive; restate any found rule directly. (FR-028)
- [X] T030 Run `npm run check:all` on the template; fix until green (format, lint, typecheck, all Vitest).
      (NFR-002)
- [X] T031 [P] Update `CLAUDE.md` SPECKIT pointer if needed and confirm no stale `main.yml` references
      remain anywhere in the repo (the file is now `ci-cd.yml`).
- [X] T032 **Fresh-app verification**: spin a throwaway app from the template and run the acceptance matrix
      (`contracts/versioning.md` rows 1–12) + SC-001..SC-009: first push mints `vMM.0`; `dev` push →
      staging + noindex + real number; **FF promote triggers the prod deploy (no `[skip ci]` skip — SC-004)**
      → `vMM.P` reuse, prod, no noindex; resume-direct-to-main advances (no jam); chip shows on staging,
      absent on prod; failing-`check:all` PR blocked (branch protection applied). Record results; any
      divergence is a fix-back task. (SC-001..SC-009)
- [ ] T033 **snackbyte-site feedback loop** (sibling repo, NOT this repo; optional, post-verify): exercise
      the refined model on snackbyte-site (the guinea pig / direct extension); fold any live defect back
      into the template. Not a blocker. (Context — feedback path)

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (P1)** → no deps.
- **Foundational (P2)** → depends on Setup; **BLOCKS US1/US2/US3** (the workflow + build pipeline are the
  shared core).
- **US1 (P3)** → depends on Foundational. The MVP; pure-`main` versioning.
- **US2 (P4)** → depends on Foundational. Staging label + noindex layer on the version pipeline.
- **US3 (P5)** → depends on Foundational + US2 (a promotion presupposes a `-dev` tag exists to reuse).
- **US4 (P6)** → depends on Foundational (the `APP_IS_PRODUCTION` build-arg). Independent of US2/US3.
- **US5 (P7)** → docs/runbook; depends on the workflow/cloudbuild existing (Foundational) so it documents
  the real artifacts. Largely parallelizable with US2–US4.
- **US6 (P8)** → depends on the final `ci-cd.yml` (Foundational + US1 stable) so the resolver rewrites the
  real workflow.
- **Polish (P9)** → after all desired stories; T032 verification is the gate on "done."

### Within the foundational core

- T003 (package.json) before T005 (derivation reads `MM`).
- T004 (workflow skeleton) before T005 (derivation lives in it).
- T007 (Dockerfile args) + T008 (cloudbuild) before T009/T010 (which assume the build-args flow).
- T009 and T010 MUST stay identical (FR-021).

### Parallel opportunities

- T007 [P] + T008 [P] (Dockerfile / cloudbuild — different files) can run together once T004 exists.
- T014 [P] + T016 [P] (version.ts verify / tests) parallel within US2.
- T021 [P] (chip tests) parallel within US4.
- T026 [P] (deploy.sh) parallel within US5.
- US4, US5 (docs), and the US2 test tasks can largely proceed in parallel after Foundational.
- T029 [P] + T031 [P] in Polish.

---

## Parallel Example: Foundational build pipeline

```bash
# After T004 (ci-cd.yml skeleton) exists, the build-arg pipeline files are independent:
Task: "T007 Add APP_VERSION + APP_IS_PRODUCTION build-args to Dockerfile"
Task: "T008 Author cloudbuild.yaml with per-target substitutions"
# Then T009 + T010 must be authored as a matched pair (identical reads).
```

---

## Implementation Strategy

### MVP (User Story 1 only)

1. Phase 1 Setup → Phase 2 Foundational (the versioning core) → Phase 3 US1.
2. **STOP and VALIDATE**: a `main`-only app derives `vMM.0`, `vMM.1`, CI commits nothing, first push
   mints the first tag, fail-loud/shallow guards hold. This alone is a shippable improvement (every app
   gets clean derived-tag versioning even without staging).

### Incremental delivery

1. Foundational → US1 (MVP: derived-tag versioning) → validate.
2. US2 (staging deploy + noindex + label) → validate.
3. US3 (promotion) → validate the full version stream.
4. US4 (chip), US5 (runbook), US6 (resolver) → each validates independently.
5. Polish T032 fresh-app verification = the acceptance gate.

### Notes

- The **versioning derivation (T005)** is NEW work refined from snackbyte-site, NOT a verbatim port —
  verify it against `contracts/versioning.md`'s 12-row matrix, especially rows 5/7/9/10.
- Commit after each task or logical group; keep the prod path byte-identical (NFR-001) at every step.
- The `deploy` job is per-app and lives in `DEPLOY.md` (T025), never shipped with real GCP values.
