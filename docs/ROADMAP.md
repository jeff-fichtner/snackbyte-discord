# Roadmap — snackbyte-discord

The complete, **finite** plan for the hub. This is the index; each feature's detail lives in its
`specs/NNN-*/` directory. The project is "architecturally done" when the remaining specs below are
built and `ARCHITECTURE.md` (the shrinking design backlog) is empty and deleted.

Feature specs are numbered and dependency-ordered. Stubs (🌱) are outlines only — run
`/speckit-specify` on one to elaborate it into a full spec. Priority is relative among _remaining_
work, not a delivery commitment.

> **Re-cut at 006 → 007 for multi-tenancy.** The hub is a multi-tenant product: one Discord
> application, installed per guild, serving independent owners who configure it through a web
> surface and who cannot ship code. That was not conveyed when 001–006 were built, so the
> single-owner assumption is load-bearing in the shipped code. See `ARCHITECTURE.md §2` for the
> settled model and constitution **v2.0.0** for the governance change. The backlog below is
> re-ordered and roughly doubled as a result — see "Is it finite?".

## Shipped

| #   | Feature                   | What                                                                                                                                     |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 001 | walking-skeleton          | Inbound webhook → routing → Discord delivery; the core patterns + always-on bot skeleton                                                 |
| 002 | github-source             | GitHub as a second inbound source; per-route formatting/filtering                                                                        |
| 003 | bot-rest-delivery         | Deliver as the bot (REST) as an alternative to channel webhooks                                                                          |
| 004 | bot-roles-nicknames       | Self-service roles + nicknames; the operator-editable whitelist safety model                                                             |
| 005 | reaction-roles-moderation | Reaction-roles; cross-member `/nick` + `/role` moderation (native-permission-gated)                                                      |
| 006 | bot-depth-completion      | Full stateless moderation (timeout/kick/ban+by-id/unban/bulk, purge/slowmode/lock/pin) + component & text-prefix styles. Live as v0.6.2. |

## The multi-tenant line (007 → 013)

Ordered **most-reusable-first**. Each is a foundation the later ones stand on, sized to be
independently specifiable and independently testable. Detail: `ARCHITECTURE.md §3`.

The one fact this ordering serves:

> **Tenant identity currently equals the operating-system process.** One token, one env, one
> client, one intent set, one owner. Every spec below moves a piece of identity out of the process
> and into rows.

| #   | Feature            | Depends on | What                                                                                                                                                                      |
| --- | ------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 007 | tenancy-foundation | 006        | `tenants`/`installations`/`applications`; `tenant_id` everywhere; fix `sources.slug` global PK; scoped repository; kill the boot-time singletons (`getContext()` no-args) |
| 008 | secret-store       | 007        | `resolveSecret(tenantId, ref)` over a runtime-**writable** store. The seam is already right; the backend (`process.env`) is not                                           |
| 009 | tenant-identity    | **007**    | Discord OAuth + `MANAGE_GUILD` verification + the web shell + install flow. Kills "row presence IS authorization"                                                         |
| 010 | faces              | 008, 009   | Mint/list/adopt/delete webhooks via API; per-message persona. `DEMO_CHANNEL_WEBHOOK` stops existing                                                                       |
| 011 | inbound-per-tenant | 008        | `/webhooks/:installId/:source`; many webhooks per source, each with its own secret; untrusted tenant selection before verify                                              |
| 012 | runtime-commands   | 007        | Command registration moves from a deploy-time script to a service; per-guild, on install, rate-limited. `DISCORD_DEV_GUILD_ID` dies                                       |
| 013 | composer           | 012        | Effect primitives (code) + command instances (tenant data). **`/spank`.** Design rules are normative — `ARCHITECTURE.md §4`                                               |

**Two are promotions, not new work.** 009 was `admin-diagnostics` ("P2, inspect routes, replay
`delivery_log`") — it is now the tenant onboarding surface and is load-bearing, because without it
there is no tenant. 011 absorbs the old `multi-secret-per-source`, which was marked _"conditional —
build only if the need arises."_ The need has arisen; it is required.

**009 does not need 008.** Everything it requires — the OAuth client id/secret, the session key —
is _platform_ config, so env is legitimately correct for it. It needs only 007's `tenants` table.
That matters: 009 is the widest greenfield chunk and it can start the moment 007 lands, alongside 008.

## Scale-gated (trigger, not appetite)

These are **not** "maybes." Each is forced by a published Discord limit at a knowable size
(`ARCHITECTURE.md §2.5`). They are sequenced last because nothing depends on them — not because
they are unlikely.

| #   | Feature            | Trigger                                                                | What                                                                                                                                              |
| --- | ------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 019 | connection-manager | **~2500 guilds** (Discord _requires_ sharding), or rate-limit pressure | The process stops holding exactly one `Client`. Per-connection reconnect/health/cache. **Platform-shape change → needs a constitution amendment** |
| 020 | byo-app            | a tenant needs their **own rate-limit bucket** or own identity         | `applications.tenant_id` set (column exists from 007). Their token via the same `bot_token_ref` seam. **Needs 019**                               |

**Why these are inevitable rather than optional:** Discord's global rate limit is ~50 req/s **per
bot token**, shared by every tenant. Constitution III makes the delivery service arbitrate that
fairly — but fairness only divides a fixed pie; past some N the pie is the ceiling, and the only
way to get more buckets is more applications. And sharding forces 019 independently, which is the
expensive half of 020 — so once 019 exists, 020 is a column plus an onboarding flow.

An earlier revision priced 020 as "cosmetics vs. the connection manager, therefore probably never."
That was wrong: it charged 020 for a manager that sharding builds anyway.

## Remaining (stubs — unblocked by the line above, ordered by appetite)

| #   | Feature                                                       | Priority | Depends on | One-liner                                                                                           |
| --- | ------------------------------------------------------------- | -------- | ---------- | --------------------------------------------------------------------------------------------------- |
| 014 | [stateful-infra](../specs/014-stateful-infra/spec.md)         | P1       | 007        | `bot_state`/kv store + scheduled jobs; the persistence primitive later features build on            |
| 015 | [infractions-system](../specs/015-infractions-system/spec.md) | P2       | 014        | Warnings/infraction history, modlog, auto-escalation, auto-expiring temp-bans (needs a store)       |
| 016 | [delivery-outbox](../specs/016-delivery-outbox/spec.md)       | P2       | 007        | Durable store-and-forward outbox; closes the acknowledge-then-deliver crash window                  |
| 017 | [ops-observability](../specs/017-ops-observability/spec.md)   | P3       | 007        | Metrics endpoint, `delivery_log` retention/pruning, alerting on repeated failures, rotation runbook |
| 018 | [voice-moderation](../specs/018-voice-moderation/spec.md)     | P3       | 006        | Move / disconnect / server-mute-deafen in voice (a small stateless moderation extension)            |

Everything here now depends on **007** at minimum — new tables need `tenant_id`, and new
capabilities need a tenant to own them. Building any of them before 007 means building them
single-tenant and reworking them after.

### Dependency graph

```text
                  ┌─▶ 008 ─┬─▶ 010            ← faces      (needs 009 too)
                  │        └─▶ 011            ← inbound
006 ─▶ 007 ───────┼─▶ 009 ───▶ 010            ← identity   (does NOT need 008)
                  │
                  ├─▶ 012 ─▶ 013              ← /spank lands here
                  │
                  ├─▶ 014 ─▶ 015
                  ├─▶ 016
                  ├─▶ 017
                  └─▶ 018                     ← voice: 006's gate + 007's scoping

        ╌╌╌╌╌╌╌╌╌╌╌╌ scale gates ╌╌╌╌╌╌╌╌╌╌╌╌
        019 ─▶ 020                            ← trigger-fired, not appetite
```

**007 is the only bottleneck.** The prior roadmap's flat graph — "pull 009/010/011/013 forward
anytime" — is void: it was flat only because nothing was owned. Once every row has an owner, the
tenancy foundation gates everything. After it, the graph fans out wide again.

**Subsystems, for parallelism** (the real limit is which files a spec touches, not dependencies):

| Spec          | Primary subsystem                                            |
| ------------- | ------------------------------------------------------------ |
| 007           | **everything** — schema, repository, core wiring. Serialize  |
| 008           | `src/config.ts`, secret resolution, `scripts/set-secrets.sh` |
| 009           | `src/web/`, auth, routes surface (greenfield)                |
| 010           | `src/discord/` (delivery, faces)                             |
| 011           | `src/sources/`, `src/routes/webhooks.ts`                     |
| 012, 013      | the bot layer (`src/bot/`) — serialize these                 |
| 014, 015, 018 | the bot layer — serialize with 012/013                       |
| 016           | delivery pipeline (`src/discord/`, `delivery_log`)           |
| 017           | observability / ops (cross-cutting, mostly additive)         |
| 019, 020      | core wiring + deploy shape — serialize with everything       |

**After 007, three disjoint tracks run together: 008 (config/secrets) ∥ 009 (web/auth, greenfield)
∥ 012 (bot).** Then **010 (discord) ∥ 011 (sources) ∥ 013 (bot)**. For a solo-owner repo,
sequential is usually simpler — the graph's value is knowing you _can_ fan out.

### Suggested build order

**007 is the only true bottleneck.** Then:

1. **007** — tenancy foundation. Nothing is correct before this. Solo — it touches everything.
2. **008 ∥ 009 ∥ 012** — secret store, identity, runtime command registration. Disjoint subsystems.
   - **008** is urgent, not tidy: env vars are set by a deploy, and a deploy restarts the service
     and **drops every tenant's gateway connection**. "A tenant adds a server" and "everyone goes
     offline" must not be the same event.
   - **009** closes the authorization hole (anyone can currently configure anyone's guild) and is
     the widest greenfield chunk. Start it early.
3. **010 ∥ 011 ∥ 013** — faces, inbound, the composer. **013 is the payoff — `/spank`.**
4. **014–018** — the deferred backlog, once the foundation exists.
5. **019 → 020** — when a scale gate fires, not before.

**Start the bot-verification review well before any of this ships to 100 guilds** — see Standalone
TODO. It has weeks of lead time and no code.

## Decisions, not features (trigger-only — may never happen)

These are triggered by a concrete need, not planned work. Revisit only when the trigger fires.
(**BYO-app used to live here and does not any more** — it is scale-forced, so it is planned work:
019 → 020 above.)

- **Route-lookup caching** — per-event DB read (fresh) vs. a TTL cache; revisit only if inbound
  volume grows. Multi-tenancy raises the stakes: the read is now per-tenant-per-event.
- **Rate-limit fairness mechanism** — constitution III requires that one tenant's burst not starve
  another and names the delivery service as the arbiter. _How_ (token bucket / weighted queue /
  per-tenant concurrency cap) should be decided against real traffic, not guessed.
- **Tenant lifecycle on uninstall** — purge, soft-delete, or retain for reinstall? Faces are live
  Discord resources, so "retain" means holding credentials for a guild that evicted you.
- **Service split** — split router + bot into two Cloud Run services; only if volume/scaling
  demands it. The seam is pre-drawn (core depends on neither face), so it's two thin entrypoints,
  not a rewrite.

## Standalone TODO (do independently, sooner)

- **⚠️ Discord bot verification — start early, it has weeks of lead time.** The bot requests
  `GuildMembers` **unconditionally** (`src/bot/client.ts`) — the entire roles/moderation surface
  runs on it — and `GuildMembers` is a **privileged intent**. **Discord requires verification at
  100 guilds** to keep privileged intents: an application review, a **privacy policy**, **terms of
  service**, and a written justification per intent. Review takes weeks; **hitting 100 unverified
  cuts `GuildMembers` off for every tenant at once.** `MessageContent` (behind `TEXT_PREFIX`) is
  also privileged and is the harder one to justify in review — consider whether text-prefix is
  worth carrying through verification at all. Not a spec, no code — a lead-time item that gates
  the whole multi-tenant plan. See `ARCHITECTURE.md §2.5`.
- **Rotate setup-exposed tokens** — `ARCHITECTURE.md`'s deletion-TODO: several real credentials
  passed through setup sessions (bot token, ClickUp API token + webhook secret, channel webhook URL,
  Supabase password). Rotate them and re-push via `./scripts/set-secrets.sh`. Not a feature — a
  security hygiene task. (The _runbook_ for future rotations is part of 017; the _actual_ one-time
  rotation should happen before then.)
- **BED-BOT leaked token** — the collaborator's `Bjarkirzz/BED-BOT` repo has a committed live Discord
  token; confirm it was regenerated. External to this repo but on the shared radar.
- **Finish the prod/staging split** — `snackbyte-dev` app exists; staging still needs its own bot
  token, app id, and a dedicated dev guild. Independent of the line above.

---

**Is it finite?** Yes — and it roughly doubled. **~14 feature specs**: 007–013 (the multi-tenant
line), 014–018 (the deferred backlog), 019–020 (scale-gated). `007` is the only true bottleneck.
That is the honest cost of the pivot: **multi-tenancy is not a column, it is a layer**, and the
prior estimate of ~7 was priced for a single owner.

The arc is now complete end to end — there is no "and then someday, somehow" left in it. 019 and
020 are the only ones without a date, and even they have **triggers rather than hopes**: 2500
guilds, and a saturated rate-limit bucket. If the product works, they fire. If it doesn't, they
don't, and the seam that keeps them cheap was built in 007 for reasons that had nothing to do with
them.

When these are built, the roadmap is empty, `ARCHITECTURE.md` deletes itself per its own rule, and
the durable record is the constitution + `docs/` + the shipped `specs/NNN-*/`.
