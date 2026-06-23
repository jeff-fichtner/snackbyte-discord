# Feature Specification: snackbyte-base Template Skeleton

**Feature Branch**: `001-template-skeleton`

**Created**: 2026-05-31

**Status**: Draft

**Input**: User description: "Establish the snackbyte-base template skeleton: Vite + React + TypeScript app with a static/server deploy mode switch, Vitest testing, and reusable conventions so new subdomain apps can be spun up quickly"

## Context

`snackbyte-base` is a GitHub template repository. Its purpose is to be the single
reusable starting point for a family of one-off applications, each deployed to its
own subdomain under `snackbyte.io` (e.g. `speakers.snackbyte.io`). A new app is
created via GitHub's "Use this template", then deployed to its own subdomain as an
independent project.

Each app spun up from this template must be able to operate in one of two deploy
modes, chosen once at spin-up time:

- **static** — built at build time and served as static assets with no backend API
  routes. Deployed by default as a container on Cloud Run (the same deploy path as
  server mode); a Cloud Storage + CDN deploy is a documented performance-only opt-in.
- **server** — served by an Express server, which may also expose backend API
  routes.

The template is mode-neutral: it carries both capabilities until a one-time spin-up
step (an `init` resolver) bakes the choice into the source, leaving a clean
single-mode app. Mode is a build-time identity, not a runtime setting. The majority of
apps are expected to be **server** mode; a minority are pure **static**.

A separate shared-identity layer (`@snackbyte/ui`, a versioned npm package) will be
extracted later from the first real app (`snackbyte-site`) and is **out of scope**
for this spec.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Spin up a new app from the template (Priority: P1)

As the sole developer, I create a new repository from `snackbyte-base`, install
dependencies, choose a deploy mode, and have a running, buildable app within
minutes — without re-deciding tooling, structure, or conventions.

**Why this priority**: This is the entire reason the template exists. If spin-up
isn't fast and convention-complete, the template has failed its purpose. It is the
minimum viable product: a template that produces a working app.

**Independent Test**: Create a fresh copy of the template, run the documented
install + dev commands, and confirm a React app renders in the browser and the dev
server runs — with no additional configuration decisions required.

**Acceptance Scenarios**:

1. **Given** a fresh copy of the template, **When** the developer runs the
   documented install and dev commands, **Then** a React + TypeScript app renders
   in the browser via the Vite dev server.
2. **Given** a fresh copy of the template, **When** the developer inspects the
   repo, **Then** linting, formatting, type-checking, and test conventions are
   already configured and runnable via documented scripts.
3. **Given** a fresh copy of the template, **When** the developer reads the README,
   **Then** the spin-up steps and the static-vs-server mode choice are clearly
   documented.

---

### User Story 2 - Choose static vs server deploy mode (Priority: P1)

At spin-up, the developer declares whether the app is **static** or **server**, and
the build/deploy behavior follows from that single choice.

**Why this priority**: This is the defining capability that distinguishes
`snackbyte-base` from a generic Vite starter. Both modes must work from one
skeleton, or the "single template" goal is lost.

**Independent Test**: Resolve a copy to **static** (via the spin-up init); the build
produces deployable static assets that the container serves with no API routes
exposed. Resolve another copy to **server**; the Express server starts and serves the
built app (and hosts API routes).

**Acceptance Scenarios**:

1. **Given** an app configured in **static** mode, **When** the developer runs the
   build, **Then** the output is a set of static assets served by a container on
   Cloud Run by default (no API routes); the assets are also CDN-deployable as a
   documented performance-only opt-in.
2. **Given** an app configured in **server** mode, **When** the developer runs the
   build and start, **Then** an Express server serves the built frontend and can
   expose API routes.
3. **Given** a resolved app, **When** the developer follows the documented procedure
   to switch it to the other mode, **Then** the switch is a small, enumerated set of
   source edits (reversible, visible in version control) — not a config toggle.

---

### User Story 3 - Static content is prerendered, not client-rendered (Priority: P2)

Static-mode content that is known at build time is rendered to real HTML at build
time (prerendered), rather than shipped as an empty shell rendered in the browser.
Interactive apps (games, tools) may opt into client-side rendering.

**Why this priority**: Prevents the common waste of shipping a blank HTML shell +
JS for content that never changes (bad first paint, bad SEO). It is a quality
default rather than a blocking capability, hence P2.

**Independent Test**: Build a static-mode app with known content and confirm the
output HTML contains the rendered content (not an empty root element).

**Acceptance Scenarios**:

1. **Given** a static-mode app with build-time-known content, **When** it is built,
   **Then** the output HTML contains the rendered markup.
2. **Given** an app that is inherently runtime-driven (e.g. a game), **When** the
   developer opts into client-side rendering, **Then** the template supports it
   without fighting the prerender default.

---

### Edge Cases

- What happens when a **static** app later needs a backend? The developer follows the
  documented switch procedure — a small, enumerated set of source edits that adds the
  server wiring back. It is a deliberate change, not a config flip.
- What happens when the template's conventions improve after apps already exist?
  Changes to the template are propagated by manual backport (accepted, infrequent);
  shared styling/UI changes are handled by the future `@snackbyte/ui` package, not
  by backporting the template.
- How does a developer discover the mode an existing app is in? It is evident from the
  source — a server app has API routes and the server wiring; a static app does not.
  There is no mode flag to read.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The template MUST produce a runnable Vite + React + TypeScript
  application on spin-up with no additional tooling decisions required.
- **FR-002**: The template MUST be mode-neutral and provide a one-time spin-up
  resolver (`init`) that bakes a single deploy-mode choice — `static` or `server` —
  into the source, leaving a clean single-mode app with no runtime mode flag and no
  trace of the other mode.
- **FR-003**: In **static** mode, the build MUST produce static assets served by a
  containerized Express app (no API routes) deployed to Cloud Run by default — the
  SAME deploy path as server mode. Static-on-Cloud-Run is effectively free at idle
  via scale-to-zero (billed only per-request-ms during actual request handling).
- **FR-003a**: A Cloud Storage + Cloud CDN deploy MUST be available as a documented
  performance-only opt-in for static apps (instant response, global edge), NOT the
  default and NOT chosen on cost grounds.
- **FR-004**: In **server** mode, an Express server MUST serve the built frontend
  and MUST be able to expose backend API routes, deployable as a containerized
  Google Cloud Run service.
- **FR-004a**: The template MUST include the artifacts needed to deploy to GCP: a
  `Dockerfile`, a `.dockerignore`, and a documented deploy path (`gcloud run deploy`
  and/or a Cloud Build config). Both static and server modes use the Cloud Run
  deploy path by default; the mode difference is whether the app exposes API routes,
  not which infrastructure it targets.
- **FR-005**: Switching a resolved app to the other mode MUST be a documented,
  enumerated set of source edits (reversible, visible in version control) — NOT a
  config toggle. The template MUST document this switch procedure.
- **FR-006**: Static, build-time-known content MUST be prerendered to HTML by
  default; client-side rendering MUST remain available for runtime-driven apps.
- **FR-007**: The template MUST include pre-configured linting, formatting, and
  type-checking, runnable via documented scripts.
- **FR-008**: The template MUST include a test setup using Vitest, runnable via a
  documented script.
- **FR-009**: The template MUST pin a Node.js version (Node 24 LTS) so all apps
  agree on the runtime.
- **FR-010**: The template MUST document, in a README, the spin-up steps and the
  static-vs-server mode choice.
- **FR-011**: The repository MUST exclude build artifacts, dependencies, and local
  environment files from version control.
- **FR-012**: The template MUST NOT contain application-specific business logic; it
  is a skeleton only.

### Key Entities *(include if feature involves data)*

- **Deploy Mode**: A build-time identity (`static` | `server`) resolved once at
  spin-up and baked into the app's source. Not a runtime configuration value.
- **App Skeleton**: The reusable file/folder structure, tooling configuration, and
  scripts that every spun-up app inherits.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can go from "Use this template" to a running dev server in
  under 5 minutes, performing only documented steps.
- **SC-002**: Both deploy modes (static and server) are demonstrably resolvable from
  the one template via the spin-up `init`, and each resolved app is buildable and
  serveable — both via the same Cloud Run deploy path, the mode differing only by
  whether API routes are exposed.
- **SC-003**: A static-mode build of known content yields HTML containing the
  rendered content (verifiable by inspecting the build output).
- **SC-004**: Lint, format, type-check, and test scripts all run successfully on a
  fresh copy with zero additional configuration.
- **SC-005**: The template contains no application-specific business logic (skeleton
  only), verifiable by review.

## Assumptions

- The developer is the sole maintainer; multi-contributor workflows are out of
  scope for v1.
- Each app is deployed independently to its own subdomain; cross-app routing is
  handled at the DNS/hosting layer, not by this template.
- The shared identity layer (`@snackbyte/ui`) is extracted later from the first real
  app and is out of scope here.
- The target host is **Google Cloud Platform**, with **Cloud Run as the single
  default deploy path for BOTH static and server modes** (Artifact Registry for
  images). Cloud Storage + Cloud CDN is a performance-only opt-in for static apps.
  Cost is not a deciding factor: static-on-Cloud-Run is ~free at idle via
  scale-to-zero (billed per-request-ms). GCP was chosen over Azure for Google
  ecosystem gravity (Gmail/Workspace, tonic's Google API use) and Cloud Run's
  one-service-per-subdomain fit.
- Hosting friends'/third-party apps under snackbyte subdomains is a **future phase,
  out of scope for v1.** The near-term path (if pursued) is "deploy more Cloud Run
  services"; a self-serve platform (push-to-deploy, multi-tenant isolation) is a
  separate project.
- The toolchain conventions are adapted from the existing `tonic` app (Express +
  Vite + TypeScript), with Jest replaced by Vitest and React adopted as the UI
  layer.
