# Quickstart: Walking Skeleton validation

How to bring the slice up and prove it end to end. This is a run/validation guide — it links to
[data-model.md](./data-model.md) and [contracts/](./contracts/) rather than restating them, and
contains no implementation code (that lives in `tasks.md` and the implementation phase).

## Prerequisites

- Node 24 (`node --version` → v24.x).
- A reachable PostgreSQL database (Supabase free tier or local Postgres) and its connection
  string.
- A Discord application + bot: bot token, application id, and a dev guild id for fast slash
  command registration. Bot invited to a test server with permission to post.
- One Discord channel **webhook URL** (Channel → Integrations → Webhooks) for delivery.
- A ClickUp webhook signing secret (or, for local testing, any secret you also use to sign the
  simulated request).

## Configuration (secrets by reference — never commit values)

Set local values in `.env` (gitignored); in deployment these come from the secret manager.
Required names (see `config.ts`): `PORT`, `DISCORD_BOT_TOKEN`, `DISCORD_APP_ID`,
`DISCORD_DEV_GUILD_ID`, `DATABASE_URL`, `LOG_LEVEL`, and the source/target secrets referenced by
`sources.secret_ref` and `discord_targets.webhook_url_ref`. The `.env.example` lists names only.

## Setup

1. `npm install`
2. Apply the schema: run `migrations/0001_init.sql` against the database (creates `sources`,
   `discord_targets`, `routes`, `delivery_log`; seeds one `clickup` source, one webhook target,
   one enabled route — see [data-model.md](./data-model.md) "Seed data").
3. Register slash commands: `node scripts/deploy-commands.mjs` (guild-scoped in dev).
4. Bring it up: `npm run dev` (starts the unified bootstrap — Express + bot in one process).

## Validation scenarios

Each maps to spec acceptance scenarios / success criteria and a contract.

1. **Service is live** — `GET /api/health` → `200` with status/uptime. `GET /api/ready` → `200`
   when DB + gateway are up. (Contract: [health-readiness.md](./contracts/health-readiness.md);
   FR-020/021.)

2. **Bot responds** — in Discord, run `/ping` → prompt reply within ~2s; bot shows online.
   (US3-1, SC-005; [bot-interactions.md](./contracts/bot-interactions.md).)

3. **Member-join observed** — a member joins (or simulate) → the join is logged, nothing else
   disrupted. (US3-2, FR-017.)

4. **Webhook happy path** — POST a ClickUp-shaped payload to `/webhooks/clickup` with a valid
   `X-Signature` for the body → `202`; a formatted message (summary + link) appears in the
   target channel within a few seconds; `delivery_log` has an `ok` row. (US1-1, SC-002/007;
   [inbound-webhook.md](./contracts/inbound-webhook.md).)

5. **Idempotency** — POST the same payload twice (same dedupe key) → exactly one message in
   Discord; second attempt recorded `skipped`. (US1-2, SC-003.)

6. **Bad signature** — POST with an invalid/missing `X-Signature` → `401`; no message; no `ok`
   record. (US1-3, SC-004.)

7. **No matching route** — POST a valid event whose type has no enabled route → `202`; no
   message posted. (US1-4, FR-008.)

8. **Unknown source** — POST to `/webhooks/notreal` → `404`; nothing routed. (Edge case.)

9. **Multi-route fan-out** — add a second enabled route for the same event type → a different
   channel, POST the event → a message in each channel, two independent `delivery_log` rows.
   (US1-5, FR-006.)

10. **Runtime routing (no redeploy)** — with the service running, add a route via the store's
    editor, POST a matching event → delivered; then disable that route, POST again → not
    delivered. No restart. (US2-1/2, SC-001.)

11. **Discord unavailable** — point the target at an unreachable webhook URL (or simulate a
    Discord outage), POST a matching event → inbound still `202`; delivery retried then recorded
    `failed`; `/api/health` stays `200`. (Edge case, FR-012/014, SC-008.)

12. **Routing store unavailable** — stop the DB, POST a matching event → `503` (sender should
    retry); `/ping` still replies; `/api/health` stays `200`. (Edge cases, FR-004b/019/020,
    SC-008.)

13. **Target repoint** — with the service running, edit the Discord target to point at a
    different channel, POST a matching event → the message appears in the new channel, not the
    old one; no restart. (US2-3, FR-007.)

14. **Extended idle / reconnect** — leave the bot idle for an extended period, then run `/ping`
    → it still replies promptly, demonstrating the connection persists/auto-reconnects.
    (US3-3, SC-006.)

## Quality gate

`npm run check:all` (format + lint + typecheck + Vitest) MUST pass. Tests include: supertest
coverage of the webhook endpoint (happy / 401 / 404 / no-route / 503) and readiness, and unit
tests for the ClickUp adapter (verify + parse), the routing engine (exact match, fan-out,
idempotency), the registries, and the default transform.
