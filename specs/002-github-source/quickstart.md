# Quickstart: GitHub source + per-route formatting — validation

How to bring up and prove this feature. A run/validation guide — it links to
[data-model.md](./data-model.md) and [contracts/](./contracts/) rather than restating them, and
contains no implementation code. Builds on the running 001 system.

## Prerequisites

- The 001 hub running (locally `npm run dev`, or the deployed service). DB reachable; ClickUp
  source already working (for the no-regression check).
- A GitHub repository (or org) where you can add a webhook, and permission to set its secret.
- A GitHub webhook signing secret value (you choose it when creating the webhook).
- An existing Discord delivery target (reuse the 001 demo target, or add another).

## Configuration (secrets by reference — never commit values)

Add the GitHub signing secret to the environment by the name the source row references:
`GITHUB_WEBHOOK_SECRET` (referenced as `sources.secret_ref = 'github_webhook_secret'`). Set it in
`.env` locally and on Cloud Run via `./scripts/set-secrets.sh` (add the key to that script's list).
The `.env.example` should list the name (no value).

## Setup

1. Apply migrations: `npm run migrate` (adds `0004` — the `filtered` status; idempotent).
2. Seed GitHub data (via the store's table editor or SQL):
   - a `sources` row: `github` / `GitHub` / enabled / `secret_ref = github_webhook_secret`
     (see [data-model.md](./data-model.md));
   - one or more `routes`: `source=github`, `event_type` = a `type.action` (e.g.
     `pull_request.opened`), `target_id` = a Discord target, optionally `transform='github'` and
     a `config` (mention/color/exclude — see
     [contracts/formatting-config.md](./contracts/formatting-config.md)).
3. Register slash commands: not needed (no bot changes in this feature).
4. In GitHub: add a webhook pointing at `https://discord.snackbyte.io/webhooks/github`
   (or your local URL), content type `application/json`, set the secret to match
   `GITHUB_WEBHOOK_SECRET`, and subscribe to the relevant events (pull requests, issues, pushes).

## Validation scenarios

Each maps to spec acceptance scenarios / success criteria and a contract.

1. **GitHub event delivered** — open a PR (or trigger `pull_request.opened`) → within a few
   seconds a formatted message (summary + link) appears in the routed channel; `delivery_log` has
   an `ok` row. (US1-1, SC-002; [inbound-webhook-github.md](./contracts/inbound-webhook-github.md))
2. **Signature verified / rejected** — a request with a valid `X-Hub-Signature-256` → `202`; an
   invalid/missing signature → `401`, nothing posted. (US1-3, SC-003)
3. **Idempotency** — redeliver the same webhook (same `X-GitHub-Delivery`) from GitHub's webhook
   UI → exactly one message; duplicate recorded `skipped`. (US1-2, SC-004)
4. **Unmapped event / ping** — GitHub's initial `ping`, or an unsubscribed event → `202`, no
   message. (US1-4)
5. **Source isolation / no regression** — trigger a ClickUp event with GitHub configured →
   ClickUp still delivers as before; a GitHub issue doesn't affect ClickUp. (US1-5, SC-007)
6. **Named transform** — a route with `transform='github'` renders GitHub-styled output; a route
   with no transform uses the default. (US2-1/2, SC-005)
7. **Missing transform falls back** — point a route at a non-existent transform name → it still
   delivers, in the default style. (US2-3)
8. **Per-route config — mention + color** — set `mentionRoleIds` and `accentColor` on a route →
   the delivered message includes the mention and the accent. (US3-1/2)
9. **Per-route filter** — set `excludeSubtypes` to suppress a subtype on one route → that subtype
   produces no message and is recorded `filtered`; non-filtered subtypes still deliver; a second
   route without the filter still delivers the suppressed subtype. (US3-3, SC-006, SC-008)
10. **Same transform, two configs** — two routes share `transform='github'` with different
    `config` → each channel gets its own formatting. (US3-4, SC-005)

## Quality gate

`npm run check:all` (format + lint + typecheck + Vitest) MUST pass. New tests: GitHub adapter
(verify happy/tamper/missing; parse each mapped event → canonical `type.action`); GitHub
transform + config (mention/color); route filter (`excludeSubtypes` → `filtered`); webhook
integration (`/webhooks/github` 202/401/unmapped); and a source-isolation check that ClickUp is
unaffected.
