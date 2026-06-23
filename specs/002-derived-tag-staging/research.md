# Research / Decisions: Derived-Tag Versioning & Staging

No NEEDS CLARIFICATION items remained after the spec — the design was settled by (a) the snackbyte-site
Divergence Log (proven-live findings) and (b) the locked versioning-model discussion recorded in the
spec's "Versioning model (locked)" section. This file consolidates the decisions and the rejected
alternatives so the rationale survives.

## Decision 1: Derived-tag versioning (CI commits nothing)

- **Decision**: CI derives the patch from git tags and creates a tag only — no commit, no branch push.
  `package.json` holds MAJOR.MINOR; the patch lives in tags + the built image + `/api/version`.
- **Rationale**: The old commit-the-bump model's pushed `chore: release` commit was the root cause of
  branch divergence, fast-forward skips, `[skip ci]` deploy-skips, and force-push tag collisions
  (snackbyte-site Divergence Log, "Versioning — MAJOR REDESIGN"). Removing the commit makes the whole
  class structurally impossible.
- **Alternatives rejected**: commit-the-bump (the prior model — abandoned); storing the full patch in
  `package.json` (reintroduces the commit).

## Decision 2: Symmetric `--points-at HEAD` reuse + global-max advance (refines as-built)

- **Decision**: both branches run one rule — reuse the opposite-suffix tag if it's on HEAD
  (`git tag --points-at HEAD`), else advance to `max(all v<MM>.* tags)+1`. `dev` writes `-dev`; `main`
  writes none.
- **Rationale**: snackbyte-site's as-built `main` uses `git describe` ancestry, which **jams** (fail-loud
  on an already-promoted number) if you resume direct-to-`main` commits on a promoted minor. The
  `--points-at HEAD` reuse only matches on a fast-forward (the promotion gate guarantees it), and the
  global-max advance self-increments cleanly instead of jamming.
- **Status**: **proven-in-logic, NOT yet proven-live.** Verified by spinning a fresh app from the
  finished template (the acceptance matrix); snackbyte-site (the guinea pig) provides the live feedback
  loop, and any defect found folds back into the template.
- **Alternatives rejected**: ancestry `git describe` (jams — the thing being refined); HEAD-only reuse
  without a promotion gate (breaks `--no-ff` promotion, where the `-dev` is on the parent, not HEAD).

## Decision 3: GLOBAL build-id numbering (not branch-local)

- **Decision**: the advance is `max(ALL v<MM>.* tags)+1` (both branches' tags), so the patch is a global
  monotonic build-id.
- **Rationale**: global-max makes collisions **structurally impossible** (every mint sees every tag) —
  consistent with this redesign's whole purpose (replace discipline-managed hazards with impossible
  ones). It serves the number's real consumers (artifact identity in `/api/version`, image tag, Cloud
  Build History), none of which need per-branch contiguity. Its cost (gaps / cross-branch number
  influence) is cosmetic and stays small in a `dev`-driven workflow.
- **Alternatives rejected**: branch-local / ancestry-scoped max — mints ambiguous duplicate numbers
  (same patch, different code on `main` vs `dev`) made safe only by discipline; reintroduces the exact
  anti-pattern the redesign removes. (Full fork analysis in spec "Versioning model (locked)".)

## Decision 4: Promotion gate (`main` ⊆ `dev`, fast-forwardable)

- **Decision**: promotion `dev`→`main` requires `main` to be an ancestor of the promoted commit.
- **Rationale**: (a) guarantees the `-dev` tag is on `main`'s new HEAD so the number is reused, not
  re-minted; (b) makes hotfix-missing `dev` code **unpromotable**, so any historical duplicate-looking
  `-dev` tag can never reach prod under a wrong number. Enforce via branch protection ("require up to
  date before merging") where possible; document as the reflex regardless.
- **Alternatives rejected**: no gate (allows promoting divergent code that lacks a prod hotfix).

## Decision 5: Two-gate enforcement + branch protection (config, not YAML)

- **Decision**: `validate` gates PRs; `version-and-tag` re-runs `check:all` and tags only on pass.
  Branch protection (shipped as a `gh api` setup) requires the `validate (merge gate)` **job-name**
  context on `main`+`dev`, with `required_pull_request_reviews=null`, `enforce_admins=false`,
  `allow_force_pushes=true`. Drop `[skip ci]` entirely.
- **Rationale**: workflow YAML can run a check but cannot *require* it for merge — that's repo config
  (snackbyte-site Divergence Log, "CI gate enforcement"). Requiring PRs would break FF promotion; admin
  override is the at-own-risk escape. `[skip ci]` is unneeded (CI pushes no commit) and dangerously skips
  the gate.

## Decision 6: Env label via APP_ENV; chip via APP_IS_PRODUCTION build-arg; noindex middleware

- **Decision**: `environment = APP_ENV ?? NODE_ENV ?? 'development'` (already in template); chip
  visibility from the `APP_IS_PRODUCTION` build-arg (default true=hidden), read identically in
  `vite.config.ts` and `prerender.mjs`; a mode-agnostic `X-Robots-Tag: noindex` middleware keyed on
  `APP_ENV==='staging'`.
- **Rationale**: labeling via `NODE_ENV` flips `isBuild` and makes `/api/version` report `0.0.0-dev`
  (snackbyte-site "version-label / chip" entry — held as designed). The chip is build-time, the label
  runtime; they need separate vars. noindex keeps staging out of search without affecting prod.

## Decision 7: Corrected infra runbook (cert-map / DNS-auth / invoker)

- **Decision**: document Certificate Manager **cert-map + per-domain DNS authorization + wildcard**
  (not a SAN on a classic cert); `allUsers run.invoker` **in addition to** LB-only ingress; registrar-
  gated manual DNS (apex A + `_acme-challenge` CNAME) for external domains; reuse WIF + deploy SA.
- **Rationale**: each was a live divergence on snackbyte-site (cert-map precedence; the Google-HTML 403
  signature of a missing invoker; GoDaddy-hosted DNS gcloud can't touch). These are the hours the
  guinea-pig burned so the template doesn't.

## Decision 8: existing apps are re-spun from the finished template, not migrated

- **Decision**: no migration guide or backport tooling. Existing apps adopt the model by being re-spun
  from the finished template. The template is the source of truth; verification is a fresh spin-up.
  Downstream consumer apps are out of the template's frame (not named). snackbyte-site is the exception —
  the guinea pig / direct extension that provides the live feedback loop.
- **Rationale**: nothing is in production use, so re-spin is simpler than in-place migration and leaves
  no "was once something else" scar tissue, matching the "as if designed this way from the start" goal.
  Building migration tooling for a fleet that doesn't exist would be wasted machinery. If exercising the
  model on snackbyte-site surfaces a real defect, it folds back into the template.
