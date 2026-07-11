# Contract — Reaction-Roles

The reaction interaction style over the existing role capability. Two gateway events adapt onto a
pure resolver + the shared authorization gate. No command, no channel reply.

## Gateway events

| Event | Direction | Handler action |
|-------|-----------|----------------|
| `messageReactionAdd` | member adds a reaction | resolve → **grant** the role if authorized |
| `messageReactionRemove` | member removes a reaction | resolve → **revoke** the role if it was granted by a mapping |

Both handlers are registered at `src/bot/events/index.ts` and dispatched by the generic
`bindHandlers` loop, which already contains a throwing handler (one failure never disconnects the
gateway or stops other handlers — FR-014).

## Intents & partials (client)

- **Add**: `GatewayIntentBits.GuildMessageReactions`, `Partials.Message`, `Partials.Reaction`.
- **Unchanged**: `Guilds`, `GuildMembers`.
- **Still OFF**: `MessageContent` (nothing here reads message text — FR-013, SC-006). The
  `bot-intents` test asserts reactions + partials present and Message Content absent.

Partials are required so a reaction on a message the bot did not cache this session still resolves
(FR-006): the event arrives partial, the handler reads `messageId` + `emoji` directly (no fetch of
message text needed).

## Pure resolver (`src/bot/reactions/resolve.ts`)

```
resolveReactionRole(input: {
  mappings: ReactionRoleMapping[];   // this guild's rows
  whitelistRoleIds: string[];        // this guild's self_assignable_roles
  messageId: string;
  emojiKey: string;                  // emoji.id ?? emoji.name
  reactorIsBot: boolean;
}): string | null                    // role id to act on, or null (ignore)
```

Returns a role id **only when** all hold:
1. `reactorIsBot` is false (bot's own reactions ignored — FR-007).
2. A mapping matches `(messageId, emojiKey)` (unmapped emoji/message ignored — FR-007).
3. That mapping's `roleId` is in `whitelistRoleIds` (mapping never bypasses the whitelist — FR-002).

Otherwise returns `null` (a silent no-op). The resolver is pure — no discord.js, no I/O — and is unit
tested with plain objects.

## Authorization gate (shared with `/role`)

When the resolver returns a role id, the handler calls the role capability's **directed** entry
point over the **same** gate as `/role`:

- `grantSelfRole(memberView, roleView, whitelistRoleIds)` on add
- `revokeSelfRole(memberView, roleView, whitelistRoleIds)` on remove

Both re-check: role whitelisted AND bot can manage (positioned above it AND holds Manage Roles).
Direction is authoritative (add-reaction always tries to add; remove always tries to remove) — not a
toggle, so a duplicate add event does not flip the role off. A role at/above the bot, a missing
permission, or a role deleted mid-op is a **safe, logged no-op** (FR-005), never a crash.

| Reaction | Resolver | Gate | Effect |
|----------|----------|------|--------|
| add mapped+whitelisted emoji, bot can manage | role id | pass | role **granted** |
| remove same | role id | pass | role **revoked** |
| add unmapped emoji | `null` | — | no-op |
| add mapped but role not whitelisted | `null` | — | no-op |
| add mapped+whitelisted, role above bot | role id | refuse `bot-cannot-manage` | logged no-op, no change |
| bot's own reaction | `null` | — | no-op |
| reaction on un-cached message | resolves via partial | as above | acts normally |

## Idempotency

React = has-role, un-react = has-not (source of truth). A rapid add/remove or a redelivered event
converges to a single consistent state — `grant` on a role the member already has, and `revoke` on
one they lack, are both harmless (discord.js no-ops the redundant write; a thrown "already has"/"not
found" is swallowed as a clean no-op). Removing a mapped reaction removes the role **unconditionally**
(Clarification Q1) — no provenance is consulted.

## Non-goals (this contract)

- No channel message on grant/revoke (silent — FR-012); failures are logged, not posted.
- No operator command to edit mappings (runtime-data editing only; a command is deferred).
- No reaction-driven *removal* of a role obtained by a non-mapping means being "protected" — removal
  is unconditional by design.
