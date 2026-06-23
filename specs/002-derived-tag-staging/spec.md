# Feature Specification: Derived-Tag Versioning & Branch-as-Environment Staging

**Feature Branch**: `002-derived-tag-staging`

**Created**: 2026-06-08

**Status**: Draft

**Input**: Harden snackbyte-base by adopting the derived-tag versioning + branch-as-environment
(staging) model proven live on the snackbyte-site guinea-pig app.

## Context & Intent *(non-normative, read first)*

This feature builds derived-tag versioning + branch-as-environment staging into the template **as
the polished, designed-in-from-the-start model** — the template is the single source of truth. The
work draws on two distinct inputs, with different evidentiary weight:

- **Infrastructure & runtime findings — proven live.** snackbyte-site (the guinea pig) stood the
  staging path up against real GCP/LB/GitHub. Its `specs/001-staging-environment/spec.md` Divergence
  Log is the authoritative record of what the original template recommendation got *wrong* and what
  actually works on real infrastructure: the cert-map + per-domain DNS authorization (not a SAN on a
  classic cert), the `allUsers run.invoker` requirement (LB-only ingress 403s without it), the
  `NODE_ENV`-labeling trap, the build-keyed chip. These are **proven-live** and adopted verbatim.
- **The versioning derivation — designed clean, NOT yet proven-live.** The symmetric
  `--points-at HEAD` + global-max model is a deliberate **refinement** of (not a copy of)
  snackbyte-site's as-built logic, which uses `git describe` ancestry and *jams* on resume-direct-to-
  `main`. This refined derivation is **proven-in-logic only**; it is verified by spinning a fresh app
  from the finished template. snackbyte-site — the guinea pig, a direct extension of the template (not a
  downstream consumer) — provides the live feedback loop: if exercising the model there surfaces a real
  defect, it is folded back into the template. A feedback path, not a precondition.

Two facts shape everything below:

1. **Derived-tag versioning supersedes the old commit-the-bump model.** The prior template had CI
   run `npm version` and push a `chore: release` commit back to the branch. That committed bump was
   the root cause of every git-flow failure observed (branch divergence, fast-forward skips,
   force-push tag collisions, the `[skip ci]` deploy-skip trap). The fix is structural: CI commits
   **nothing** — it derives the patch from git tags and creates a tag only. The whole class of
   problems becomes impossible because there is no commit to collide.

2. **One always-on workflow is correct whether or not an app uses staging.** Both branches run the
   same symmetric derivation: reuse the patch if the cross-stream sibling tag is on THIS commit
   (`git tag --points-at HEAD`), else advance by the GLOBAL max of all `v<MM>.*` tags. An app that
   never creates a `dev` branch finds no sibling → `main` self-increments (`v<MM>.0`, `v<MM>.1`, …)
   from the very same workflow an app using `dev → main` promotion uses. No init flag, no separate
   "staging" spin-up axis: the template ships both branch triggers, and the `--points-at HEAD` check
   is the switch.

The template change is **template-only**: the workflow, a new `cloudbuild.yaml`, the `Dockerfile`,
`vite.config.ts`, `scripts/prerender.mjs`, `src/version.ts`, `src/server.ts`, `scripts/deploy.sh`,
`DEPLOY.md`, and the spin-up resolver `scripts/init.mjs`. The app-specific deploy wiring (GCP
project, service account, WIF provider, connected-repo resource) stays per-app and documented, not
shipped in the template's reusable half.

**Downstream apps are out of frame; existing ones are rebuilt, not migrated.** The template does not
know its consumers by name. Nothing is in active production use, so any existing app adopts this by being
**re-spun from the finished template**, not by an in-place migration — re-spin is simpler and leaves no
"was once something else" scar tissue, matching the "as if designed this way from the start" goal. There
is no migration guide or backport tooling. (The sole named exception is snackbyte-site, which is not a
downstream consumer but the guinea pig / direct extension that produced the proven findings and provides
the feedback loop.)

**Constitutional note (Principle VIII):** shipped files (`src/`, `scripts/`, `Dockerfile`, CI,
`DEPLOY.md`) MUST NOT cite spec/FR numbers or the spec workflow. snackbyte-site's as-built files
carry `see spec 001 (FR-…)` citations; porting them into the template MUST restate the underlying
rule directly and strip the citation.

### Versioning model (locked) — the patch is a global build-id

This was the hardest design call; recording the decision and *why*, so it is not relitigated.

**The rule (one symmetric rule, both branches):** on push, reuse the patch if the opposite-suffix tag
is on THIS exact commit (`git tag --points-at HEAD`); otherwise advance to `max(all v<MM>.* tags) + 1`.
`dev` writes the `-dev` suffix, `main` writes none. The "max" is taken over **all** `v<MM>.*` tags
across both branches (global), not just those reachable from HEAD (branch-local).

**Why GLOBAL max, not branch-local:** the two are mutually exclusive — you cannot have both "numbers
never collide across branches" and "each branch's number reflects only its own commits." Global-max
chooses the first. Rationale, in priority order:

1. **It makes collisions structurally impossible, not merely survivable.** Every mint consults every
   existing tag, so two commits can never get the same number. Branch-local *would* mint the same patch
   for different code on `main` and `dev`, made safe only by a separate discipline — exactly the
   "hazard managed by an operating rule" pattern this whole redesign exists to eliminate (the old
   commit-the-bump model was that pattern). Global-max is consistent with the redesign's reason for
   being.
2. **It serves the number's real consumers.** The patch identifies a build artifact — reported by
   `/api/version`, baked into the image tag, filtered in Cloud Build History, read off a running site.
   Every consumer needs a unique, ordered pointer to one build. None needs a contiguous per-branch
   counter. Branch-local optimizes an intuition (“dev’s Nth change”) that has no consumer.
3. **Its cost is cosmetic; branch-local’s cost is structural.** Global-max’s cost is gaps in a
   branch’s sequence (a `main` hotfix raises `dev`’s next number) — readable, informative, never a
   wrong deploy. Branch-local’s cost is an *ambiguous identifier* (same number, different code).
4. **It is a minimal change from the as-built numbering.** snackbyte-site already advances by global
   max (`git tag -l`, all tags); this model keeps that and only changes the *reuse* detection (from
   `git describe` ancestry to `--points-at HEAD`). The numbering pool is unchanged; the refinement is
   localized to how a promotion/resync reuses a number.

**Accepted trade-off:** the patch number has gaps and exhibits cross-branch influence (3 `main`
hotfixes ⇒ `dev`’s next number jumps ~3). This is correct under “patch = global build-id,” and it
stays small in the `dev`-driven workflow these apps use (direct-to-`main` is the rare hotfix
exception).

**Promotion gate (complement, not crutch):** promotion `dev`→`main` requires `main` ⊆ `dev`
(fast-forwardable). This guarantees the `-dev` tag lands on `main`’s new HEAD (so the number is reused,
not re-minted) AND makes divergent `dev` code — `dev` that hasn’t absorbed a `main` hotfix —
unpromotable, so a historical `-dev` tag for superseded code can never reach prod under a wrong number.
Enforce via branch protection ("require branches up to date before merging") where possible; document
as the promotion reflex regardless.

> **Note — this model refines the as-built snackbyte-site logic.** snackbyte-site derives `main` by
> ancestry (`git describe`), which *jams* (fail-loud, tag-exists) if you resume direct-to-`main` commits
> on an already-promoted minor. This spec replaces that with the symmetric `--points-at HEAD` reuse +
> global-max advance, which self-increments cleanly instead of jamming. That refinement is
> **proven-in-logic, not yet proven-live** — it is verified by spinning a fresh app from the finished
> template; snackbyte-site (the guinea pig) provides the live feedback loop, and any defect found there
> folds back into the template.

## Clarifications

### Session 2026-06-08

- Q: Should staging be always-on in the template, or gated behind an `init.mjs --staging` flag? →
  A: **Always-on.** The symmetric `--points-at HEAD` reuse + global-max advance makes the single
  workflow correct with or without a `dev` branch (reuse the sibling number on a fast-forward promotion;
  self-increment by global max when there's no sibling). A flag/axis would add machinery for no
  behavioral gain. (Resolves the "main must conditionally increment" concern: it does — no `-dev`
  sibling on HEAD ⇒ `main` advances.)
- Q: Global build-id numbering vs branch-local? → A: **Global.** Collisions structurally impossible
  (every mint sees every tag); the cost is cross-branch number influence / gaps, which is correct for a
  build-id and stays small in a `dev`-driven workflow. Branch-local was rejected: it mints ambiguous
  duplicate numbers made safe only by discipline — the exact anti-pattern this redesign removes. See
  "Versioning model (locked)" above for the full rationale.
- Q: Is there a promotion safety rule? → A: Yes — the **promotion gate** (`main` ⊆ `dev` before
  promoting; fast-forwardable). It makes the number reuse correctly AND makes divergent (hotfix-missing)
  `dev` code unpromotable. Enforce via branch protection where possible; document as the reflex
  regardless.
- Q: Does the template ship the `deploy` job (which references a concrete GCP project/SA/WIF)? → A:
  No. The template ships `validate` + `version-and-tag` (app-agnostic) and the `cloudbuild.yaml`
  shape; the `deploy` job and its env block are per-app, documented in `DEPLOY.md` with the exact
  steps. Shipping a concrete project id would be wrong for every app but one.
- Q: Is per-app GCP resource creation (Cloud Run service, NEG, backend, cert-map, DNS) automated? →
  A: No — out of scope. DEPLOY.md documents the corrected runbook; the operator runs gcloud. DNS for
  externally-hosted domains is irreducibly manual (registrar login).
- Q: How do existing apps adopt this? → A: **Re-spun from the finished template, not migrated.** Nothing
  is in production use, so re-spin is simpler and leaves no migration scar tissue. No migration guide or
  backport tooling is built. Downstream apps are out of the template's frame (not named here).
- Q: The refined derivation isn't proven-live — how is it verified? → A: By **spinning a fresh app from
  the finished template** and exercising the acceptance matrix. The template is the source of truth;
  verification is a check, not a precondition. snackbyte-site (the guinea pig, not a downstream consumer)
  provides a live feedback loop — any defect found there folds back into the template.

### Session 2026-06-09

- Q: Tag pushed but the chained `deploy` failed (transient GCP/GitHub/3rd-party) — the tag exists, prod
  wasn't updated, and the fail-loud guard blocks a full re-run. Recovery path? → A: **Re-run the `deploy`
  job alone** against the existing tag (deploy keys off the tag, doesn't re-derive — so the guard is never
  hit). No new logic. Rationale: the two failure classes are disjoint — a *code* failure is fixed by a new
  commit → new tag (the old tag harmlessly becomes a build-id with no deploy, fine under build-id
  semantics); a *transient* failure leaves tag+code correct, so re-running the failed job is the whole fix.

### Execution sequence (informs the plan)

The template is the source of truth; build it clean, then verify.

1. **Build the template (the full hardening):** the `ci-cd` workflow with the refined derivation
   (`--points-at HEAD` reuse + global-max advance + promotion gate); `cloudbuild.yaml`;
   Dockerfile/vite/prerender build-args; the noindex middleware; `deploy.sh` reconcile; `package.json`
   → MAJOR.MINOR; `init.mjs` rework; `DEPLOY.md`. (`src/version.ts` `APP_ENV` fallback is already in the
   template.) Strip Principle-VIII citations while porting. Keep the prod path byte-identical (NFR-001);
   `check:all` green (NFR-002).
2. **Verify by spinning a fresh app** and running the acceptance matrix (SC-001..SC-008): derived-tag
   versioning, staging deploy + noindex, FF promotion, resume-direct-to-`main`, the chip, the resolver,
   the gate.
3. **Feedback loop via snackbyte-site** (the guinea pig). Exercise the model on snackbyte-site (a direct
   extension of the template, re-spun or refined from it); if any live defect surfaces, **fold it back
   into the template**. Feedback path, not a blocker.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A spun-up app gets derived-tag versioning with zero release plumbing (Priority: P1)

A developer spins up a new app from the template and pushes to `main`. CI runs the quality gate and,
on pass, tags the commit `v<MM>.<P>` — deriving the patch from existing tags — **without committing
anything back to the branch**. The developer never configures a version bump, never hits a rejected
push because CI moved the branch, and `package.json` stays at the `MAJOR.MINOR` they set.

**Why this priority**: This is the baseline every app inherits whether or not it uses staging. If it
isn't right, no app gets a working release flow.

**Independent Test**: Spin a fresh app, push a commit to `main` with no `dev` branch and no tags →
CI tags `v<MM>.0` (global-max advance: no sibling on HEAD, no tags ⇒ patch 0), `main` is unmoved (CI
committed nothing), `package.json` unchanged. Push again → `v<MM>.1`.

**Acceptance Scenarios**:

1. **Given** a fresh app with `package.json` version `0.1.0` and no tags, **When** a commit is pushed
   to `main`, **Then** CI tags `v0.1.0` and pushes only the tag (no commit, no branch push).
2. **Given** `v0.1.0` exists, **When** another commit is pushed to `main`, **Then** CI tags `v0.1.1`
   (patch self-incremented to `max(v0.1.*)+1`).
3. **Given** a push whose `check:all` fails, **When** CI runs, **Then** no tag is created and no
   deploy occurs.
4. **Given** the target tag already exists (re-run or race), **When** CI runs, **Then** it fails
   loudly rather than overwriting or reusing the tag.

---

### User Story 2 - Deploy to staging by pushing `dev` (Priority: P1)

A developer creates a long-lived `dev` branch and pushes to it. CI gates, derives
`PATCH = max(v<MM>.* tags) + 1`, tags `v<MM>.<P>-dev`, and the deploy job ships to the staging
service on the app's `.dev` hostname. `dev` is left exactly where the developer pushed it — CI
committed nothing.

**Why this priority**: Staging is the headline capability this feature adds; pushing `dev` is its
primary entry point.

**Independent Test**: On an app wired for staging, push `dev` → tag `v<MM>.<P>-dev` appears on the
pushed commit, the staging service serves the new build, and `dev` HEAD is the commit the developer
pushed (not a CI commit).

**Acceptance Scenarios**:

1. **Given** tags `v0.1.0` and `v0.1.1` exist, **When** a commit is pushed to `dev`, **Then** CI tags
   `v0.1.2-dev` and deploys staging with `APP_ENV=staging`.
2. **Given** the deploy completes, **When** `/api/version` is queried on the staging host, **Then** it
   returns the real minted number (e.g. `v0.1.2-dev`) and `environment: "staging"` — never
   `0.0.0-dev`.
3. **Given** staging is live, **When** the staging host is fetched, **Then** the response carries
   `X-Robots-Tag: noindex`.

---

### User Story 3 - Promote staging to production by merging `dev` → `main` (Priority: P1)

A developer promotes a validated staging build by fast-forwarding `main` to the `dev` commit (the
promotion gate requires `main` ⊆ `dev`). CI on `main` re-gates, sees the `v<MM>.<P>-dev` tag **on HEAD**
(`git tag --points-at HEAD`), reuses that number, tags `v<MM>.<P>` with the suffix dropped — **the same
number, no second increment** — and deploys production. The commit now carries both `v<MM>.<P>-dev` and
`v<MM>.<P>`.

**Why this priority**: Promotion closes the loop; without it staging is a dead end.

**Independent Test**: Fast-forward `dev`→`main`, observe `main` reuses the `-dev` number on HEAD (suffix
dropped), tags it, deploys prod, and does NOT mint a fresh number.

> **Inherent dependency**: this story builds on US2 — a promotion presupposes a `v<MM>.<P>-dev` tag to
> reuse, so US2 must be exercised first. This is a real domain ordering (you cannot promote what was
> never staged), not a structuring flaw; the stories otherwise remain separately testable increments.

**Acceptance Scenarios**:

1. **Given** `dev` is at a commit tagged `v0.1.2-dev` and `main` ⊆ `dev`, **When** `main` is
   fast-forwarded to that commit, **Then** CI on `main` reuses the `-dev` number on HEAD and tags
   `v0.1.2` (suffix dropped) and deploys prod.
2. **Given** the promotion deploys, **When** prod `/api/version` is queried, **Then** it returns
   `v0.1.2` and `environment: "production"`, and the prod response carries **no** `X-Robots-Tag`.
3. **Given** the same commit now has both `v0.1.2-dev` and `v0.1.2`, **When** tags are listed, **Then**
   no `v0.1.3` was created (no double-increment).

---

### User Story 4 - Distinguish staging from production at a glance (Priority: P2)

Anyone looking at a running app can tell staging from production: staging shows the version chip and
reports `environment: staging`; production hides the chip and reports `environment: production`. The
distinction never depends on flipping `NODE_ENV` (which would break the version number).

**Why this priority**: Operability — prevents acting on the wrong environment — but the deploy/version
mechanics (US1–US3) must work first.

**Independent Test**: Build the staging-style image (`APP_IS_PRODUCTION=false`, `APP_ENV=staging`) and
the prod-default image; confirm the chip renders only in staging and `/api/version` labels each
correctly with a real number.

**Acceptance Scenarios**:

1. **Given** the staging build (`APP_IS_PRODUCTION=false`), **When** the page is served, **Then** the
   version chip is visible in both the prerendered HTML and after hydration (no mismatch).
2. **Given** the prod-default build (`APP_IS_PRODUCTION=true`), **When** the page is served, **Then**
   the chip is absent — byte-identical to the pre-feature prod behavior.
3. **Given** a service deployed with `APP_ENV=staging` and `NODE_ENV=production`, **When**
   `/api/version` is queried, **Then** `environment` is `staging` and `number` is the real version
   (proving the label does not flow through the `NODE_ENV`-gated build check).

---

### User Story 5 - Stand up staging infrastructure once, from a correct runbook (Priority: P2, one-time)

An operator stands up a staging environment by following `DEPLOY.md`. The runbook reflects the
*corrected* GCP reality the guinea-pig proved: a Certificate Manager cert-map with per-domain DNS
authorization (not a SAN on a classic cert), the `allUsers run.invoker` binding required in addition
to LB-only ingress, the registrar-gated manual DNS steps, and reuse of the existing WIF pool + deploy
SA.

**Why this priority**: The infra is one-time per app and human-driven; an incorrect runbook costs
hours (the guinea-pig burned them so the template doesn't have to).

**Independent Test**: An operator with only the template's `DEPLOY.md` can stand up a second-TLD
staging environment without hitting the cert-SAN no-op, the LB 403, or the SAN-validation dead end —
each is pre-warned with the correct path.

**Acceptance Scenarios**:

1. **Given** the runbook, **When** the operator adds a second TLD, **Then** it directs them to create a
   per-domain DNS authorization + managed cert + cert-map entries (wildcard), NOT to add a SAN to the
   classic cert.
2. **Given** a freshly created staging Cloud Run service, **When** the operator follows the runbook,
   **Then** they bind `allUsers run.invoker` in addition to locking ingress — and the runbook names the
   Google-HTML 403 as the signature of a missing invoker.
3. **Given** an externally-hosted (registrar) domain, **When** the operator reaches DNS, **Then** the
   runbook flags the apex `A` + `_acme-challenge` CNAME as manual registrar steps and emits the exact
   records.

---

### User Story 6 - The spin-up resolver produces a coherent app for the new model (Priority: P2)

When an app is spun up, `scripts/init.mjs` produces a workflow and docs consistent with derived-tag
versioning — no leftover `AUTO_BUMP` flag, no commit-the-bump header text, no dangling references to
the old model.

**Why this priority**: A resolver that rewrites the *old* workflow header leaves every spun-up app
describing a model it no longer uses.

**Independent Test**: Run the resolver on a fresh template copy; the emitted workflow is the
derived-tag `ci-cd` workflow with an app-appropriate header and no `AUTO_BUMP`/`[skip ci]`/commit-bump
language.

**Acceptance Scenarios**:

1. **Given** the pristine template, **When** the resolver runs, **Then** the resulting workflow file is
   named `ci-cd` and contains no `AUTO_BUMP` env var or `chore: release` commit step.
2. **Given** the resolver completes, **When** `npm run check:all` runs on the resolved app, **Then** it
   passes (the resolved app is green).

---

### Edge Cases

- **First push ever (no tags exist)**: the workflow MUST mint the first tag itself — first push to
  `main` → `v<MM>.0`, first push to `dev` → `v<MM>.0-dev`. No manual first tag; this works regardless of
  how many commits precede it (a fresh app may have several before its first push).
- **Shallow checkout (tags hidden by a truncated clone)**: this is the ONLY zero-tags case that MUST
  fail — a shallow checkout hides existing tags and would mis-derive `v<MM>.0` over an existing tag. The
  guard MUST key on the clone being shallow (`git rev-parse --is-shallow-repository`), **not** on a
  commit-count heuristic (which would wrongly fail a legitimate first push). The workflow ships
  `fetch-depth: 0` + tags, so a complete clone is expected; zero tags on a complete clone is a genuine
  first push, not an error.
- **Direct-to-main commit in a staging-using app (hotfix)**: the hotfix commit has no `-dev` sibling on
  HEAD → `main` advances by global max to a fresh number. This consumes a global number, so `dev`'s next
  mint skips ahead (build-id semantics, not a bug). The operator resyncs `main`→`dev` (the promotion gate
  also requires it before the next promotion).
- **Resume direct-to-main after a promotion**: the new commit has no `-dev` on HEAD → `main` advances by
  global max (does NOT jam). This is the refinement over snackbyte-site's ancestry logic, which would
  fail-loud on the already-promoted number.
- **Truly-diverged branches merged (both have unique commits)**: the merge commit carries no tag →
  advance by global max → a fresh number for the genuinely-new merged artifact. Correct: it is neither
  branch's prior code.
- **Concurrent pushes to the same branch**: a `concurrency` group serializes same-branch runs so two
  pushes cannot derive the same patch.
- **Stray/hand-made tags** that don't match the machine format: anchored regex parsing skips them
  rather than mis-parsing.
- **Tag already exists** for the derived number: fail loudly (a true re-run or race), never overwrite;
  failing produces no tag, so the `needs:`-gated deploy is skipped (no silent success).
- **Tag pushed but the chained deploy failed** (transient GCP/GitHub/3rd-party error): the tag exists but
  prod wasn't updated, and re-running the whole workflow would hit the fail-loud guard. Recovery is to
  **re-run the `deploy` job alone** against the existing tag — `deploy` keys off the tag and does not
  re-derive, so the guard is never engaged. (A *code* failure is instead fixed by a new commit → new tag;
  the orphaned tag harmlessly becomes a build-id with no deploy.) No special logic is needed — `deploy`
  being a separate `needs:`-chained job is what makes job-level re-run the recovery path.
- **Fast-forward `dev`→`main`** under the new model: works and triggers the prod deploy (no `[skip ci]`
  commit on `dev`'s tip anymore, because CI commits nothing). The `-dev` tag lands on `main`'s HEAD, so
  the number is reused (suffix dropped), not re-minted.
- **App that never creates `dev`**: every `main` push advances by global max; the `dev` trigger lies
  dormant. No error, no special configuration.

## Requirements *(mandatory)*

### Functional Requirements — Workflow & versioning

- **FR-001**: The template MUST ship exactly ONE CI workflow named `ci-cd`, triggering on `push` and
  `pull_request` to BOTH `main` and `dev`.
- **FR-002**: The final per-app workflow has three jobs: `validate` (named `validate (merge gate)`,
  PR-only), `version-and-tag` (push-only), and `deploy` (push-only, `needs:` the tag). **The template
  ships only `validate` + `version-and-tag`** (app-agnostic); the `deploy` job (GCP
  project/SA/WIF/connected-repo) is per-app and documented in `DEPLOY.md`, not shipped with real values.
  So the template's workflow has two jobs; an app adds the third.
- **FR-003**: CI MUST NOT commit to or push any branch. It MUST only create and push a git **tag** on
  the existing pushed HEAD. (This is the structural fix that eliminates branch divergence,
  fast-forward skips, and force-push collisions.)
- **FR-004**: `package.json` MUST hold `MAJOR.MINOR` only; the patch in the file is ignored. The patch
  MUST be derived from git tags. The developer bumps `MAJOR.MINOR` by hand as an ordinary commit when
  meaningful. **The patch is a GLOBAL monotonic build-id, not a per-branch release counter** — it
  identifies a unique build artifact, may contain gaps, and is the value `/api/version` reports, the
  image is tagged with, and Cloud Build History filters on. (See "Versioning model (locked)" in Context
  above for why global, not per-branch.)
- **FR-005**: Both branches derive the patch by the SAME symmetric rule:
  1. **Reuse if the cross-stream sibling is on THIS commit.** Query `git tag --points-at HEAD` for a
     `v<MM>.<P>` tag of the *opposite* suffix kind for this branch — on `dev`, a prod tag `v<MM>.<P>`;
     on `main`, a `-dev` tag `v<MM>.<P>-dev`. If found, reuse that `P` (the number belongs to the
     commit; the other branch already numbered it). `dev` then tags `v<MM>.<P>-dev`; `main` tags
     `v<MM>.<P>` (suffix dropped). This is the promotion / resync path and only matches when the
     receiving branch **fast-forwarded onto the already-tagged commit** (which the promotion gate,
     FR-008a, guarantees).
  2. **Otherwise advance by GLOBAL max.** `PATCH = max(patch among ALL v<MM>.* tags, prod AND -dev) + 1`
     (gap-safe via max, not count). `dev` tags `v<MM>.<PATCH>-dev`; `main` tags `v<MM>.<PATCH>`.
- **FR-006**: The global-max advance (FR-005 step 2) makes **collisions structurally impossible**: every
  mint consults every existing `v<MM>.*` tag from both branches, so no two commits can ever receive the
  same patch number. The accepted cost is **cross-branch number influence** — a number consumed on one
  branch (e.g. a `main` hotfix) raises the next mint on the other branch (e.g. `dev` skips ahead). Gaps
  in a branch's sequence are normal and informative (they mark builds the other branch produced), never
  an error.
- **FR-007**: An app that never creates a `dev` branch is correct under the same workflow: every `main`
  push finds no `-dev` sibling on HEAD → advances by global max → `v<MM>.0`, `v<MM>.1`, … (`main`
  self-increments). A direct-to-`main` hotfix in a `dev`-using app behaves identically: no `-dev` on its
  HEAD → advance to the next free global number. No init flag or per-app branch detection is needed; the
  `--points-at HEAD` check is the switch.
- **FR-008**: The same commit MUST be allowed to carry both `v<MM>.P-dev` and `v<MM>.P` (dual-tagged on a
  fast-forward promotion). Promotion MUST NOT mint a second number (the reuse path, FR-005 step 1,
  handles this).
- **FR-008a**: **Promotion gate.** Promotion `dev`→`main` MUST require that `main` is an ancestor of the
  promoted `dev` commit (i.e. the promotion is fast-forwardable; `dev` already contains everything in
  `main`). This (a) guarantees the `-dev` tag lands ON `main`'s new HEAD so FR-005 step 1 reuses the
  number rather than advancing, and (b) makes divergent `dev` code — `dev` that has NOT absorbed a `main`
  hotfix — **unpromotable**, so any duplicate-looking historical `-dev` tag points at code that can never
  reach prod under a wrong number. The gate SHOULD be enforced via branch protection ("require branches
  up to date before merging") and MUST at minimum be documented as the promotion reflex (update `dev`
  from `main` before promoting).
- **FR-009**: The version MUST reach the frontend bundle via an `APP_VERSION` **build-arg** threaded
  cloudbuild → Dockerfile → vite/prerender. The server's `/api/version` MUST read `APP_VERSION` at
  runtime. Neither MUST depend on `package.json` for the patch.

### Functional Requirements — Two-gate enforcement & branch protection

- **FR-010**: `validate` MUST run `check:all` on PRs to `main`/`dev` (advisory + merge-blocking when
  branch protection requires it).
- **FR-011**: `version-and-tag` MUST re-run `check:all` on the push and create a tag (hence allow a
  deploy) ONLY if it passes — true for PR-merge, admin-override, and direct/FF push alike. This is the
  authoritative backstop.
- **FR-012**: The template MUST ship a **branch-protection setup step** (a `gh api` call and/or a
  documented procedure), because the merge gate CANNOT be expressed in workflow YAML — it is repo
  config. The setup MUST: require the check context `validate (merge gate)` (the **job name**, not the
  `ci-cd / …` UI label) on both `main` and `dev`; set `required_pull_request_reviews = null` (requiring
  PRs would break fast-forward promotion); set `enforce_admins = false` (admin override = explicit
  at-own-risk escape); set `allow_force_pushes = true`.
- **FR-013**: The template MUST NOT use `[skip ci]`. It is unnecessary now that CI pushes no commit, and
  it dangerously skips the gate itself. Any prior `[skip ci]` usage MUST be removed.

### Functional Requirements — Robustness guards

- **FR-014**: The `version-and-tag` job MUST checkout with `fetch-depth: 0` and fetch tags. It MUST fail
  if the checkout is **shallow** (`git rev-parse --is-shallow-repository` returns `true`), which would
  hide existing tags and mis-derive. It MUST NOT use a commit-count heuristic for this — zero tags on a
  complete (non-shallow) clone is a legitimate first push and MUST mint the first tag (`v<MM>.0` /
  `v<MM>.0-dev`), not fail.
- **FR-015**: Tag parsing MUST use **anchored** regex against the machine-generated tag format so stray
  or hand-made tags are skipped, not mis-parsed.
- **FR-016**: The job MUST fail loudly if the target tag already exists (re-run or race) — never
  overwrite or silently reuse.
- **FR-017**: A `concurrency` group keyed on the branch ref MUST serialize same-branch runs
  (`cancel-in-progress: false`) so two pushes cannot derive the same patch concurrently.

### Functional Requirements — Runtime environment labeling

- **FR-018**: `src/version.ts` MUST report `environment = APP_ENV ?? NODE_ENV ?? 'development'`. The
  `isBuild` gate MUST stay keyed on `NODE_ENV === 'production'` (and `CI`). Staging MUST keep
  `NODE_ENV=production` and label itself via `APP_ENV=staging`; labeling via `NODE_ENV` is forbidden
  because it flips `isBuild` false and makes `/api/version` report `0.0.0-dev`. *(Already implemented in
  the template; this spec records and tests the invariant.)*
- **FR-019**: A non-production public site MUST emit `X-Robots-Tag: noindex`, via middleware keyed on
  `APP_ENV === 'staging'`. Production MUST emit no such header. The middleware MUST be mode-agnostic
  (present in static and server resolutions alike — it is not server-only).

### Functional Requirements — Version chip (build-keyed)

- **FR-020**: The version chip's visibility MUST be driven by an `APP_IS_PRODUCTION` **build-arg**
  (default `true` ⇒ chip hidden), NOT a runtime var and NOT raw `NODE_ENV` (the build always runs
  `NODE_ENV=production`). The staging build passes `APP_IS_PRODUCTION=false` to show the chip.
- **FR-021**: `vite.config.ts` and `scripts/prerender.mjs` MUST read `APP_IS_PRODUCTION` (and
  `APP_VERSION`) **identically**, or prerendered HTML and client hydration will disagree.

### Functional Requirements — Build & deploy artifacts

- **FR-022**: The template MUST ship a `cloudbuild.yaml` that: stamps a real UTC build date; builds the
  Dockerfile forwarding `APP_VERSION`, `APP_IS_PRODUCTION`, `BUILD_GIT_COMMIT`, `BUILD_DATE` as
  build-args; tags the image `<service>:<TAG>-<sha>` (+ `:<TAG>` and `:latest`); pushes to Artifact
  Registry; and `gcloud run deploy`s setting runtime env (`NODE_ENV=production`, `APP_VERSION`,
  `BUILD_GIT_COMMIT`, `BUILD_DATE`, and `APP_ENV` **only when non-empty** so prod is never given a stray
  `APP_ENV=`). It MUST use `logging: CLOUD_LOGGING_ONLY` and set `images:`/`tags:` for Cloud Build
  History legibility. Per-target knobs (`_SERVICE`, `_APP_ENV`, `_APP_IS_PRODUCTION`) MUST default to
  production so the prod path is byte-identical to today.
- **FR-023**: The `Dockerfile` MUST declare `APP_VERSION` and `APP_IS_PRODUCTION` build-args (defaults
  `0.0.0` / `true`) and pass them into the build step; `NODE_ENV` MUST stay `production` in the build so
  the real version is read.
- **FR-024**: `scripts/deploy.sh` (the manual no-CI deploy) MUST be reconciled with the new model — it
  MUST NOT imply the patch comes from `package.json`, and MUST document that a manual deploy's version
  is whatever is passed/derived, not a `package.json` patch.

### Functional Requirements — Spin-up resolver

- **FR-025**: `scripts/init.mjs` MUST be reworked so the resolved app's workflow is the derived-tag
  `ci-cd` workflow: no `AUTO_BUMP` flag, no commit-the-bump steps, no `[skip ci]`, and an
  app-appropriate header with no template/spin-up references (Principle VIII) and no dangling reference
  to the resolver after it self-deletes.
- **FR-026**: After the resolver runs, `npm run check:all` MUST pass on the resolved app.

### Functional Requirements — Documentation

- **FR-027**: `DEPLOY.md` MUST be updated to describe derived-tag versioning as the model (replacing the
  obsoleted commit-the-bump and the earlier `## Staging environment` recommendation section that
  described `--no-ff`/`[skip ci]`/branch-scoped-bump — all now obsolete). It MUST document: the symmetric
  `--points-at HEAD` reuse + global-max advance rule; that the patch is a **global build-id** (gaps and
  cross-branch number influence are normal); the **promotion gate** (`main` ⊆ `dev`, fast-forward
  promotion) and why (number reuse + divergent-code unpromotable); the accepted trade-offs (patch not in
  repo; numbers gap); the branch-protection setup; and the corrected infra runbook (cert-map + per-domain
  DNS authorization + wildcard; `allUsers run.invoker` in addition to LB-only ingress; registrar-gated
  manual DNS; reuse of WIF + deploy SA).
- **FR-028**: Shipped files MUST NOT cite spec/FR numbers or the spec workflow (Principle VIII). When
  porting snackbyte-site's as-built files, their `see spec 001 (FR-…)` citations MUST be replaced with a
  direct statement of the rule.

> No migration guide or backport tooling is a deliverable: existing apps are re-spun from the finished
> template, not migrated in place (see Context — "Existing apps are rebuilt, not migrated").

### Non-Functional / Guardrail Requirements

- **NFR-001**: The prod deploy path MUST remain byte-identical for an app that does not use staging:
  defaults (`APP_IS_PRODUCTION=true`, empty `APP_ENV`) produce the same image and runtime behavior as
  before this feature (no chip, no noindex, `environment: production`).
- **NFR-002**: The template's `npm run check:all` (format, lint, typecheck, test) MUST pass after all
  changes.
- **NFR-003**: Changes MUST respect the existing `SPINUP:` marker axes (`server-only`, `prerender-only`)
  — the new middleware and version wiring MUST resolve correctly under both static/server and
  prerender/dynamic resolutions.

### Key Entities

- **Version tag**: a git tag `v<MAJOR>.<MINOR>.<PATCH>` (prod) or `v<MAJOR>.<MINOR>.<PATCH>-dev`
  (staging). The canonical record of a release; the patch lives here (+ in the built image +
  `/api/version`), never in `package.json`.
- **`package.json` version**: a `MAJOR.MINOR` seed only. Not a source of the running patch.
- **Environment label (`APP_ENV`)**: the runtime selector for environment identity (`staging` on the
  staging service; unset elsewhere). Drives `/api/version`'s `environment` and the `noindex` header.
- **Chip flag (`APP_IS_PRODUCTION`)**: a build-arg (default `true`) that bakes chip visibility into the
  bundle. Distinct from `APP_ENV` because the chip is build-time, the label runtime.
- **Branch protection ruleset**: repo config (not YAML) requiring the `validate (merge gate)` check on
  `main`/`dev`, with PRs not required and admin override allowed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a fresh app with no `dev` branch, two consecutive `main` pushes produce tags
  `v<MM>.0` then `v<MM>.1`, with `main` HEAD unmoved by CI both times (CI committed nothing).
- **SC-002**: A `dev` push produces a `v<MM>.<P>-dev` tag and a staging deploy whose `/api/version`
  reports the real number and `environment: "staging"` (never `0.0.0-dev`); the staging response
  carries `X-Robots-Tag: noindex`.
- **SC-003**: A `dev`→`main` merge produces `v<MM>.<P>` (same patch as the promoted `-dev`, suffix
  dropped) on the same commit, deploys prod with `environment: "production"` and **no** noindex header,
  and creates no extra patch number.
- **SC-004**: A fast-forward `dev`→`main` succeeds and triggers the prod deploy (no `[skip ci]` skip),
  demonstrating the commit-the-bump trap is gone.
- **SC-005**: A PR whose `check:all` fails is blocked from merging (with branch protection applied), and
  no tag/deploy is produced from it.
- **SC-006**: The staging-style build shows the version chip in prerendered HTML and after hydration
  with no mismatch; the prod-default build's prerendered HTML and bundle are unchanged from pre-feature.
- **SC-007**: After `scripts/init.mjs` runs on a fresh copy, the resolved app's workflow is the
  derived-tag `ci-cd` workflow (no `AUTO_BUMP`/`[skip ci]`/commit-bump) and `npm run check:all` passes.
- **SC-008**: `DEPLOY.md` contains the corrected infra runbook (cert-map + per-domain DNS auth +
  wildcard; `allUsers run.invoker`; registrar-gated DNS) and the documented versioning trade-offs; it
  contains no surviving description of the commit-the-bump model.
- **SC-009**: A fresh app spun from the finished template reaches a working state — `check:all` green, a
  `ci-cd` workflow, a first push that derives a tag with CI committing nothing — with no migration
  artifacts or old-model residue.

## Assumptions

- snackbyte-site's as-built files (`cloudbuild.yaml`, `Dockerfile`, `vite.config.ts`,
  `scripts/prerender.mjs`, `src/version.ts`, `src/server.ts`) are the reference for the **infra/runtime**
  port (proven-live); the template adaptation differs only in (a) stripping app-specific deploy values
  into per-app docs, (b) restoring `SPINUP:` markers where the template needs them, and (c) removing
  spec/FR citations per Principle VIII. The **versioning derivation** in the `ci-cd` workflow is a
  refinement (not a copy) of snackbyte-site's and is verified by fresh spin-up, not assumed proven.
- The existing project-level GCP resources an app reuses (one shared LB, WIF pool/provider, deploy SA,
  Artifact Registry) already exist; this feature documents reuse, it does not create them.
- `main` and `dev` are the only environment branches; additional environments are out of scope.
- DNS for the staging TLD may be registrar-hosted (external); the template cannot automate registrar
  DNS and documents the manual records instead.
- The shipped `ci-cd.yml` is what spun-up apps run; it is validated by spinning a fresh app from the
  template, not by running it against the template repo itself.
- Nothing is in production use, so existing apps are re-spun from the finished template rather than
  migrated. Downstream consumer apps are out of the template's frame; snackbyte-site is the exception —
  the guinea pig / direct extension that produced the proven infra/runtime findings and provides the
  feedback loop.

## Out of Scope

- Automated creation of per-app GCP resources (Cloud Run service, NEG, backend, url-map host-rules,
  cert-map entries, DNS) — e.g. Terraform. The runbook is documented; provisioning stays manual.
- Changes to the `static`/`server` or `prerender`/`dynamic` mode axes.
- Shipping a concrete `deploy` job with real GCP project/SA/WIF values in the template (per-app, by
  design).
- Multi-environment beyond `main`/`dev` (e.g. a separate QA branch).
- Moving externally-hosted DNS into Cloud DNS (a possible future hardening, noted but not done here).
- In-place migration of existing apps and any migration tooling/guide — existing apps are re-spun from
  the finished template instead (nothing is in production use).

## Implementation Notes (as-built refinements)

Recorded where the build refined the design (the divergence-log pattern, applied to the template's own
build-out):

- **Derivation is a standalone tested script.** `scripts/derive-version.sh` (the logic) +
  `scripts/derive-version.test.sh` / `npm run test:release` (a 14-row local proof against git fixtures),
  rather than inline workflow YAML. `test:release` runs in CI before the derivation is relied on, and is
  kept OUT of `check:all` (app-code gate ≠ release-tooling gate). The 14-row matrix passed locally,
  including the four refinement rows that diverge from the guinea-pig's jamming `git describe`.
- **`package.json` holds bare `MAJOR.MINOR`** (e.g. `1.1` / app seed `0.1`), verified to work with
  `npm install`/`ci` and the derivation. The obsolete `version:patch|minor|major` scripts (which ran
  `npm version`, abandoned under this model) were removed. The resolver seeds an app at `0.1` and de-
  templates the `ci-cd.yml` header (no `AUTO_BUMP` flip — there is no flag).
- **The template repo carries `ci-cd.yml` as a normal always-on file** (no in-file template/self-tag
  guard) and **runs it like any other repo**: Actions is enabled, so a push to the template's own
  `main` triggers `version-and-tag` and the workflow derives + cuts the `v<MM>.<P>` release tag
  automatically. The template's own releases therefore come from CI, not by hand — a `git tag` from a
  maintainer is redundant (and races the workflow). Maintainer note: commit and push; let the Action
  tag. (An earlier design considered keeping CI off the template repo and tagging it manually; that was
  not adopted — the repo runs its own workflow, which also continuously dogfoods it.)

### Live confirmation (2026-06-10) — the DERIVATION is proven-live; the TEMPLATE re-spin is pending

A first live run on the guinea-pig (snackbyte-site) confirmed the **versioning derivation** against real
GitHub + Cloud Run — but note its scope. snackbyte-site **swapped the derivation in place** on its
existing app (keeping its prior `v0.1.x` tag history); it did **not** re-spin fresh from the template.
So this run tested **some additions to the template** (the derivation logic, the runtime labels), **not
the template as a template**. A migration hand-swaps files into an already-resolved app, so it
**structurally cannot run the resolver** — and this feature's `scripts/init.mjs` changes (rewrite the
`ci-cd.yml` header off the old `main.yml`/AUTO_BUMP form, seed the app at `0.1` MAJOR.MINOR, sync the
lockfile) are exactly the part it bypassed. Those init changes, and the coherence of a freshly-produced
app, were **never exercised live** — only by the local fresh-app spin-up.

What the derivation run genuinely proved live (independent of greenfield-vs-migrated):

- **FF promote** → reused the number on the same commit, suffix dropped, no double-mint.
- **The refinement (direct-to-`main` after a promotion)** → advanced, **did not jam** — the case the old
  `git describe` ancestry logic fail-louded on. Proven-in-logic before; now proven-live.
- **Bonus:** concurrent `main`+`dev` on the same commit converged race-safe (one number, no collision) —
  the `--points-at HEAD` reuse handles a race the matrix didn't test.

**Still pending: a proper re-spin** of snackbyte-site _fresh from the finished template_ (via the
resolver, no migrated history) — the only thing that validates the **template** (resolver + produced-app
coherence), not just the additions hand-grafted onto an existing app. Until that runs, the resolver and
the end-to-end spin-up remain verified only by the local fresh-app spin-up (SC-007/SC-009), not live.

The one template fix that landed from the first run: the paste-ready deploy-job **attach contract** in
`DEPLOY.md`. (The feedback also flagged backport ergonomics — adopting the model on an app with prior
history — but **the template does not document migration/backport** per this feature's scope; existing
apps are re-spun, so that was deliberately NOT added, and the in-place migration itself was an off-plan
deviation by the guinea pig, not the intended flow.) Full report: snackbyte-site
`specs/001-staging-environment/`.
