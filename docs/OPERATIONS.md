# Operations — snackbyte-discord

Durable operational reference for running, deploying, and managing the Discord integration
hub. (This is the permanent home for ops knowledge; the transient spin-up notes live in
`MORNING.md` and are deleted once setup is complete.)

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
in git**. Set/rotate them on the service:

```bash
gcloud run services update snackbyte-discord \
  --project snackbyte-apps --region us-central1 \
  --update-env-vars DISCORD_BOT_TOKEN=...,DISCORD_APP_ID=...,DISCORD_DEV_GUILD_ID=...,DATABASE_URL=...,CLICKUP_WEBHOOK_SECRET=...,DEMO_CHANNEL_WEBHOOK=...
```

Required names are documented in `.env.example`. Hardening upgrade: store each in Google
Secret Manager and use `--set-secrets` instead of `--update-env-vars` so values aren't visible
in the service config.

## Database (routing store)

PostgreSQL (Supabase). Schema + seed: `migrations/0001_init.sql`. Apply with
`npm run migrate` (needs `DATABASE_URL`; idempotent). Operators add/strike routes by editing
the `routes` table directly (Supabase Table Editor is the day-one admin UI) — no redeploy;
the engine reads routes live per event.

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
