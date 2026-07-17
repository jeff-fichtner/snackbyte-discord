<!-- SPECKIT START -->

This project uses spec-driven development (GitHub Spec Kit). Principles live in
`.specify/memory/constitution.md`.

**The hub is multi-tenant**: ONE Discord application, installed per guild, serving independent
owners who configure it through a web surface and who **cannot ship code**. 001–006 were built
before that was conveyed, so the single-owner assumption is load-bearing in the shipped code —
tenant identity currently equals the operating-system process (one token, one env, one client, one
owner). Read `ARCHITECTURE.md §2` (the settled model) and §3 (the build plan) before designing
anything new.

Next up — 007 tenancy-foundation: `docs/ROADMAP.md`. Nothing is correct before it.

Shipped: bot-depth completion (full stateless moderation + component/text-prefix styles) —
`specs/006-bot-depth-completion/plan.md`; reaction-roles & cross-member moderation —
`specs/005-reaction-roles-moderation/plan.md`; self-service roles & nicknames —
`specs/004-bot-roles-nicknames/plan.md`; bot-REST delivery — `specs/003-bot-rest-delivery/plan.md`;
GitHub source + per-route formatting — `specs/002-github-source/plan.md`; walking skeleton —
`specs/001-walking-skeleton/plan.md`.

Remaining roadmap: `docs/ROADMAP.md`. **007 tenancy-foundation is the only true bottleneck** —
nothing is correct before it, and it must be built solo. After it the graph fans out: 008
secret-store ∥ 009 tenant-identity ∥ 012 runtime-commands, then 010 faces ∥ 011 inbound-per-tenant
∥ 013 composer (the payoff — `/spank`). Deferred backlog: 014 stateful-infra → 015 infractions;
plus 016 outbox, 017 ops, 018 voice. Scale-gated and sequenced last, but **expected, not
hypothetical**: 019 connection-manager (Discord requires sharding past ~2500 guilds) → 020 byo-app
(the global rate limit is ~50 req/s _per token_, shared by every tenant — past some N the only way
to get more buckets is more applications).

⚠️ **Bot verification is a lead-time gate**: `GuildMembers` is privileged and requested
unconditionally, and Discord requires app verification at **100 guilds** to keep it — review takes
weeks, and hitting 100 unverified cuts it off for every tenant at once. See ROADMAP → Standalone
TODO.

<!-- SPECKIT END -->
