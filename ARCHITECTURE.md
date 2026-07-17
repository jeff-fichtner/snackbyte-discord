# Architecture Document — Discord Integration Hub (forward-looking)

> ⚠️ **TEMPORARY — shrinking toward deletion.** This file began as the full pre-spec design
> input for the hub. **As each piece of work is spec'd and built, its content is deleted from
> here** — the durable record lives in the per-feature specs (`specs/NNN-*/`), the operations
> runbook (`docs/OPERATIONS.md`), and the constitution (`.specify/memory/constitution.md`). This
> is not a changelog: shipped work is removed, never marked "done." What remains is only the
> **not-yet-built** roadmap and the cross-cutting context a future spec needs. When nothing
> forward-looking is left, delete this file.

**Project:** `snackbyte-discord` — a multi-tenant Discord integration hub (inbound webhooks,
outbound posts, and a gateway bot). Discord-centric by design; a future Slack/other-platform hub
would be a separate codebase (e.g. `snackbyte-slack`), sharing only the generic canonical-event +
routing core.

**Governed by:** the standalone **snackbyte-discord Constitution v2.0.0**
(`.specify/memory/constitution.md`).

---

## 1. Goal & framing (carried into every phase)

The hub's reason for existing is **cheap extension — for its engineers and for its tenants.**
Adding the next inbound source or route must be near-zero effort for an engineer. Adding the next
command, face, or rule must be near-zero effort for a **tenant who cannot ship code and never
will.** The architecture's job is to keep both true as the hub grows.

Governing principles (full text in the constitution): patterns over instances; verify before
process; idempotent, rate-limited delivery through one chokepoint; compile-time-safe primitives
vs. runtime-composed instances; always-on resilience; secrets by reference; tenant isolation by
default.

The engineer-facing half already exists as working code (source-adapter registry, canonical event,
routing table + engine, single delivery service, command/event registries, liveness/readiness
split). **The tenant-facing half does not exist at all** — §3 is the plan to build it.

---

## 2. The settled model

This is the output of the design pass that produced constitution v2.0.0. It is decided, not
exploratory. Later specs implement it; they do not relitigate it.

### 2.1 One application, many tenants

**One** Discord application — `snackbyte` — installed per guild via OAuth. Not one per tenant.
This is how every large Discord bot works, and it scales to Discord's shard boundary (~2500
guilds) with no change to the current one-warm-instance deploy.

**The guild install is the tenant boundary.** Everything a tenant can do flows from the bot being
in their guild; the one exception is driving a webhook someone handed over, which needs no install
at all (see 2.3).

### 2.2 The layering

| Layer        | Contents                                                 | Tenant-scoped?                |
| ------------ | -------------------------------------------------------- | ----------------------------- |
| **Platform** | the Discord application, the process, the database       | **no** — and must not pretend |
| **Tenant**   | installations, sources, routes, faces, commands, secrets | **yes** — every row is owned  |

The application is **platform infrastructure, not tenant data**. A tenant never has an app, never
sees one, never configures one. Its singular values are _correct_, not placeholders. It is stored
as a row (one row, one token reference) purely so that identity is always a **lookup** and never a
**constant** — the seam that keeps a second application a data change instead of a rewrite.

The decisive test, applied everywhere: **if a second tenant would need a different value, it is
data — not config.**

### 2.3 Faces are webhooks, not applications

A tenant's custom identity ("miss honey") is a **webhook the hub mints**, not a second Discord
application. Discord exposes no API to create an application, so a per-tenant bot user can only
ever be a manual Developer-Portal chore — which is exactly the "no code" this product exists to
delete.

Webhook mode is therefore **the persona engine, not legacy debt.** It is the only way to get a
custom name _and_ avatar, it is free, and one webhook can wear unlimited faces because
`username`/`avatar_url` are per-message overrides. The hub needs roughly **one webhook per
channel** (hard cap: 15/channel), not one per persona.

The capability split that shapes every design here:

| Webhook operation                        | Needs the bot in the guild?           |
| ---------------------------------------- | ------------------------------------- |
| execute, read, rename, re-avatar, delete | **no** — the token is total authority |
| **create, list**                         | **yes** — `MANAGE_WEBHOOKS`           |

Only **create** and **list** have no token door. That is the entire value of the install, for
webhooks: the ability to **mint** faces and **discover** them. Everything else the hub does with a
webhook, anyone holding the URL could do.

Two consequences:

- **A webhook URL is a credential, never an address.** Possession is total control of that face,
  forever, with no membership or permission check. It never appears in a browsable row.
- **Minting beats consuming, for authorization.** A pasted URL proves nothing — anyone can paste
  any URL for any server, which in a multi-tenant product is a spam relay with your name on it.
  Minting cannot be faked: the bot is in the guild, so someone holding `MANAGE_GUILD` put it
  there. Consuming a pasted URL stays supported (it is how every route works today, and it is the
  only way to reach a guild the bot is not in) but it is a distinct, more-privileged capability
  that needs its own justification — never the default.

### 2.4 The three output shapes

Ephemeral exists **only** inside the interaction system, and the interaction system speaks **only**
as the application. Webhooks can never be ephemeral. Therefore:

| Output              | Mechanism                    | Who sees it  | Custom face?         |
| ------------------- | ---------------------------- | ------------ | -------------------- |
| Private             | interaction reply, ephemeral | invoker only | ❌ (moot)            |
| Public, bot face    | interaction reply, public    | channel      | name only (nickname) |
| Public, custom face | webhook persona              | channel      | ✅ name + avatar     |

**There is no private message from a custom face.** Not a gap — a structural fact.

This makes **"who sees this?" a first-class knob on every command**, not an implementation
detail: it selects the mechanism, and the mechanism decides whether a face is even available. The
composer UI must refuse to build the impossible combination rather than silently drop one half.

Bot messages render with the bot's **per-guild nickname**, so the one application already reads
"miss honey" in one guild and "snackbyte" in another. Only the **avatar** is global, and only the
**command picker** is unavoidably branded.

### 2.5 Scale gates on the one-application model

One application is correct, and it is **not** unbounded. Three external limits bind it, and each
fires at a knowable size. They are not hypothetical — they are Discord's published thresholds, and
two of them are reachable by a friends-and-family product.

| Gate                  | Fires at              | Consequence                                                |
| --------------------- | --------------------- | ---------------------------------------------------------- |
| **Bot verification**  | **100 guilds**        | privileged intents are **cut off** unless Discord approves |
| **Sharding**          | ~2500 guilds          | one gateway connection is no longer allowed                |
| **Global rate limit** | ~50 req/s, **shared** | every tenant draws from one bucket                         |

**Verification is the near-term one, and it is a lead-time item, not a spec.** The bot requests
`GuildMembers` unconditionally (`src/bot/client.ts`) — the entire roles/moderation surface runs on
it — and `GuildMembers` is **privileged**. At the 100th guild, Discord requires the application to
be verified to keep it: an application review, a privacy policy, terms of service, and a written
justification per intent. Review takes weeks. **Hitting 100 unverified cuts `GuildMembers` off for
every tenant at once**, so this must be started well before it binds. `MessageContent` (behind
`TEXT_PREFIX`) is privileged too, and is the harder one to justify in review.

**Sharding is what makes the connection manager inevitable.** At ~2500 guilds Discord _requires_
multiple gateway connections for a single application. That is the same seam BYO-app needs — _the
process stops holding exactly one `Client`_ — so the manager gets built for sharding whether or not
a tenant ever wants their own bot.

**The global rate limit is what makes BYO-app inevitable.** Constitution III requires the delivery
service to arbitrate fairly between tenants, but fairness only divides a fixed pie. Past some N,
the pie itself is the ceiling, and the only way to get more buckets is more applications.

### 2.6 BYO-app is the last phase, not a maybe

A tenant bringing their **own** Discord application buys: their avatar on ephemeral replies, their
name/icon in the command picker, a distinct member-list entry, **their own rate-limit bucket**, and
per-guild intents (which re-enable per-guild text prefixes).

An earlier revision of this document priced that as "cosmetics versus the connection manager,
therefore probably never." **That was wrong, and it was wrong in a specific way worth recording:**
it treated the connection manager as a cost BYO-app must justify on its own. It doesn't. Sharding
(§2.5) forces the manager independently, and rate-limit saturation forces _more buckets_
independently. Once the manager exists, BYO-app is a nullable column plus an onboarding flow — and
the "cosmetic" framing was only ever true at a scale where none of the gates had fired.

**So it is scheduled, not speculative: the last phase, gated on a trigger rather than on appetite.**
It is sequenced last because nothing depends on it, not because it is unlikely.

The seam that keeps it cheap until then is exactly two things, both built in Phase A for other
reasons:

1. `applications.tenant_id` nullable — NULL = the platform's shared app. Adding a tenant's own app
   is then `INSERT`, not a migration.
2. Every consumer resolves its client and REST **by application id**. `getClient(appId)` returning
   the one entry from a map, versus returning a sharded connection from a pool, is the same
   signature — so the manager drops in behind the seam without touching a call site.

### 2.7 Two authorization layers, never merged

These answer different questions at different layers, and conflating them is the easiest way to
build a hole that every review passes:

| Layer      | Question                                             | Where it lives                         |
| ---------- | ---------------------------------------------------- | -------------------------------------- |
| **Tenant** | does this tenant own this guild **at all**?          | `src/tenancy/` — core, all three faces |
| **Member** | does this user hold `ManageRoles` **in** this guild? | `bot/moderation/standing.ts` ✅ built  |

Only the second exists today, and it is correct — an invoker's native Discord permission, checked
per capability. But it presumes the guild is legitimately in scope, which was free when one person
owned every guild and is now the whole question.

Tenant authorization is **more fundamental than any bot capability**: it gates whether the
interaction should be looked at, not what the invoker may do. It therefore belongs in core, not in
the moderation module — the gravitational pull will be to put it there because that is where
"permissions" live, and that inverts the layering.

### 2.8 Every interface is an adapter

The rule proven across four Discord interaction styles generalizes one notch:

> **A capability is logic; an _interface_ is an adapter onto that logic.**

A slash command, a button, a reaction, `!prefix`, **and a web form** are all adapters over the same
verbs. The capability layer is already pure enough to support this — 19 exported verbs across
`bot/members/` and `bot/moderation/`, and **zero `discord.js` imports** in any of the logic files
(only the view-builder and the permission-flag map touch the framework).

So the web surface is a **third face, not a new kingdom**. "Mint a face," "assign a role," "add a
route" are capabilities the web UI _invokes_ — the same ones a slash command could invoke tomorrow.
The failure mode is 009 reimplementing them because it feels like "the web app" rather than another
front door; that is the moment the split dies.

---

## 3. The build plan

Ordered **most-reusable-first**: each phase is a foundation the later ones stand on, sized to be
independently specifiable and independently testable. Phases A–G are the product; H and I are
gated on scale triggers (§2.5) rather than appetite, and are sequenced last because nothing
depends on them.

The single hard truth this ordering serves — from the multi-tenancy audit:

> **Tenant identity currently equals the operating-system process.**

One token, one env, one client, one intent set, one owner. Every phase below is a piece of moving
identity out of the process and into rows.

### Phase A — Tenancy foundation

The schema and the seam. Nothing else can be built correctly first.

- `tenants`, `installations` (tenant_id, guild_id, application_id), `applications` (one row,
  platform-owned, `bot_token_ref`).
- `tenant_id` on `sources`, `routes`, `discord_targets`, `delivery_log`.
- **Fix `sources.slug` as a global PK** → `(tenant_id, slug)` + composite FK from `routes.source`.
  Two tenants both integrating ClickUp both need `slug='clickup'`; today they collide on a primary
  key.
- Repository layer takes `tenantId` on every call. **Unscoped access becomes unrepresentable**,
  not merely discouraged.
- **A `src/tenancy/` core module** — `resolveTenant(guildId)`, `assertOwns(...)`. Tenant
  authorization is more fundamental than any bot capability and is needed by all three faces, so
  it lives in core. It must NOT land in `bot/moderation/` just because that is where "permissions"
  currently live: that module answers _"does this user hold `ManageRoles`?"_, which is a different
  question at a different layer (§2.7).
- **The tenant reference is derived, never accepted.** `getRoutes(session.tenantId)` and
  `getRoutes(req.body.tenantId)` have identical signatures and opposite security. Scoping alone
  prevents accidents, not attacks — so a tenant reference must be **structurally unconstructible
  from untrusted input** (an opaque branded type minted only by the resolvers, not a bare
  `string`). The type system will not catch this on its own; the design has to.
- `getContext()` stops being argument-free; `getClient(appId)` / `getRest(appId)` replace the
  boot-time singletons. _(This is the expensive item, and it pays for itself twice — it is the
  same refactor multi-tenancy and BYO-app insurance both need.)_
- The `0001` seed becomes tenant-owned rather than an unowned tenant zero.

**Testable:** today's live config becomes tenant 1 with no behavior change; all existing tests stay
green; new tests prove a query cannot be issued without a tenant, that tenant A cannot read tenant
B's rows, and that a tenant reference **cannot be built from a request-supplied value** — the last
one is the test that matters, because the first two can pass while the system is wide open.

### Phase B — Secret store

The other foundation. Both halves of the app (inbound verify, outbound faces) need it.

- `resolveSecret(ref)` → `resolveSecret(tenantId, ref)`. **The seam is already right; the backend
  is not** — it reads `process.env`, which is process-global and set only by a deploy.
- Backend: a runtime-readable **and runtime-writable** store, so a tenant adding an integration
  does not require a deploy.
- Move out of env: `CLICKUP_WEBHOOK_SECRET`, `GITHUB_WEBHOOK_SECRET`, `DEMO_CHANNEL_WEBHOOK`.
- **Stay in env** (platform config, legitimately): `DISCORD_BOT_TOKEN`, `DISCORD_APP_ID`,
  `DATABASE_URL`, `PORT`, `LOG_LEVEL`, `TEXT_PREFIX`, build stamps.

**Why this is urgent, not tidy:** `gcloud run services update --update-env-vars` **restarts the
service**. With secrets in env, "a tenant adds a server from the UI" and "every tenant's gateway
connection drops" would be the same event. This is the hardest single constraint in the codebase.

**Testable:** add a secret at runtime; no deploy, no restart, gateway stays connected; the new
secret verifies a real inbound request.

### Phase C — Identity & the tenant surface

Turns a tenant from a row into a person. Replaces the `src/web/App.tsx` "Hello world!" scaffold.

- Discord OAuth (`identify` + `guilds`), session, the web shell.
- **`MANAGE_GUILD` verification** — the check that makes ownership _verifiable rather than
  claimed_.
- Install flow: add the bot → an `installations` row owned by the authenticated user.
- **Kills the invariant "the presence of a row IS the authorization,"** which the migration
  comments assert repeatedly and which holds only while exactly one person can insert rows. This
  is a security requirement, not a refactor: without it, anyone can add a row for anyone's guild
  and grant themselves a role in it.
- **The web surface is an adapter, not a new kingdom (§2.8).** It _invokes_ the same capabilities
  the bot does — "mint a face," "assign a role," "add a route" — never its own copies. This is the
  phase where that discipline is most at risk, because it is the biggest greenfield chunk and it
  feels like "the web app" rather than a third front door. If 009 reimplements a capability, the
  split is broken and every later phase inherits two of everything.

**Testable:** two real Discord accounts, two guilds; each sees and configures only their own;
tenant A is refused on tenant B's guild.

### Phase D — Faces

- Mint / list / adopt / delete webhooks via the Discord API. Adds `MANAGE_WEBHOOKS` to the invite.
- Per-message `username` / `avatarUrl`. **The plumbing already exists and has never been fed** —
  the fields are on `DiscordMessage` and are sent on every webhook delivery; no transform sets
  them.
- `DEMO_CHANNEL_WEBHOOK` **stops existing as a concept.** Not "moves somewhere better" — once the
  hub mints its own faces, no human ever knows a webhook URL, so there is nothing to paste.

**Testable:** create a face from the UI, post through it, rename it, delete it — never touching
Discord's channel settings. Adopt the existing hand-made face as the first proof.

### Phase E — Inbound per-tenant

- URL scheme: `/webhooks/:installId/:source`. Today's `POST /webhooks/clickup` is **globally
  addressed** and cannot say _whose_ ClickUp.
- Many webhooks per source, each with its own secret _(this is the old 013, which was marked
  "conditional — build only if the need arises." The need has arisen; it is now required)_.
- **Tenant selection precedes verification, and the selector is untrusted** — the path identifier
  picks a candidate secret and grants nothing; an unknown identifier fails exactly like a bad
  signature, with no response that distinguishes them.

**Testable:** two tenants, both ClickUp, different secrets, no PK collision, neither can trigger
the other's routes; an unknown install id is indistinguishable from a bad signature.

### Phase F — Runtime command registration

- Registration moves from a **deploy-time script you run from your laptop**
  (`npm run deploy:commands`) to a **service**, firing on install.
- Per-guild (`applicationGuildCommands`), not global. The code path already exists — it is
  currently the _dev_ branch.
- A rate-limited queue: N tenants × M guilds is N×M API calls, and the current fire-once
  `rest.put()` has no queue.
- **`DISCORD_DEV_GUILD_ID` dies.**

**Testable:** install → that guild's commands appear there and nowhere else; uninstall → they go.

### Phase G — The composer

The payoff, and the reason the constitution changed. Design rules are normative — see §4.

- **The effect vocabulary already exists — do NOT build a second one.** `bot/members/` and
  `bot/moderation/` export **19 typed, tested verbs with zero `discord.js` imports**. Those _are_
  the primitives. The composer is therefore **metadata over the existing capabilities** — a
  registry that tags a subset as composable — not a parallel `effects/` tree. A second vocabulary
  would drift from the first, and the capability/adapter split would quietly die.
- **The composable subset is smaller than the vocabulary** (§4): reversible + low blast radius in
  (post, toggle a whitelisted role, react); irreversible + high blast radius out (kick, ban,
  mass-delete). Those stay engineer-written commands a human invokes with judgment.
- **Command instances** in data, tenant-scoped: name, description, options, trigger, effects.
- **"Who sees this?"** as a first-class knob (§2.4) — it selects the mechanism, and the mechanism
  decides whether a face is even available. The UI must refuse impossible combinations rather than
  silently drop half.
- Builder-from-JSON: `SlashCommandBuilder` objects are constructed at module load today; building
  `.data` from a row is a layer that does not exist.
- **One rule language, not two.** `routes.config.excludeSubtypes` is already an
  operator-supplied predicate; the composer will want conditions. Decide the predicate language
  once, here, and retrofit routing to it — two dialects is the failure mode.

**Testable:** build `/spank` in the UI for one guild; it works there, does not exist in any other
guild, and no code was deployed.

### Deferred, unblocked by the above, ordered by appetite

Durable outbox; `bot_state`/kv + scheduled jobs; infractions (needs the kv store); ops/metrics/
retention/alerting; voice moderation; context-menu and modal interaction styles (§5).

### Phase H — Connection manager (trigger-gated)

**Trigger: ~2500 guilds (Discord _requires_ sharding), or sustained global rate-limit pressure.**
Not appetite — a hard external limit (§2.5).

The process stops holding exactly one `Client`. Multiple gateway connections, each owning a subset
of guilds, with per-connection reconnect, health, and cache lifecycle. Readiness stops being a
single boolean.

This is a **platform-shape change** — it touches `min-instances`, possibly the single-process
assumption, and the way Cloud Run (which autoscales on _requests_) hosts something whose unit of
load is a _connection_. Constitution "Technology & Platform Constraints" is fixed, so building this
requires an amendment. That gate is deliberate: it forces the deploy-shape decision to be made
once, explicitly, rather than discovered.

**Everything upstream is already written for it.** Every consumer resolves by application id from
Phase A, so `getClient(appId)` changes from a map lookup to a pool lookup and no call site moves.

**Testable:** guilds distribute across connections; one connection's reconnect does not disturb
another; readiness reflects per-connection state.

### Phase I — BYO-app (trigger-gated, needs H)

**Trigger: a tenant needs their own rate-limit bucket or their own application identity** — the
avatar on ephemeral replies, the command-picker label, a member-list entry, per-guild intents
(§2.6).

- `applications.tenant_id` set (the column already exists from Phase A).
- Onboarding: the tenant creates a Discord application, enables intents, and hands over the token —
  the one irreducibly manual step in the product, because **Discord exposes no API to create an
  application**.
- Their token resolves through the same `bot_token_ref` seam as the platform's.
- Command registration targets their app id; delivery resolves their REST.

**Testable:** two applications serve two tenants from one process; each has its own rate-limit
bucket; a revoked token on one does not disturb the other.

**Nothing depends on this**, which is why it is last — not because it is unlikely. It is
inevitable at scale (§2.6); it is simply the only phase whose absence blocks nothing.

---

## 4. The composer's design rules (normative)

Constitution Principle IV draws the line between **vocabulary** (code) and **sentence** (data).
These rules are how that line is held in practice. They were derived when the composer was still
exploratory; the analysis survives the decision unchanged, so it is recorded here as constraints
rather than as an open question.

**The separating test is _totality_**, not typed-vs-clicked (a drag-and-drop flow builder with
conditionals is still code, just with a graphical syntax). Ask: _can you answer "what can this bot
do?" by reading only the code, plus a bounded read of the rows?_ If yes it is configuration — a bad
row is a wrong _choice_, never unreviewed logic. If you must read the data to know what the bot is
_capable_ of, it is programming.

**Three INDEPENDENT ways to break out** — any one is sufficient; they are not all about effects:

1. **Portal effects.** Discord's API is genuinely finite (~60–100 primitives) and enumerable, so
   the effect menu itself is not the problem. The danger is escape hatches: **arbitrary HTTP** (the
   effect set becomes the whole internet — exfiltrate the token, probe internal services),
   **eval**, **file/env reads**. This is how no-code tools actually get breached.
2. **Composition.** Even with a finite, portal-free menu: sequencing turns N effects into Nᵏ
   chains; **loops turn one click into 5,000 bans** (the effect was on the menu, the _scale_ was
   not); conditions re-admit arbitrary logic through the condition language (an unbounded regex can
   hang the process).
3. **Triggers.** `/ban` invoked by a moderator is a human judgment call. "Ban anyone matching
   ⟨pattern⟩" is the _same finite effect_, automated, with no human in the loop. Different product.

**What keeps composition total** (design against accidental Turing-completeness — total DSLs are a
solved problem: CEL, JSONLogic):

- bounded iteration only (`for up to N matching`, never `while`) → blast radius statically knowable
- total conditions: a typed predicate DSL over known fields, not regex-with-backtracking, not eval
- no portals
- an **effect allowlist smaller than the API**: composable = reversible + low blast radius (post a
  message, toggle a whitelisted role, add a reaction). NOT composable = irreversible + high blast
  radius (kick/ban/mass-delete) — those stay engineer-written commands a human invokes with
  judgment. 006 is already this shape, which retroactively justifies it.
- a static per-invocation blast limit

**Multi-tenancy sharpens every one of these.** "One click, 5,000 bans" is no longer only your
problem — it is someone else's guild, and you are the one who shipped the button.

**The foundation already exists.** The hub does patterns-in-code/instances-in-data today for
interactions: an operator adds a `reaction_role_mappings` / `component_role_bindings` row and a new
member-facing interaction exists immediately. `routes.config.excludeSubtypes` is the closest thing
to a rule language already present (code evaluates an operator-supplied predicate) — still total,
since its only possible effect is suppressing a delivery. Every operator-configurable thing today
is **single-effect**; sequencing exists nowhere. Phase G generalizes the pattern to commands. No
existing work needs rework.

**006 needs no change.** Moderation commands are inherently single-instance (you never want five
`/ban`s), while the composer applies to an inherently multi-instance class ("post template T to
channel C"). They do not overlap.

### Why Tier 3 (author behavior in a UI) is still rejected — for a new reason

The prior analysis rejected Tier 3 as **redundant**: "for an owner with repo access, `git push`
_is_ Tier 3 — arbitrary logic, live, gated to one person, plus review, types, and tests. A
composer's value is proportional to the number of people who _cannot_ ship code. Skip it
permanently **unless the operator population changes**."

**That trigger has fired, and it invalidates the argument, not the conclusion.** Tenants cannot
`git push`, so Tier 3 is no longer redundant — it is simply a different product. Authoring
behavior imports sandboxing, per-tenant CPU/memory limits, infinite-loop containment, cross-tenant
exfiltration, and an arbitrary-code debugging surface you own but did not write. That is a hosting
platform, not a Discord hub.

The same trigger **promotes Tier 2.5 from exploratory to committed**: it is now the product, and
`/spank` — "reply with a random line from this list, mentioning the target" — is exactly it. It
invents no verb.

---

## 5. Remaining interaction styles

The capability/adapter split is proven across **four** styles over shared logic — slash commands,
reactions, message components, and text-prefix. The shared rule (Principle I): **a capability is
logic; an interaction style is an adapter onto that logic.** Adding a style = one registry + one
dispatch binding. Core never enumerates styles or capabilities in a switch statement.

Remaining:

- **context-menu commands** (user / message) → registered alongside slash commands
- **modals** → dispatched from `interactionCreate` by `customId`

**Text-prefix is permanently process-wide.** Message Content is a per-connection intent, so one
connection means one prefix for every tenant, forever. Per-guild prefixes are the one capability
the single-application decision genuinely forecloses (BYO-app would re-enable it). Slash commands
are the real surface; this is an accepted loss, not a deferral.

---

## 6. Open questions still live for future specs

(Resolved questions are recorded in their feature's `specs/NNN-*/`. Q2, Q4, Q5, and Q6 from the
prior revision are now **decided** — see §2, §3, and §4.)

1. **Durable outbox?** Whether to add a DB-backed outbox so Discord downtime / a crash between ack
   and delivery can't lose an event (currently acknowledge-then-deliver in-process). Affects
   `delivery_log` (a `pending`/retry-count column).
2. **Route lookup caching.** Per-event DB read (always fresh, "edit a row → instant") vs. a TTL
   cache (faster under load) — revisit if inbound volume grows. Multi-tenancy raises the stakes:
   the read is now per-tenant-per-event.
3. **Rate-limit fairness mechanism.** Principle III requires that one tenant's burst not starve
   another, and names the delivery service as the only place that can see the contention. _How_ —
   per-tenant token bucket, weighted queue, or simple per-tenant concurrency cap — is unspecified
   and should be decided against real traffic rather than guessed.
4. **Tenant lifecycle.** What happens on uninstall: are the tenant's rows, faces, and secrets
   purged, soft-deleted, or retained for reinstall? Faces are live Discord resources, so "retained"
   means the hub is holding credentials for a guild it was evicted from.

---

## ⚠️ TODO before this file is deleted — rotate all setup-exposed tokens

During the live setup/e2e session, several real credentials passed through the working
session (e.g. when saving `.env`). Rotate ALL of them, then update the running services via
`./scripts/set-secrets.sh prod` (and `staging`). Treat every secret touched during setup as
exposed:

- **Discord bot token** — Developer Portal → Bot → Reset Token (instantly invalidates the old
  one), then update `.env` + push to Cloud Run.
- **ClickUp API token** — the personal token used to create the webhook; revoke it in ClickUp
  (it was a one-time setup tool, not needed at runtime).
- **ClickUp webhook signing secret** — rotate if you want a clean baseline (recreate the
  webhook to get a fresh secret, then update `CLICKUP_WEBHOOK_SECRET`).
- **Discord channel webhook URL** (`DEMO_CHANNEL_WEBHOOK`) — regenerate the channel webhook if
  treating it as exposed. _(Phase D deletes this variable entirely; rotating is still correct
  until then.)_
- **Supabase** — rotate the database password (and any service key) if it was handled during
  setup; update `DATABASE_URL`.

Once rotated and re-pushed, confirm `/api/ready` is `ready: true` on each environment.
