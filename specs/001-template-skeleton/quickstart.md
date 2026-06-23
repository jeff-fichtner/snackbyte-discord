# Quickstart: Spin up an app from snackbyte-base

This is the developer path the template must make true in under 5 minutes (SC-001).
It doubles as the acceptance walkthrough for the skeleton.

## 1. Create the app

Use GitHub's **"Use this template"** on `snackbyte-base` to create a new repo for
your subdomain app, then clone it.

```bash
git clone <your-new-repo-url> && cd <your-new-repo>
nvm use            # picks up .nvmrc → Node 24 LTS
npm install
```

## 2. Choose the deploy mode

Set `DEPLOY_MODE` in your environment (copy `.env.example` to `.env`):

- `DEPLOY_MODE=server` — Express serves the frontend and can host API routes. **Most
  apps.** This is the default if unset.
- `DEPLOY_MODE=static` — built, prerendered static assets; no API routes.

Switching modes later changes only this value and the deploy target — never your
application source.

## 3. Run it

```bash
npm run dev        # Vite dev server (+ API in server mode) — app renders in the browser
```

## 4. Verify the conventions are wired

```bash
npm run lint       # ESLint (typescript-eslint)
npm run format     # Prettier
npm run typecheck  # tsc --noEmit across base + web configs
npm test           # Vitest
```

All four MUST pass on the fresh copy with no extra configuration (SC-004).

## 5. Build

```bash
npm run build      # static mode → prerendered static assets; server mode → frontend + server
```

In **static** mode, inspect the build output: build-time-known content appears as
rendered HTML, not an empty root element (SC-003).

## 6. Deploy to Cloud Run (both modes, one path)

```bash
./scripts/deploy.sh        # builds the container and runs `gcloud run deploy`
```

Both modes deploy to Cloud Run by default; a static app is just a container serving
files with no API routes. Idle cost is ~$0 (scale-to-zero, per-request-ms billing).

**Performance-only opt-in**: for a high-traffic / global / latency-sensitive static
app, deploy to Cloud Storage + Cloud CDN instead (instant response, global edge).
This is documented in the README and chosen for performance, never on cost grounds.

## What you do NOT get here (by design)

- No shared visual identity (theme, Header/Footer, shared components) — those come
  later from the `@snackbyte/ui` package, not this template.
- No application business logic — the skeleton ships only demonstrative content that
  proves it works.
