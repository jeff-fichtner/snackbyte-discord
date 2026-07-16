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

**Deploys are automatic — the branch selects the environment.** Push and CI does the rest:

```bash
git push origin dev     # -> tags vX.Y.Z-dev, builds, deploys snackbyte-discord-staging
git push origin main    # -> tags vX.Y.Z,     builds, deploys snackbyte-discord
```

The `deploy` job (`.github/workflows/ci-cd.yml`) runs only if the gate passed and a tag was
produced, authenticates to GCP via Workload Identity Federation (keyless), checks out the
**tagged** commit, builds via `cloudbuild.yaml`, deploys, and then **verifies the load balancer
actually reports the new tag** before going green.

Two safety properties worth knowing, both learned the hard way:

- **Env vars are merged, never replaced.** `cloudbuild.yaml` uses `--update-env-vars` (plus an
  explicit `--remove-env-vars=APP_ENV` on the prod path). `--set-env-vars` would REPLACE the whole
  environment and delete every runtime secret CI doesn't know about (bot token, `DATABASE_URL`, the
  signing secrets) — taking the bot offline and 401-ing every webhook.
- **Prod's `min-instances` is pinned to 1 by the pipeline**, so a deploy can never leave the
  always-on gateway scaled to zero. Staging omits the flag, preserving its manual 0/1 toggle.

**Manual deploy** (rarely needed — e.g. deploying an uncommitted tree):

```bash
gcloud run deploy snackbyte-discord --source . \
  --project snackbyte-apps --region us-central1 \
  --allow-unauthenticated --min-instances=1 \
  --ingress=internal-and-cloud-load-balancing
```

⚠️ **Never pass `--set-env-vars` to a manual deploy of this service** — same wipe. Omit it (env is
preserved) or use `--update-env-vars`. There is also `scripts/deploy.sh` (a thin wrapper that does
not set `--min-instances`/`--ingress`, so prefer the explicit command above).

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
./scripts/set-secrets.sh prod        # reads .env.prod    -> snackbyte-discord
./scripts/set-secrets.sh staging     # reads .env.staging -> snackbyte-discord-staging
```

### The three local env files

All are gitignored (`.env.*`), `chmod 600`, and never committed — they live only on your machine.

| File           | Points at                                            | Loaded by                                                   |
| -------------- | ---------------------------------------------------- | ----------------------------------------------------------- |
| `.env`         | **local dev** — the dev Discord app + the staging DB | `npm run dev`, `npm run migrate`, `npm run deploy:commands` |
| `.env.staging` | staging Cloud Run (same dev app + staging DB)        | `./scripts/set-secrets.sh staging`                          |
| `.env.prod`    | **prod only**                                        | `./scripts/set-secrets.sh prod`                             |

**Why `.env` is dev, not prod.** `.env` is what every local command loads by default, so it is
deliberately the harmless one: the worst a careless `npm run dev` or `deploy:commands` can do is
poke the dev app and the staging database. Prod credentials live **only** in `.env.prod` and in
Cloud Run, so no local command defaults to touching production. (Previously `.env` held prod's
token and DB — meaning `npm run dev` logged in as the prod bot against the prod database, and
`deploy:commands` registered commands into a live server.)

To rotate a secret (e.g. the Discord bot token after a Reset Token): update its line in the
relevant env file, run the script for that environment, then check `/api/ready`.

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
(`0002`–`0006`). Apply with `npm run migrate` (needs `DATABASE_URL`; idempotent). Operators
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
npm run deploy:commands   # registers /ping, /role, /roles, /nick with Discord
```

Guild-scoped (instant) when `DISCORD_DEV_GUILD_ID` is set; global (~1h propagation) otherwise.
Run whenever the set of commands changes.

## Self-service roles & nicknames

Members manage their own roles and nickname through slash commands, gated by an operator-curated
whitelist:

- `/role <role>` — toggle a self-assignable role on yourself (adds if you lack it, removes if you
  have it). Only roles in the whitelist can be toggled; any other pick is refused.
- `/roles` — list the roles currently self-assignable in the server.
- `/nick [nickname]` — set your server nickname (max 32 chars), or reset it by leaving it blank.

**Note on `/nick` vs. Discord's built-in `/nick`**: Discord ships a built-in `/nick` that sets the
invoker's _own_ nickname (gated by the "Change Nickname" permission). Ours is the superset: it does
self-nick _and_ nicknames **other** members (see "Reaction-roles & moderation" below), which the
built-in cannot do. If you want ours to be the only `/nick` members see, remove **Change Nickname**
from `@everyone` (Server Settings → Roles → @everyone) — the built-in then disappears for members and
they change nicknames only through the bot. Otherwise both appear in the picker (distinguished by the
app icon); ours still works. This is a per-server operator choice; the app cannot un-register a
Discord built-in.

**Whitelisting a role** (operator): add a row to the `self_assignable_roles` table —
`guild_id = <the server id>`, `role_id = <the role id>`. Presence of the row is the whole
authorization; remove the row to stop a role being self-assignable. Edited live, no redeploy (like
routes). The app never auto-adds a role.

**Operational precondition**: the bot's role must sit **above** the roles it manages, and the bot
must have **Manage Roles** and **Manage Nicknames** in the server. If a role/member is above the
bot, or a permission is missing, the command refuses safely with a diagnosable message and changes
nothing — it never half-acts. Whitelisting an admin role does not let a member escalate: the
bot-position guard still refuses anything above the bot, so position the bot's role deliberately.

The self-service commands use the `Guilds` + `GuildMembers` gateway intents (reaction-roles add one
more — see below). **Message Content is never used.** After adding new commands, run
`npm run deploy:commands`.

## Reaction-roles & moderation

Two capabilities layered over the same role/nickname logic and the same whitelist.

### Reaction-roles

Members get a whitelisted role by **reacting** to an operator-configured message, and lose it by
removing the reaction (the reaction is the source of truth — un-reacting removes the role even if the
member also self-assigned it). No command is typed.

**Configure a mapping** (operator): add a row to the `reaction_role_mappings` table:

| Column       | Value                                                                            |
| ------------ | -------------------------------------------------------------------------------- |
| `guild_id`   | the server id                                                                    |
| `message_id` | the message to react on (Developer Mode → Copy Message ID)                       |
| `emoji_key`  | **unicode**: the emoji character, e.g. `🔔` · **custom**: the emoji's numeric id |
| `emoji_kind` | `unicode` or `custom` (must match `emoji_key`)                                   |
| `role_id`    | the role to grant                                                                |

Edited live, no redeploy (like routes/whitelist). A `(guild, message, emoji)` maps to exactly one
role; the same role may appear in several mappings.

**Authorization is the intersection**: a reaction grants a role only when a mapping exists **and**
the role is on the `self_assignable_roles` whitelist. A mapping to a non-whitelisted role is a
silent no-op — a mapping never bypasses the whitelist, and the app never auto-adds a role to it. So
whitelisting a role (as above) is required in addition to the mapping.

**Gateway intent**: reaction-roles add the `GuildMessageReactions` intent and the Message/Reaction
partials (so reactions on older, un-cached messages still work). **Message Content stays off** — no
privileged Message Content is needed or requested. In the Discord Developer Portal the bot needs the
**Server Members Intent** (already on from 004); it does **not** need Message Content.

### Moderating other members

Members with the right permission act on **other** members through the same commands:

- `/nick [nickname] member:@X` — set or reset member @X's nickname. Requires the invoker to have
  **Manage Nicknames**. Without a `member`, it changes your own nickname (unchanged self-service).
- `/role role:@R member:@X` — toggle role @R on member @X. Requires the invoker to have **Manage
  Roles**. Not limited to the self-assignable whitelist (moderators manage roles a member could not
  self-assign). Without a `member`, it toggles a whitelisted role on yourself (unchanged).

A member without the permission is refused when they target someone else, but keeps their own
self-service ability. Two hierarchy guards always apply and refuse safely (never a half-action):

- **Bot-position**: the bot must be above the target role/member and hold the relevant permission.
- **Invoker-position** (role only): a moderator cannot grant a role at or above their **own** highest
  role — mirrors Discord's own rule and prevents privilege escalation.

Moderation reads its target/role/nickname from command options, not message text, so it needs **no**
new gateway intent and **no** Message Content.

## Moderation commands (sanctions, ban-list, channel/message)

The full stateless moderation surface. Each command is gated by the invoker's **native** Discord
permission — grant the bot's role only the specific permissions the commands you use require (least
privilege, never Administrator):

| Command                                                         | Native permission required | What it does                                                                                                             |
| --------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `/timeout member duration [reason]`                             | Moderate Members           | Time a member out (e.g. `10m`, `2h`, `7d`; `0` clears). Self-expires.                                                    |
| `/kick member [reason]`                                         | Kick Members               | Remove a member (they can rejoin).                                                                                       |
| `/ban member \| user_id \| user_ids [reason] [delete_messages]` | Ban Members                | One command: ban a present member, pre-emptively ban a user id, or bulk-ban several ids. Optional 0–7 day message purge. |
| `/unban user_id [reason]`                                       | Ban Members                | Remove a user id from the ban list.                                                                                      |
| `/bans`                                                         | Ban Members                | List the current bans (ephemeral).                                                                                       |
| `/purge count [reason]`                                         | Manage Messages            | Bulk-delete recent messages (1–100). Messages >14 days can't be bulk-deleted and are reported as skipped.                |
| `/slowmode seconds`                                             | Manage Channels            | Set (or clear with `0`) the channel's slowmode.                                                                          |
| `/lock` · `/unlock`                                             | Manage Channels            | Deny / allow members sending in the channel.                                                                             |
| `/pin` · `/unpin` `message_id`                                  | Manage Messages            | Toggle a message's pinned state.                                                                                         |

**Guards** (member sanctions): the bot must outrank the target and hold the permission (bot-position),
and the target must be below the invoking moderator's own highest role (invoker-position) — a
moderator can't sanction someone above themselves. Every guard failure is a safe refusal, never a
half-action. Reasons are recorded in the **platform audit log** (Discord's own) where the action
supports one — there is **no** bot-side infractions store (that's a later feature).

**No new gateway intent** — sanctions/channel commands add only bot-role _permissions_. Bot role must
sit above the members/roles it manages.

## Role menus via buttons / select menus

Members can toggle a whitelisted role by clicking an operator-configured button or picking a select
option — the same result as `/role` or a reaction, reusing the same self-assignable whitelist.

**Configure a binding** (operator): add a row to `component_role_bindings`:

| Column           | Value                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| `guild_id`       | the server id                                                                                         |
| `component_key`  | the button's `customId` (must start with `role:`), or a select's `customId` + `::` + the option value |
| `component_kind` | `button` or `select`                                                                                  |
| `role_id`        | the role to toggle (must also be on `self_assignable_roles`)                                          |

Edited live, no redeploy. Authorization is the intersection: a binding grants a role only if the role
is **also** whitelisted. Buttons need **no** new intent (components arrive on the existing interaction
gateway). Name components with the `role:` prefix so the bot's role-component handler claims them.

## Text-prefix commands (`!role`, `!roles`, `!nick`) — opt-in, needs Message Content

Off by default. Enabling it turns on the privileged **Message Content** intent for the whole bot (it
is per-connection — it cannot be scoped per guild), so this is a deliberate deploy choice:

1. Set `TEXT_PREFIX` (e.g. `!`) in the environment — a non-empty value both enables the style and
   makes the bot request Message Content.
2. In the Developer Portal, turn ON the **Message Content Intent** for the bot. Redeploy.
3. `!role <name>`, `!roles`, `!nick [name]` then run the same role/nickname capabilities as the slash
   commands, with the same whitelist gate.

**When `TEXT_PREFIX` is unset (the default):** the bot does not request Message Content, the
`messageCreate` handler is a no-op, and every other style (slash, reaction, components) works — full
least privilege.

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
