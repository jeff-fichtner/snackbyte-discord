# Spin-up handoff

You just created a repo from the snackbyte-base template. This file walks you (or an
agent) through resolving it into a clean, single-mode app. It is removed automatically
when you run `init`.

## 1. Install

This project runs on Node 24 (see `.nvmrc`). Make sure it's active — `node --version`
should print `v24.x`. With nvm in an interactive shell, `nvm use` switches to it; an
agent or non-interactive shell should just confirm `node --version` instead (`nvm` is a
shell function and won't be on the PATH).

```bash
node --version   # expect v24.x
cp .env.example .env   # local environment values (PORT, etc.)
npm install
```

Create the `.env` from `.env.example` as part of setup — the defaults run without it,
but this app expects a `.env` for its local config, so set it up now rather than later.

> **Not putting this app at the repo root?** This template assumes it _is_ the repo. If
> you're nesting it in a subdirectory of an existing repo (e.g. a `web/` folder beside
> another service), read [SUBDIR-LAYOUT.md](SUBDIR-LAYOUT.md) first — it's the playbook for
> the CI/npm adjustments that layout requires. The root-level case (most apps) needs none
> of it.

## 2. Decide what this app is, and resolve

Two choices, both baked into the source at spin-up (no runtime switches). These are
identity decisions, not preferences with a default — make them deliberately.

> **If you are an agent doing this spin-up: STOP here and ask the person which mode and
> which render strategy they want. Do not infer them from the app's name or purpose, and
> do not pick a default.** Present the two axes (below) factually and wait for an answer.

**Deploy mode** — does this app expose a backend API?

- **`server`** — Express serves the frontend AND an API under `/api`. Keeps
  `src/routes/` and a `/api/health` liveness endpoint, plus the dev API proxy.
- **`static`** — no API. Removes `src/routes/`, the dev proxy, and the dev API process.
  (An Express server still serves the built files; there is just no `/api`.)

**Render strategy** — when is the HTML produced?

- **`prerender`** — content rendered to real HTML at build time, so the page ships as
  markup (fast first paint, good SEO).
- **`dynamic`** — rendered on the client in the browser; no prerender step. The shipped
  HTML is an empty shell that React mounts into.

Then run the resolver (all three flags required):

```bash
npm run init -- --mode=<static|server> --render=<prerender|dynamic> --name=<repo-slug>
```

`--name` is the repo slug in kebab-case (e.g. `snackbyte-site`). It becomes the
`package.json` name (which npm requires to be lowercase) and the page `<title>` — you can
prettify the title later by editing `src/web/index.html`.

This bakes both choices into the source, deletes the unchosen paths and all template
scaffolding (this file, the init script, the template README, the machinery tests),
points the test suite at `tests/app/`, and replaces this README with the app's own.
After it runs there is no "mode"/"render" concept and no template fingerprint left —
the repo is your app.

This step is **intentionally not autonomous**: because the resolver refuses to default
the mode/render choice, an unattended/automated spin-up can't proceed past here without a
human answering. That's by design — these are identity decisions, not conveniences.

What `init` keeps (intentionally): the Spec Kit tooling under `.specify/` and `.claude/`,
and an empty `specs/`. The app's spec-dev state is left exactly as a fresh `specify init`
would leave it — the template's own constitution and specs are removed, the tooling
stays, ready for you to run `/speckit-constitution` and `/speckit-specify`.

## 3. Verify

```bash
npm run check:all   # format + lint + typecheck + tests
npm run dev         # bring it up
```

`npm run build` produces a self-contained `dist/` — the page is `dist/index.html`. In a
prerender app, that file ships real markup (no `<!--app-html-->` placeholder); confirm
with `grep -c app-html dist/index.html` → `0`. (Prerendering runs at build, so in `dev`
the page is still the empty shell.)

## 4. Authorize CI, then push

On a push the release workflow runs the checks and **derives a version tag from git
history**, pushing the **tag only** (`vX.Y.Z` on `main`, `vX.Y.Z-dev` on `dev`) — it never
commits anything back. For the tag push to succeed, the repo must grant Actions write
access — a deliberate, one-time authorization. **Do it before the first push**, or the
first release fails with a 403.

This is a security setting (it lets CI push tags to the repo), so it's authorized consciously:

```bash
gh api -X PUT repos/<owner>/<repo>/actions/permissions/workflow \
  -f default_workflow_permissions=write
```

(Or in the web UI: **Settings → Actions → General → Workflow permissions → "Read and
write permissions" → Save**.) The command needs admin rights on the repo, which the
account that created it has.

> **If you are an agent doing this spin-up: STOP here and ask the person before granting
> this.** It's a privilege escalation (it lets CI push to `main`), so it needs a
> conscious human decision — present the command above and ask them to either run it
> themselves or explicitly approve you running it. Don't grant it silently, and don't
> proceed to the push until it's authorized. (Many agent sandboxes will refuse the
> `gh api` elevation outright; either way, the human is in the loop.)

Once it's authorized, commit the spin-up and push. The version PATCH is derived from git
tags by CI (not stored in `package.json`, which holds only `MAJOR.MINOR`), so the first push
to `main` produces `v0.1.0`. See [DEPLOY.md](DEPLOY.md) for the full versioning + CI/deploy
model.

> **If you are an agent doing this spin-up: STOP and ask the person before pushing to
> `main`.** Pushing to the default branch is the irreversible, outward-facing step that
> kicks off the first release — get explicit approval before you push. Have the commit
> staged and ready, show them what you're about to push, and wait for the go-ahead.
> (Many agent sandboxes will refuse a push to `main` outright; either way, the human
> approves the push.)
>
> **Stopping here is NOT finishing.** Before you pause, the spin-up must be **committed
> locally** — never leave the repo uncommitted or empty and report the task done. "Stop and
> ask before pushing" means: commit, then hold at the push. A spun-up app with no commit is
> an incomplete spin-up, not a completed one.

## Switching mode later

Mode is baked into the source, so switching is a small, deliberate code edit — not a
config flag. It is reversible and shows up in version control.

### static → server (add a backend)

1. Create `src/routes/index.ts`:

   ```ts
   import type { Express } from 'express';

   export function registerRoutes(app: Express): void {
     // app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
   }
   ```

2. In `src/server.ts`, import and call it before the static middleware:

   ```ts
   import { registerRoutes } from './routes/index.js';
   // ...inside createApp():
   registerRoutes(app);
   ```

3. In `vite.config.ts`, add the dev API proxy and import `PORT`:

   ```ts
   import { PORT } from './src/config';
   // ...in the config:
   server: { proxy: { '/api': `http://localhost:${PORT}` } },
   ```

4. In `scripts/dev.mjs`, start the API alongside Vite:

   ```js
   run(bin('tsx'), ['watch', 'src/server.ts']);
   ```

5. Add a server test under `tests/app/` (request the app via supertest and assert your
   route responds).

### server → static (drop the backend)

1. Delete `src/routes/`.
2. In `src/server.ts`, remove the `registerRoutes` import and call.
3. In `vite.config.ts`, remove the `/api` proxy and the `PORT` import.
4. In `scripts/dev.mjs`, remove the `tsx watch src/server.ts` line.
5. Remove any server/API tests under `tests/app/`.

## Rendering: prerender vs dynamic

The two render strategies, factually:

- **`prerender`** — build-time-known content is rendered to real HTML, so the page ships
  as markup (fast first paint, good SEO).
- **`dynamic`** — the page renders entirely on the client; the shipped HTML is an empty
  shell. Use when content depends on the user or live data and there's nothing
  meaningful to render at build time.

Like the deploy mode, this is a deliberate one-time choice, not a runtime switch — and
not one to default into. Decide it (or ask) up front.

### prerender → dynamic (client-side rendering)

1. In `src/web/prerender.ts`, empty the entries: `export const entries: PrerenderEntry[] = [];`
   (The build then prerenders nothing; the page ships as an empty shell that renders on
   the client. `src/web/main.tsx` already handles this — it mounts fresh when there's no
   prerendered markup.)
2. Optional: in `src/web/index.html`, remove the `<!--app-html-->` comment from the root
   div (it's just an unused injection point now).
3. Optional: drop the prerender step from `scripts/build.mjs` (the `prerender.mjs` line)
   and the prerender tests under `tests/app/`, if you want a leaner build.

### dynamic → prerender

Reverse it: restore the entry in `src/web/prerender.ts`
(`[{ html: 'index.html', element: createElement(App) }]`) and the prerender build step.
Keep prerendered content limited to what's known at build time.
