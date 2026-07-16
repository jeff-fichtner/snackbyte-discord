# Roadmap — snackbyte-discord

The complete, **finite** plan for the hub. This is the index; each feature's detail lives in its
`specs/NNN-*/` directory. The project is "architecturally done" when the remaining specs below are
built and `ARCHITECTURE.md` (the shrinking design backlog) is empty and deleted.

Feature specs are numbered and dependency-ordered. Stubs (🌱) are outlines only — run
`/speckit-specify` on one to elaborate it into a full spec. Priority is relative among _remaining_
work, not a delivery commitment.

## Shipped

| #   | Feature                   | What                                                                                     |
| --- | ------------------------- | ---------------------------------------------------------------------------------------- |
| 001 | walking-skeleton          | Inbound webhook → routing → Discord delivery; the core patterns + always-on bot skeleton |
| 002 | github-source             | GitHub as a second inbound source; per-route formatting/filtering                        |
| 003 | bot-rest-delivery         | Deliver as the bot (REST) as an alternative to channel webhooks                          |
| 004 | bot-roles-nicknames       | Self-service roles + nicknames; the operator-editable whitelist safety model             |
| 005 | reaction-roles-moderation | Reaction-roles; cross-member `/nick` + `/role` moderation (native-permission-gated)      |

## In progress

| #   | Feature              | Status                                                                                                                                                                                                          |
| --- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 006 | bot-depth-completion | **Specced** — full stateless moderation (timeout/kick/ban+by-id/unban/bulk, purge/slowmode/lock/pin) + component & text-prefix styles. On branch `spec/006-bot-depth-completion` (v0.6). Next: `/speckit-plan`. |

## Remaining (stubs — the finite backlog)

| #   | Feature                                                                 | Priority    | Depends on | One-liner                                                                                           |
| --- | ----------------------------------------------------------------------- | ----------- | ---------- | --------------------------------------------------------------------------------------------------- |
| 007 | [stateful-infra](../specs/007-stateful-infra/spec.md)                   | P1          | —          | `bot_state`/kv store + scheduled jobs; the persistence primitive later features build on            |
| 008 | [infractions-system](../specs/008-infractions-system/spec.md)           | P2          | 007, 006   | Warnings/infraction history, modlog, auto-escalation, auto-expiring temp-bans (needs a store)       |
| 009 | [admin-diagnostics](../specs/009-admin-diagnostics/spec.md)             | P2          | —          | Inspect routes, replay `delivery_log`, in-Discord operator commands to curate runtime data          |
| 010 | [delivery-outbox](../specs/010-delivery-outbox/spec.md)                 | P2          | —          | Durable store-and-forward outbox; closes the acknowledge-then-deliver crash window                  |
| 011 | [ops-observability](../specs/011-ops-observability/spec.md)             | P3          | —          | Metrics endpoint, `delivery_log` retention/pruning, alerting on repeated failures, rotation runbook |
| 012 | [voice-moderation](../specs/012-voice-moderation/spec.md)               | P3          | 006        | Move / disconnect / server-mute-deafen in voice (a small stateless moderation extension)            |
| 013 | [multi-secret-per-source](../specs/013-multi-secret-per-source/spec.md) | conditional | —          | Many webhooks per source, each with its own secret. **Build only if the need arises.**              |

### Dependency graph & parallelism

```text
006 ─┬─▶ 007 ─▶ 008          ← the ONE hard chain (008 needs 007's store)
     └─▶ 012                  ← voice reuses 006's moderation gate

009    010    011    013      ← independent: depend on nothing new
```

**What can run in parallel.** The graph is mostly flat — only `006 → 007 → 008` is a true blocking
chain. Everything else (009 admin, 010 outbox, 011 ops, 013 multi-secret) depends on nothing new and
could be built alongside the main line. The real limit on parallelism is **not** dependencies but
**which files a spec touches** — two specs editing the same subsystem will conflict:

| Spec               | Primary subsystem it edits                           |
| ------------------ | ---------------------------------------------------- |
| 006, 007, 008, 012 | the bot layer (`src/bot/`) — serialize these         |
| 010                | delivery pipeline (`src/discord/`, `delivery_log`)   |
| 009                | admin/routes surface                                 |
| 011                | observability / ops (cross-cutting, mostly additive) |
| 013                | source verification (`src/sources/`)                 |

So the clean parallel tracks are ones touching **disjoint** subsystems — e.g. the bot line
(006→007→008) can run alongside **010 (delivery)** or **009 (admin)** without conflict. For a
solo-owner repo, sequential is usually simpler (clean reviews, no merge conflicts); the graph's value
is knowing you _can_ pull 009/010/011/013 forward anytime without waiting on the bot line.

### Suggested build order

`006 → 007 → 008` is the one hard chain (008 needs 007's store; 007 unblocks it). Everything else is
largely independent and can slot in by appetite:

1. **006** (in progress) — finish bot-interaction + stateless-moderation depth.
2. **007** — the storage primitive; unblocks 008 and future stateful work.
3. **008** — the stateful moderation layer (infractions), once 007 exists.
4. **009 / 010 / 011** — operator surface, delivery durability, and ops polish; order by need.
5. **012** — voice moderation whenever the small addition is wanted.
6. **013** — only if a real multi-webhook-per-source need appears.

## Decisions, not features (trigger-only — may never happen)

These live in `ARCHITECTURE.md §5` / Phase 5. They are **not** spec'd as features because they are
triggered by scale or a concrete need, not planned work. Revisit only when the trigger fires:

- **Route-lookup caching** — per-event DB read (fresh) vs. a TTL cache; revisit only if inbound
  volume grows enough to matter.
- **Separate Discord app per environment** — prod/staging share one bot app today; split only if the
  shared-app collision risk becomes real.
- **Service split (Phase 5)** — split router + bot into two Cloud Run services; only if
  volume/scaling demands it. The seam is pre-drawn (core depends on neither face), so it's two thin
  entrypoints, not a rewrite. Explicitly "known evolution, not committed."
- **The composer** (ARCHITECTURE §5 Q6) — whether operators compose command instances (and later,
  total rules) from a UI without a deploy. Not a feature yet, but it **shapes 007 and 009**: spec
  scheduled jobs as a trigger→effect primitive, and decide whether 009 is diagnostics-only or the
  composer surface. The existing capability/adapter split already supports it; nothing built needs
  rework. Tier 3 (arbitrary logic in a UI) is judged redundant — `git push` already is it.

## Standalone TODO (do independently, sooner)

- **Rotate setup-exposed tokens** — `ARCHITECTURE.md`'s deletion-TODO: several real credentials
  passed through setup sessions (bot token, ClickUp API token + webhook secret, channel webhook URL,
  Supabase password). Rotate them and re-push via `./scripts/set-secrets.sh`. Not a feature — a
  security hygiene task. (The _runbook_ for future rotations is part of 011; the _actual_ one-time
  rotation should happen before then.)
- **BED-BOT leaked token** — the collaborator's `Bjarkirzz/BED-BOT` repo has a committed live Discord
  token; confirm it was regenerated. External to this repo but on the shared radar.

---

**Is it finite?** Yes. **~7 remaining feature specs** (007–012, plus 013 only if needed), the one
hard chain being 006→007→008. When those are built, the roadmap is empty, `ARCHITECTURE.md` deletes
itself per its own rule, and the durable record is the constitution + `docs/` + the shipped
`specs/NNN-*/`. The three "decisions, not features" are trigger-only and may never fire.
