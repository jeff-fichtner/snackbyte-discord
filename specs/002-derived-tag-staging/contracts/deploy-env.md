# Contract: Build/Runtime Environment Variables

The variable flow from CI → Cloud Build → Docker → bundle/runtime. Defaults MUST make the prod path
byte-identical to pre-feature (NFR-001).

## The four variables

| Var | Kind | Set by | Read by | Default | Purpose |
|---|---|---|---|---|---|
| `APP_VERSION` | build-arg **and** runtime env | CI (the derived `TAG`) → cloudbuild → Dockerfile build-arg; also a runtime env var on deploy | frontend bundle (`vite.config.ts` / `prerender.mjs` via `__APP_VERSION__`); server `src/version.ts` at runtime | `0.0.0` (Dockerfile) / `0.0.0-dev` (dev fallback) | The displayed/reported version (the derived tag), NOT package.json |
| `APP_IS_PRODUCTION` | **build-arg only** | cloudbuild `--build-arg` (`_APP_IS_PRODUCTION`, default `true`) → Dockerfile | `vite.config.ts` + `prerender.mjs` → `__IS_PRODUCTION__` | `true` | Chip visibility (true ⇒ chip hidden). Build-time because the chip is baked into the bundle |
| `APP_ENV` | **runtime env only** | cloudbuild deploy step, appended **only when non-empty** (`_APP_ENV`, default empty) | `src/version.ts` (`environment`), `src/server.ts` (noindex) | unset | Environment label + noindex trigger. Runtime because it's read per-request/at boot |
| `NODE_ENV` | build + runtime | Dockerfile (`production` in both build and runtime) | `src/version.ts` `isBuild` gate | `production` | MUST stay `production` everywhere so `isBuild` is true and the real version is read |

## Hard rules (each prevents a verified failure)

1. **NEVER label via `NODE_ENV`.** `isBuild = CI==='true' || NODE_ENV==='production'`. Flipping
   `NODE_ENV` to `staging` makes `isBuild` false → `/api/version` reports `0.0.0-dev`. Keep
   `NODE_ENV=production` on staging; label via `APP_ENV=staging`.
2. **`APP_ENV` is appended only when non-empty.** Prod is never given a stray `APP_ENV=` (so prod
   `environment` resolves to `NODE_ENV` = `production`).
3. **Chip is build-keyed, not runtime.** `__IS_PRODUCTION__` comes from the `APP_IS_PRODUCTION`
   build-arg, never raw `NODE_ENV` (the build always runs `NODE_ENV=production`).
4. **`vite.config.ts` and `scripts/prerender.mjs` MUST read these identically.** Any divergence →
   prerendered HTML ≠ client hydration → hydration mismatch.

## Per-target values

| Target | `_SERVICE` | `_APP_ENV` | `_APP_IS_PRODUCTION` | Chip | `/api/version` env | noindex |
|---|---|---|---|---|---|---|
| production | `<service>` | `` (empty) | `true` | hidden | `production` | no |
| staging | `<service>-staging` | `staging` | `false` | shown | `staging` | yes |

The cloudbuild substitutions default to the production column, so an app that never deploys staging is
byte-identical to today (NFR-001).

## Runtime resolution (already in `src/version.ts`)

```
isBuild     = process.env.CI === 'true' || process.env.NODE_ENV === 'production'
number      = isBuild ? (process.env.APP_VERSION ?? '0.0.0') : '0.0.0-dev'
environment = process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development'
```

## noindex middleware (`src/server.ts`) — to add

Mode-agnostic (present in static and server resolutions — **outside** the `SPINUP:server-only` markers),
registered before static/routes:

```
app.use((_req, res, next) => {
  if (process.env.APP_ENV === 'staging') res.set('X-Robots-Tag', 'noindex');
  next();
});
```

Comment states the rule directly (no spec/FR citation — Principle VIII): staging is publicly reachable
but must not be indexed so it doesn't compete with prod as duplicate content; keyed on `APP_ENV` so prod
(no `APP_ENV`) emits no header.
