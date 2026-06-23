# Phase 0 Research: snackbyte-base Template Skeleton

All technical choices for this feature were settled during planning and ratified by
the constitution. No NEEDS CLARIFICATION items remained from Technical Context. This
file is the durable record of each decision (with rationale and alternatives) in the
required format, so the plan is self-contained.

## R1. Single template, not two templates

- **Decision**: One skeleton, not a fork per mode.
- **Rationale**: Two templates double maintenance for a solo maintainer and drift
  apart. Mandated by Constitution Principle I.
- **Alternatives considered**: Two separate templates (rejected — drift, double
  upkeep); a monorepo of per-mode packages (rejected — reintroduces the fork).
- **Note**: The original form of this decision modeled mode as a runtime config value
  (`DEPLOY_MODE`). That was superseded — see R1a.

## R1a. Deploy mode is a build-time identity (supersedes the DEPLOY_MODE config model)

- **Decision**: Mode is resolved once at spin-up by an `init` script that bakes the
  choice into the source and removes the other mode — leaving a clean single-mode app
  with no runtime mode flag. Switching later is a documented source edit.
- **Rationale**: A runtime `DEPLOY_MODE` left the app's fundamental nature in an
  environment value (gitignored, per-developer) and forced every app to carry both
  code paths forever. Mode is really a property of the app, not an environment knob; a
  spun-up app should read as a clean static or server app with no template fingerprint.
  Resolving at spin-up also removes the env-loading / import-timing problems that the
  runtime model introduced. Mandated by the redefined Principle I (constitution v2.0.0).
- **Alternatives considered**: keep the runtime config switch (rejected — the
  "switching needs no source edit" convenience wasn't wanted, and it permanently
  bloated every app with both modes); a committed constant with both branches present
  (rejected — leaves the unused mode's code visible, so the app doesn't read as a clean
  single identity).
- **Forward direction**: the per-mode wiring is sprawled across a few files today;
  it is slated to consolidate into a versioned runtime package once the interface is
  proven by real use, shrinking the switch surface to a single call site.

## R2. UI framework: React

- **Decision**: React + ReactDOM.
- **Rationale**: The later `@snackbyte/ui` shared layer is a component-library
  problem, best-trodden in React; most apps are interactive (server mode), where a
  component model pays off. React does not force server mode — it prerenders cleanly.
- **Alternatives considered**: Vanilla/no framework (rejected — no path to a shared
  component package); Svelte/Vue (rejected — smaller component-library ecosystem for
  the shared layer). The "React too heavy for static" concern was examined and
  dismissed: ~45KB gzipped, invisible at this scale, and prerender removes the
  blank-shell cost.

## R3. Test runner: Vitest

- **Decision**: Vitest.
- **Rationale**: Reuses `vite.config`, ESM-native, faster than Jest; one config for
  build and test. Replaces tonic's Jest + ts-jest + jsdom stack.
- **Alternatives considered**: Jest (rejected — extra ts-jest/jsdom config, slower,
  no vite.config reuse), as proven painful in tonic.

## R4. Runtime: Node 24 LTS, pinned

- **Decision**: Node 24 LTS, pinned via `.nvmrc` and `package.json` `engines`.
- **Rationale**: Every spun-up app must agree on the runtime (FR-009). tonic ran on
  non-LTS v23; pin to LTS for production stability. Mandated by Principle VII.
- **Alternatives considered**: Unpinned/latest (rejected — apps drift across Node
  versions); non-LTS (rejected — shorter support window).

## R5. Hosting: Cloud Run as the single default deploy path

- **Decision**: Both modes deploy to Google Cloud Run via one path; the skeleton
  ships a `Dockerfile`, `.dockerignore`, and a deploy script/Cloud Build config. A
  static app is a container that serves files with no API routes.
- **Rationale**: One deploy path maximizes uniformity for a solo maintainer; a static
  app promotes to server for free (already on Cloud Run). Cost is a tie at ~$0
  (scale-to-zero, per-request-ms billing), so it cannot decide the default —
  uniformity does. GCP chosen over Azure for Google ecosystem gravity. Mandated by
  Principle V.
- **Alternatives considered**: Cloud Storage + Cloud CDN as the static default
  (rejected as default — separate deploy path, no free promotion; retained as a
  documented performance-only opt-in for high-traffic/global static apps); Azure
  Container Apps (rejected — no Microsoft enterprise gravity here); Kubernetes/GKE
  (rejected — wrong ops appetite; managed PaaS wanted).

## R6. Render strategy: prerender static content by default

- **Decision**: Build-time-known content is prerendered to HTML; CSR remains
  available for runtime-driven apps (games, tools).
- **Rationale**: CSR-ing static content wastes first paint and SEO. Render strategy
  and deploy mode are independent knobs that compose freely. Mandated by Principle VI
  and FR-006.
- **Alternatives considered**: CSR-only (rejected — blank-shell first paint, poor
  SEO for static content); SSR-by-default (rejected — forces server mode, over-scoped
  for v1; remains available per-app).

## R6a. Prerender mechanism: custom `renderToString` build step (not an SSG plugin)

- **Decision**: Prerendering is a small build step using `react-dom/server`
  `renderToString` that renders a **list of entry pages (1..N)** into HTML files in
  `dist/`, injected into the Vite HTML template. The list is one entry for a typical
  single-purpose app and a few entries for the occasional multi-page app. Request-time
  rendering (SSR), when a page's content depends on the request, is `server` mode
  using the same `react-dom/server` API at request time — not a separate mechanism.
- **Rationale**: Keeps the skeleton dependency-free for prerender (`react-dom` is
  already in the stack) and free of routing/build conventions that every spun-up app
  would inherit — honoring "skeleton only" (Principle III) and the independent-knobs
  design. The one-app-per-subdomain model means apps are overwhelmingly single-route;
  the rare multi-page app is handled by looping the same step over a list, and
  request-dependent pages are SSR in server mode. "A backend serving prerendered
  files" is already the default static-on-Cloud-Run path (a container serving `dist/`).
- **Alternatives considered**: SSG plugin (e.g. vite-react-ssg) — rejected: its main
  value is build-time multi-route crawling, which the one-off-app model structurally
  avoids; it adds a dependency and convention lock-in to every app to solve a problem
  one notch larger than the platform has. Hardcoding a single page — rejected: the
  list form costs nothing and absorbs the few-page case without a future rewrite. If
  multi-route static ever becomes genuinely common, an app adopts a plugin locally or
  it is backported to base (Principle IV) — not speculated into base now.

## R7. Lint/format and conventions baseline

- **Decision**: ESLint (typescript-eslint) + Prettier, with a `config/` folder for
  tooling configs and a `check:all`-style aggregate gate — a stripped subset of
  tonic's conventions.
- **Rationale**: tonic proved this toolchain; reuse the proven parts, drop the
  app-specific weight (migrations, Google APIs, documentation pipeline) to honor
  "skeleton only" (Principle III, FR-012). Mandated by Principle VII.
- **Alternatives considered**: Biome / other all-in-one linters (rejected — tonic's
  ESLint+Prettier setup is already proven and transferable); copying tonic wholesale
  (rejected — carries business logic the skeleton must not contain).
