# Quickstart: Derived-Tag Versioning & Staging

How an app uses this once the template ships it, and how to verify a build-out.

## Day-to-day (developer)

- **Ship to prod (no staging):** commit to `main`, push. CI gates, derives `v<MM>.<P>` (global-max+1),
  tags it, deploys prod. `main` is never moved by CI. Bump `MAJOR.MINOR` in `package.json` by hand for a
  meaningful release; the patch derives itself.
- **Ship to staging:** push `dev`. CI derives `v<MM>.<P>-dev`, deploys staging on `<app>.snackbyte.dev`.
- **Promote staging → prod:** ensure `main` ⊆ `dev` (update `dev` from `main` first), then fast-forward
  `main` to the `dev` commit. CI reuses the `-dev` number (suffix dropped) and deploys prod. Same commit
  carries both tags.
- **Hotfix straight to prod (rare):** commit to `main`. CI advances to the next free number. Resync
  `main`→`dev` afterward (the promotion gate requires it before your next promotion).

What you never do anymore: no `npm version`, no `chore: release` commit, no `[skip ci]`, no
"rebase-before-push because CI moved the branch" — CI commits nothing.

## What the version number means

A **global build-id**, not a per-branch counter. It's unique and monotonic but **has gaps** — a `main`
hotfix consumes a number, so `dev`'s next mint skips ahead. That's expected: the number identifies a
build artifact (shown in `/api/version`, the image tag, Cloud Build History), not "the Nth change on this
branch."

## One-time setup (operator)

1. **Branch protection** (`gh api`, shipped step in DEPLOY.md): require the `validate (merge gate)` check
   on `main` + `dev`; `required_pull_request_reviews=null`; `enforce_admins=false`;
   `allow_force_pushes=true`. Optionally "require branches up to date before merging" to enforce the
   promotion gate.
2. **GCP staging infra** (DEPLOY.md runbook): `<service>-staging` Cloud Run service with **both** LB-only
   ingress **and** `allUsers run.invoker`; serverless NEG + backend + url-map host-rule for
   `<app>.snackbyte.dev`; **cert-map entry** backed by a per-domain DNS-authorization + wildcard managed
   cert (NOT a SAN on the classic cert); registrar DNS: apex `A` + `_acme-challenge` CNAME (manual for
   externally-hosted domains). Reuse the existing WIF pool + deploy SA.
3. **Per-app `deploy` job**: copy the documented deploy job into `ci-cd.yml`, filling the app's GCP
   project / SA / WIF provider / connected-repo. The template ships `validate` + `version-and-tag` only.

## Verify a build-out (acceptance — SC-001..SC-007)

- No-`dev` app: two `main` pushes → `v<MM>.0`, `v<MM>.1`; `main` unmoved by CI; `package.json` unchanged.
- `dev` push → `v<MM>.<P>-dev`; staging `/api/version` shows the real number + `environment: staging`;
  staging response has `X-Robots-Tag: noindex`.
- FF promote → `v<MM>.<P>` (same patch, suffix dropped) on the same commit; prod `/api/version` shows
  `environment: production` and **no** noindex; no extra patch minted.
- Resume-direct-to-main after a promote → advances cleanly (does NOT jam).
- Staging build shows the chip (prerender + hydrate, no mismatch); prod-default build unchanged.
- A failing-`check:all` PR is blocked from merging (branch protection); no tag/deploy from it.
- After `scripts/init.mjs`: workflow is `ci-cd` (no `AUTO_BUMP`/`[skip ci]`/commit-bump); `check:all`
  passes on the resolved app.

## Adopting this in an existing app

Existing apps are **re-spun from the finished template**, not migrated in place — nothing is in
production use, so a clean re-spin (and re-pointing the deploy) is simpler and leaves no migration
residue. There is no migration guide; the spin-up flow IS the adoption path.
