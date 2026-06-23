# When the app isn't at the repo root

This template assumes it **is** the repository — that the app lives at the repo root, so
`npm install`, `npm run dev`, `npm run check:all`, and `npm run build` all run from the
directory that holds `.git`, and the workflow at `.github/workflows/ci-cd.yml` is the
repo's workflow.

Sometimes that assumption doesn't hold. You may want the app to live in a **subdirectory**
of an existing, larger repo — e.g. a `web/` folder alongside a separate prototype, shared
content, or another service that already owns the repo root. The template still works in
that layout, but a fixed, knowable set of adjustments is required, because GitHub Actions
and npm both have root-relative assumptions baked in.

This file is the playbook for that case. It is **not** part of any one app — it documents a
template-level reality so the next subdirectory spin-up doesn't have to rediscover it. If
your app is at the repo root (the common case), ignore this file entirely; nothing here
applies.

> Throughout, `<app>/` is the subdirectory you put the app in (e.g. `web/`). Substitute
> your actual directory name.

## Why root-level is assumed (and what breaks otherwise)

Three things are root-relative and will misbehave when the app is in a subdirectory:

1. **npm** — `npm ci` / `npm run *` resolve `package.json` and `package-lock.json` from the
   current directory. CI runs from the repo root by default, so it won't find them.
2. **GitHub Actions workflows** — GitHub only reads workflow files from the **repo-root**
   `.github/workflows/`. A workflow at `<app>/.github/workflows/ci-cd.yml` is never run.
3. **`actions/setup-node` npm cache** — `cache: 'npm'` hashes a `package-lock.json` to key
   the cache. It looks at the repo root unless told otherwise, so the cache silently
   never hits (or errors) when the lockfile is under `<app>/`.

Everything below is just resolving those three facts.

## The layout

Run the template's `init` in a clean throwaway directory (so the resolver sees a normal
root-level template and does its renaming correctly), then copy the resolved tree into
`<app>/` of the target repo. Exclude things the host repo already owns or that don't belong
nested:

- `.git` — the host repo's, not the template's.
- `node_modules` — reinstall under `<app>/`.
- `.github/` — its workflow moves to the **repo root** (see below), it does not live under
  `<app>/`.
- `.specify/`, `.claude/`, `specs/` — Spec Kit and agent context belong at the repo root,
  one set per repo. Don't nest a second copy under `<app>/`.

After copying, `cd <app>` and run `npm install` there.

## CI: move the workflow up and make it directory-aware

The single workflow `.github/workflows/ci-cd.yml` must live at the **repo root** (move the
template's copy up; delete the nested `<app>/.github/`). Then make it run from `<app>/`.
There are four edits, all mechanical:

### 1. Run npm from `<app>/` — `defaults.run.working-directory`

Add a `defaults` block so every `run:` step's shell starts in `<app>/`. Put it at the job
level on the jobs that run npm (`validate` and `version-and-tag`), or once at the top level
to cover all jobs:

```yaml
defaults:
  run:
    working-directory: <app>
```

This is what makes `npm ci`, `npm run check:all`, `npm run test:release`, and
`scripts/derive-version.sh` resolve correctly — they now run inside `<app>/`. It matters
for the version script too, not just npm: `derive-version.sh` reads `./package.json`
(relative to cwd) for the `MAJOR.MINOR`, so without the working directory it can't find the
version. (Its `git` calls are cwd-independent — git walks up to `.git` on its own.)

> `working-directory` only affects `run:` steps. `uses:` steps (checkout, setup-node) are
> unaffected and are handled next.

### 2. Fix the npm cache key — `cache-dependency-path`

On each `actions/setup-node` step, the template uses `cache: 'npm'` with no explicit path,
which assumes a root `package-lock.json`. Point it at the real lockfile:

```yaml
- uses: actions/setup-node@v6
  with:
    node-version: ${{ env.NODE_VERSION }}
    cache: 'npm'
    cache-dependency-path: <app>/package-lock.json
```

Without this the cache key is wrong and the npm cache never helps (and can warn).

### 3. Scope the triggers — `paths:`

The template's `on:` triggers on every push/PR to `main`/`dev`. In a shared repo that means
unrelated changes (to the prototype, to shared content) trigger a pointless app run. Scope
it to the app's directory and the workflow file itself:

```yaml
on:
  pull_request:
    branches: [main, dev]
    paths:
      - '<app>/**'
      - '.github/workflows/ci-cd.yml'
  push:
    branches: [main, dev]
    paths:
      - '<app>/**'
      - '.github/workflows/ci-cd.yml'
```

> Trade-off to be aware of: with `paths:` filters, a push that touches **only** files
> outside `<app>/` produces **no** `version-and-tag` run, so no tag and no deploy. That's
> the intended behavior (nothing about the app changed). Just know that the app's release
> cadence is now coupled to changes under `<app>/`, not to every push.

### 4. The `deploy` job (per app, as always)

The `deploy` job is per-app regardless of layout — copy it in from `DEPLOY.md` as usual.
The only subdirectory-specific part: the step that ships the build source
(`gcloud builds submit`) must run from `<app>/` so it uploads the `<app>/` tree (picking up
`<app>/cloudbuild.yaml` and `<app>/Dockerfile`). The top-level or job-level
`defaults.run.working-directory: <app>` from edit 1 already covers this; if you set
`working-directory` only on `validate`/`version-and-tag`, add it to the submit step too.

## What this does NOT change

- **`derive-version.sh` and the tag scheme** — versioning derives from **git tags**, which
  are repo-global, not directory-scoped. A subdirectory app shares the repo's tag namespace.
  If the repo holds more than one releasable thing, that's a tag-collision design question
  (prefix tags, separate repos) — out of scope here, but flag it before you wire a second
  deployable into the same repo.
- **App source, modes, render strategy** — none of the `init` choices or in-source code
  care where the app sits. `--mode`, `--render`, `src/`, tests, the dev scripts: all
  identical to a root-level app.
- **GCP wiring** — project, WIF, service account, Cloud Run, load balancer, DNS, certs are
  all per-app/per-fleet and unaffected by the subdirectory layout. Follow `DEPLOY.md`.

## Checklist

- [ ] App tree copied into `<app>/`; `.git`, `.github/`, `.specify/`, `.claude/`, `specs/`,
      `node_modules` excluded.
- [ ] `npm install` run from `<app>/`.
- [ ] Workflow moved to repo-root `.github/workflows/ci-cd.yml`; nested `<app>/.github/`
      removed.
- [ ] `defaults.run.working-directory: <app>` added (job-level on `validate` +
      `version-and-tag`, or top-level).
- [ ] `cache-dependency-path: <app>/package-lock.json` on every `setup-node`.
- [ ] `paths:` filters scope the workflow to `<app>/**` + the workflow file.
- [ ] `deploy` job copied from `DEPLOY.md`; its `gcloud builds submit` runs from `<app>/`.
- [ ] Considered tag-namespace sharing if the repo holds another releasable.
