# Morning handoff — snackbyte-discord

> Built and deployed overnight while you slept. The **code is done, tested, and deployed
> live**; it boots and stays healthy. What's left is the stuff only you can do: create the
> external accounts/keys (Discord, Supabase, ClickUp) and run the end-to-end tests. This
> doc is the checklist.

## TL;DR — current state

- **Walking-skeleton feature is fully implemented** (US1 webhook pipeline + US2 runtime
  routing + US3 bot) on branch `001-walking-skeleton`, merged to `main`.
- **Live on real domains:** **prod `https://discord.snackbyte.io`** (always-on, `min-instances=1`)
  and **staging `https://discord.snackbyte.dev`** (`min-instances=0`, toggle on to test). Shared
  load balancer + wildcard certs; the `*.run.app` URLs are LB-only (404 by design).
- **27 tests pass; `npm run check:all` is green.** The service boots with HTTP up and
  **degrades gracefully** with no secrets — right now `/api/health` is 200 and `/api/ready`
  is 503 (`db: down, gateway: down`) because the keys below aren't set yet.
- **Nothing is broken.** It's waiting on keys.
- **Ops reference:** durable runbook (deploy, staging toggle, secrets, domains, logs) is in
  **[`docs/OPERATIONS.md`](docs/OPERATIONS.md)** — that's the permanent home; this file is transient.

> ✅ **Convergence fix shipped + deployed.** A convergence pass (`/speckit-converge`) caught a
> Constitution-I violation (the webhook route hardcoded `clickup` to resolve its secret). It's
> fixed, pushed (`main`, tag `v0.1.3`), and **redeployed live** — the service now runs commit
> `dcce3a8` (verify: `curl .../api/version`). Nothing pending here; on to the keys below.

## What only you can do (the keys) — do these in order

Each external account is something I cannot create or authenticate to. Set the secrets in
**Cloud Run** (so the live service picks them up) and/or in a local `.env` (to test locally).

### 1. Discord bot (for the bot half — `/ping`, etc.)

1. Go to https://discord.com/developers/applications → **New Application** → name it.
2. **Bot** tab → **Reset Token** → copy it → this is `DISCORD_BOT_TOKEN`. Keep it secret.
3. **General Information** → copy **Application ID** → this is `DISCORD_APP_ID`.
4. **Privileged Gateway Intents**: enable **Server Members Intent** (the bot observes
   member-joins). Do NOT enable Message Content — this slice doesn't need it.
5. **OAuth2 → URL Generator**: scopes `bot` + `applications.commands`; bot permissions
   `Send Messages`. Open the URL, add the bot to your test server.
6. Copy your test server's id (enable Developer Mode in Discord → right-click server → Copy
   Server ID) → this is `DISCORD_DEV_GUILD_ID` (for instant slash-command registration).

### 2. Supabase (the routing store)

1. Go to https://supabase.com → new project (free tier). Wait for it to provision.
2. **Project Settings → Database → Connection string** (URI form) → this is `DATABASE_URL`.
   (Use the connection-pooler string if offered; either works.)
3. Apply the schema: locally, with `DATABASE_URL` set in `.env`, run **`npm run migrate`**.
   This creates `sources`, `discord_targets`, `routes`, `delivery_log` and seeds one demo
   route (clickup `taskStatusUpdated` → the demo target). Re-running is safe (idempotent).
   - The seed references secret _names_ `clickup_webhook_secret` and `demo_channel_webhook`
     (see step 4). The Supabase **Table Editor** is your admin UI to add/strike routes.

### 3. Discord delivery webhook (where messages land)

1. In your Discord channel → **Edit Channel → Integrations → Webhooks → New Webhook** →
   copy its URL → this is `DEMO_CHANNEL_WEBHOOK`.
   - The DB target row stores the _name_ `demo_channel_webhook`; the env var holds the URL.

### 4. ClickUp (the inbound source)

1. ClickUp → your Space/Workspace → **Settings → Webhooks** (or the API) → create a webhook
   pointing at `https://discord.snackbyte.io/webhooks/clickup`.
2. Subscribe it to task events (e.g. `taskStatusUpdated` to match the seed route).
3. Copy the webhook's **signing secret** → this is `CLICKUP_WEBHOOK_SECRET`.

### 5. Put the secrets on Cloud Run

Set them as env vars on the live service (replace the values):

```bash
gcloud run services update snackbyte-discord \
  --project snackbyte-apps --region us-central1 \
  --update-env-vars \
DISCORD_BOT_TOKEN=...,DISCORD_APP_ID=...,DISCORD_DEV_GUILD_ID=...,DATABASE_URL=...,CLICKUP_WEBHOOK_SECRET=...,DEMO_CHANNEL_WEBHOOK=...
```

> **Better (optional) hardening:** put each secret in **Google Secret Manager** and reference
> it with `--set-secrets` instead of `--update-env-vars`, so values aren't visible in the
> service config. Env vars are fine to start; the app already keeps secrets out of logs and
> out of the database (only reference _names_ live in rows). See the note at the bottom.

After updating, the service restarts; `/api/ready` should flip to `200`.

### 6. Register the slash commands (once)

Locally, with `DISCORD_BOT_TOKEN`/`DISCORD_APP_ID`/`DISCORD_DEV_GUILD_ID` in `.env`:

```bash
npm run deploy:commands
```

Guild-scoped (instant) because `DISCORD_DEV_GUILD_ID` is set. (For global/production
commands, unset it and re-run — propagation can take ~1h.)

## Tests to run in the AM (end-to-end)

Once the keys are in and `/api/ready` is `200`:

1. **Bot online / `/ping`** — in Discord, run `/ping` → prompt "Pong! (Nms)" reply. Bot shows
   online. (US3)
2. **Health/readiness** —
   `curl https://discord.snackbyte.io/api/health` → 200;
   `.../api/ready` → 200 with `db: ok, gateway: ok`.
3. **Real ClickUp event** — change a task's status in ClickUp → within a few seconds a
   formatted message (summary + link) appears in your Discord channel. (US1)
4. **Idempotency** — re-send/replay the same event → still exactly one message in Discord.
5. **Runtime routing (no redeploy)** — in Supabase Table Editor, add a second `routes` row
   for the same event type pointing at a different target, then trigger the event → it lands
   in both channels; disable (set `enabled=false`) one row → it stops. No restart. (US2)
6. **Bad signature** — `curl -X POST .../webhooks/clickup -d '{}'` (no valid `X-Signature`)
   → `401`, nothing posted.
7. **Local run** (optional) — `npm run dev` with `.env` filled → same behavior locally.

Full validation script with expected outcomes:
`specs/001-walking-skeleton/quickstart.md` (14 scenarios).

## Useful commands

```bash
# Live logs
gcloud run services logs read snackbyte-discord --project snackbyte-apps --region us-central1 --limit 50

# Redeploy after code changes (manual)
gcloud run deploy snackbyte-discord --source . --project snackbyte-apps --region us-central1 \
  --allow-unauthenticated --min-instances=1

# Local: quality gate + dev
npm run check:all        # format + lint + typecheck + 27 tests
npm run dev              # Express + bot in one process (needs .env)
npm run migrate          # apply DB schema (needs DATABASE_URL)
npm run deploy:commands  # register slash commands (needs bot token/app id)
```

## Known limitations / decisions (so nothing surprises you)

- **Acknowledge-then-deliver (async, in-process):** the webhook returns `202` immediately on
  a verified request, then delivers to Discord in the background. A crash in that window can
  drop one in-flight event (no durable queue yet — a later-phase "outbox"). Idempotency
  covers normal sender retries.
- **One source (ClickUp), one delivery style (channel webhook), minimal bot** — by design for
  the walking skeleton. GitHub/other sources, bot-REST delivery, and BED-BOT parity
  (roles/nicknames) are later features (see `ARCHITECTURE.md` Phase 2/3).
- **Secrets as env vars on Cloud Run** for now (Secret Manager is the hardening upgrade).
- **`ARCHITECTURE.md` is marked temporary** — it's design input for Spec Kit and is slated
  for removal once its content is absorbed into `specs/`.
- **Unrelated:** the collaborator's `Bjarkirzz/BED-BOT` repo has a live bot token committed
  in `bot.py` — flag to them to regenerate it (Discord Developer Portal). Not part of this
  repo; noted because it came up.

## Where things live

- Spec/plan/tasks: `specs/001-walking-skeleton/` (spec.md, plan.md, tasks.md, contracts/,
  data-model.md, quickstart.md, research.md).
- Constitution: `.specify/memory/constitution.md` (7 principles).
- Source map: `ARCHITECTURE.md` §6, and the four extension folders `src/sources/`,
  `src/routing/transforms/`, `src/bot/commands/`, `src/bot/events/`.
