# Operations — snackbyte-discord

Durable operational reference for running, deploying, and managing the Discord integration
hub.

## Environments

| Env            | Domain                  | Cloud Run service           | Branch | Always-on?                                                                  |
| -------------- | ----------------------- | --------------------------- | ------ | --------------------------------------------------------------------------- |
| **Production** | `discord.snackbyte.io`  | `snackbyte-discord`         | `main` | **Yes — `min-instances=1`** (the bot holds a persistent gateway connection) |
| **Staging**    | `discord.snackbyte.dev` | `snackbyte-discord-staging` | `dev`  | **No — `min-instances=0`** by default; toggled on for test sessions         |

Project: `snackbyte-apps` · Region: `us-central1` · Load balancer IP: `136.110.245.98`.

### Why prod is always-on and staging is not

The service runs an always-on Discord **gateway** (a persistent WebSocket), not just an HTTP
request/responder. A scale-to-zero instance drops that connection and the bot goes offline —
and a gateway event (e.g. someone running `/ping`) does **not** arrive as an inbound HTTP
request, so it cannot wake a zero-scaled instance. Therefore **prod must be `min-instances=1`**.

Staging stays at `min-instances=0` (≈ $0 idle). Because **you** are the trigger when testing,
you don't need auto-wake: bump it to `1` for the test window, then back to `0`. The webhook
half still cold-starts on an inbound webhook, but the bot half is only alive while min=1.

## Staging: activate / deactivate

```bash
# Activate before a test session (bot connects, ~ a few $/mo while on):
gcloud run services update snackbyte-discord-staging \
  --project snackbyte-apps --region us-central1 --min-instances=1

# Deactivate when done (bot disconnects, billing stops):
gcloud run services update snackbyte-discord-staging \
  --project snackbyte-apps --region us-central1 --min-instances=0
```

## Deploying

```bash
# Production (manual): builds from source via Cloud Build, deploys to Cloud Run.
gcloud run deploy snackbyte-discord --source . \
  --project snackbyte-apps --region us-central1 \
  --allow-unauthenticated --min-instances=1 \
  --ingress=internal-and-cloud-load-balancing

# Staging (manual):
gcloud run deploy snackbyte-discord-staging --source . \
  --project snackbyte-apps --region us-central1 \
  --allow-unauthenticated --min-instances=0 \
  --ingress=internal-and-cloud-load-balancing \
  --set-env-vars APP_ENV=staging
```

There is also `scripts/deploy.sh <service> <project> <region> [version]` (a thin wrapper for
a manual prod deploy; it does not set `--min-instances`/`--ingress`, so prefer the explicit
commands above for this service). The CI `deploy` job is per-app and not yet wired into
`.github/workflows/ci-cd.yml` — deploys are manual for now.

Verify a deploy reports the expected commit:

```bash
curl -s https://discord.snackbyte.io/api/version    # prod
curl -s https://discord.snackbyte.dev/api/version   # staging (cold-start if min=0)
```

## Secrets / configuration

The app reads config from environment variables; **secret values never live in the database**
(rows hold reference _names_; `src/config.ts#resolveSecret` maps a name → env var) **and never
in git**.

**Set or rotate secrets with the helper script** — it reads a local env file and pushes the
recognized keys to the right service without ever echoing values:

```bash
./scripts/set-secrets.sh prod        # reads .env         -> snackbyte-discord
./scripts/set-secrets.sh staging     # reads .env.staging -> snackbyte-discord-staging
```

Per-environment isolation: prod reads `.env`, staging reads `.env.staging` (gitignored) — so
the two environments can hold different bot tokens/apps, databases, etc. To rotate one secret
(e.g. the Discord bot token after a Reset Token): update its line in the env file, run the
script for that environment, then check `/api/ready`.

Manual equivalent (if you prefer not to use the script) — note the `^|^` delimiter, needed
because values like `DATABASE_URL` contain commas/colons:

```bash
gcloud run services update snackbyte-discord \
  --project snackbyte-apps --region us-central1 \
  --update-env-vars "^|^DISCORD_BOT_TOKEN=...|DATABASE_URL=...|CLICKUP_WEBHOOK_SECRET=..."
```

Required names are documented in `.env.example`. Hardening upgrade: store each in Google
Secret Manager and use `--set-secrets` instead of `--update-env-vars` so values aren't visible
in the service config.

## Database (routing store)

PostgreSQL (Supabase). Schema + seed: `migrations/0001_init.sql` and later additive migrations
(`0002`–`0005`). Apply with `npm run migrate` (needs `DATABASE_URL`; idempotent). Operators
add/strike routes by editing the `routes` table directly (Supabase Table Editor is the day-one
admin UI) — no redeploy; the engine reads routes live per event.

## Sources

Each inbound source is a code adapter registered in `src/sources/index.ts`, plus a `sources` row
holding its enablement and `secret_ref`. Currently registered: **ClickUp** and **GitHub**.

To wire up GitHub:

1. Set `GITHUB_WEBHOOK_SECRET` (env / `./scripts/set-secrets.sh`); it's referenced by a
   `sources` row with `secret_ref = 'github_webhook_secret'`.
2. Add the `sources` row (`github` / enabled / that `secret_ref`) and `routes` rows. Route
   `event_type` uses a `type.action` discriminator: `pull_request.opened`,
   `pull_request.closed`, `issues.opened`, `issues.closed`, `push` (a merged PR is
   `pull_request.closed` with `data.merged=true`).
3. In GitHub: add a webhook to `https://discord.snackbyte.io/webhooks/github`, content type
   `application/json`, secret = `GITHUB_WEBHOOK_SECRET`, subscribed to the relevant events.

**Per-route formatting/filtering** (the `routes.config` JSONB): `mentionRoleIds` (role ids to
mention), `accentColor` (embed color), and `excludeSubtypes` (suppress events whose normalized
`data.subtype` is listed — recorded as a `filtered` delivery outcome). Set `transform = 'github'`
on a route for GitHub-styled rendering; absent/unknown falls back to the default.

## Delivery targets

Where a route delivers is a `discord_targets` row, referenced by `routes.target_id`. A target has a
`mode` that picks the delivery mechanism; a route switches mechanism just by pointing at a different
target (or changing the target's mode) — rows only, no redeploy.

- **`mode = 'webhook'`** — posts to a channel webhook URL. The row holds `webhook_url_ref` (a
  reference name, e.g. `demo_channel_webhook`, resolved from env at runtime — never the URL itself).
  Posts under whatever name/avatar the channel webhook is configured with.
- **`mode = 'bot'`** — posts into a channel **as the bot**, via the bot's REST client. The row holds
  `channel_id` (required — the channel to post into) and may hold `guild_id` (optional, for operator
  readability). No `webhook_url_ref`. Use this to post under the bot's own identity, or to reach a
  channel that has no webhook.

**Operational precondition for a bot target**: the bot must be a member of the target guild and have
permission to post in the target channel. The hub does not grant this — arrange it in Discord. If it
is missing (or the channel id is wrong/deleted), that delivery is recorded in `delivery_log` as
`failed` with a diagnosable reason (e.g. a 403/404 from Discord), recorded immediately without
retrying; other routes for the same event are unaffected and the inbound provider is still
acknowledged. Transient problems (rate limits, Discord 5xx, the bot briefly unable to reach Discord)
are retried with backoff before being recorded as `failed`.

The bot path reuses the existing `DISCORD_BOT_TOKEN` — no new secret. Migration `0005` enforces the
per-mode required field (a `bot` row must have `channel_id`; a `webhook` row must have
`webhook_url_ref`), so a half-configured target is rejected in the table editor rather than failing
at delivery time.

## Slash commands

```bash
npm run deploy:commands   # registers /ping etc. with Discord
```

Guild-scoped (instant) when `DISCORD_DEV_GUILD_ID` is set; global (~1h propagation) otherwise.
Run whenever the set of commands changes.

## Networking (how the domains are wired)

All snackbyte apps share one global external HTTPS load balancer (IP `136.110.245.98`) and
wildcard managed certs (`*.snackbyte.io`, `*.snackbyte.dev`). Each service is reached through
the LB, not its `*.run.app` URL (prod/staging use `--ingress=internal-and-cloud-load-balancing`).

Per environment the wiring is: a serverless **NEG** → a **backend service** → a **host rule**
in the shared `snackbyte-url-map`, plus one **DNS A record** → the LB IP.

- NEGs: `snackbyte-discord-neg`, `snackbyte-discord-staging-neg`
- Backends: `snackbyte-discord-backend`, `snackbyte-discord-staging-backend`
- url-map host rules: `discord.snackbyte.io` → prod backend, `discord.snackbyte.dev` → staging
- DNS (GoDaddy): `A discord → 136.110.245.98` on both `snackbyte.io` and `snackbyte.dev`

Adding a future subdomain reuses the wildcard cert and the LB — only a NEG, backend, host
rule, and one A record are new. **DNS writes are gated** — surface the exact `godaddy dns`
command for a human to approve; do not run live DNS changes unprompted.

Verify routing through the LB before DNS exists (or to debug):

```bash
curl -s --resolve discord.snackbyte.io:443:136.110.245.98 https://discord.snackbyte.io/api/version
```

> New LB host rules can take a few minutes to propagate; during that window the LB may serve
> its default backend (currently `snackbyte-site`). If `/api/version` shows the wrong app right
> after wiring, wait and re-check before assuming a misconfiguration.

## Endpoints

| Path                     | Purpose                                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`        | Liveness — 200 whenever the process is up, independent of DB/gateway.                                                                                |
| `GET /api/ready`         | Readiness — 200 only when DB reachable **and** gateway connected; else 503 naming the down dependency.                                               |
| `GET /api/version`       | Deployed version/commit/env.                                                                                                                         |
| `POST /webhooks/:source` | Inbound webhook (e.g. `/webhooks/clickup`). Verifies signature → 401 on bad sig, 404 unknown source, 503 if the store is unreachable, 202 on accept. |

## Logs

```bash
gcloud run services logs read snackbyte-discord --project snackbyte-apps --region us-central1 --limit 50
gcloud run services logs read snackbyte-discord-staging --project snackbyte-apps --region us-central1 --limit 50
```

Structured (pino) JSON; secrets, tokens, and full payloads are redacted at the logger.

## Local development

```bash
cp .env.example .env   # fill in values
npm install
npm run dev            # Express + bot in one process
npm run check:all      # format + lint + typecheck + tests (must pass before merge/deploy)
```
