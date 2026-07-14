# Contract — Moderation (Sanctions, Ban-List, Message/Channel)

New slash commands over new capability functions in `src/bot/moderation/`. Every command is a thin
adapter: native-permission gate (via the extended `isModerator`) → hierarchy guards (member sanctions)
→ capability call → ephemeral reply. All reasons flow to the platform audit log. No durable bot record.

## Member sanctions

| Command | Options | Native permission | Effect |
|---------|---------|-------------------|--------|
| `/timeout` | `member`, `duration`, `reason?` | Moderate Members | Times the member out for `duration` (self-expires) |
| `/timeout` (clear) | `member`, `duration:0` (or a clear flag) | Moderate Members | Lifts an active timeout |
| `/kick` | `member`, `reason?` | Kick Members | Removes the member (may rejoin) |
| `/ban` | `member` OR `user_id`, `reason?`, `delete_messages?` | Ban Members | Removes + blocks rejoin; optional recent-message purge |

**Gates (in order, before any action):**
1. **Native permission** — invoker holds the mapped permission (`isModerator(invoker, capability)`),
   else refuse "you lack permission." (FR-007)
2. **Bot-position** — bot outranks the target and holds the permission, else safe refusal. (FR-005)
3. **Invoker-position** — target below the invoking moderator's highest role, else refuse
   "can't sanction someone at/above your own highest role." (FR-005)
4. **Self / bot target** — refused before any action. (FR-007)
5. **Timeout duration** — in `(0, 28 days]`, else refuse with the allowed range. (FR-006)

## Ban-list management

| Command | Options | Native permission | Effect |
|---------|---------|-------------------|--------|
| `/ban` (by id) | `user_id`, `reason?`, `delete_messages?` | Ban Members | Pre-emptively bans a user not in the server |
| `/unban` | `user_id`, `reason?` | Ban Members | Removes a user from the ban list |
| `/bans` (list) | — | Ban Members | Lists current bans + reasons (ephemeral) |
| `/ban` (bulk) | `user_ids` (multiple), `reason?` | Ban Members | Bans many ids; reports per-id outcome |

- Ban-by-id / unban act on the platform ban list directly; no member-hierarchy check for an absent
  user (no role position to compare), but the bot-position guard applies when a present member is
  targeted. (research §3)
- **Bulk ban never aborts on one bad id** — each id gets an outcome (banned / already-banned /
  invalid), reported together. (FR-003)
- Re-banning an already-banned id and unbanning a not-banned id are idempotent, clear messages, not
  errors. (Edge cases)

## Message & channel moderation

| Command | Options | Native permission | Effect |
|---------|---------|-------------------|--------|
| `/purge` | `count`, `reason?` | Manage Messages | Bulk-deletes `count` recent messages in the channel |
| `/slowmode` | `seconds` | Manage Channels | Sets/clears the channel's slowmode (0 = off) |
| `/lock` / `/unlock` | (`reason?`) | Manage Channels | Deny / allow member sends in the channel |
| `/pin` / `/unpin` | `message_id` | Manage Messages | Toggles a message's pinned state |

- **Purge** respects the platform's 14-day bulk-delete limit: older messages are **reported as
  skipped**, not errored; the reply states how many were deleted. (FR-008)
- **Slowmode / lock** on an unsupported channel type → clear refusal, no partial state. (FR-009)
- Purge/lock/slowmode necessarily change shared channel state; the **confirmation to the invoker is
  still ephemeral** (FR-016).

## Outcomes & replies (ephemeral — FR-016)

Each capability returns a structured outcome (`{outcome: 'done', detail} | {outcome: 'refused',
reason} | {outcome: 'partial', report}`), rendered to an ephemeral reply naming the target/result:
e.g. `Timed out **@member** for 10m.` · `Banned **@member**.` · `Unbanned <id>.` · `Purged 42
messages (3 too old to bulk-delete, skipped).` · `You can't sanction **@member** — they're at or above
your own highest role.`

## Invariants

- **Every mutation is gated before it happens** (native permission → bot-position → invoker-position →
  parameter validation); a failure at any gate is a safe, ephemeral refusal with no partial change
  (FR-005, SC-002).
- **No new intent** — sanctions read target/reason/duration from command options, not message text; the
  bot needs the *permission* granted on its role (operator act), not a gateway intent. (FR-017)
- **No durable bot record** — reasons go to the platform audit log; bans live on the platform ban list;
  nothing is written to a bot table. (FR-021)
- **Containment** — a throwing command is caught by the existing `interactionCreate` try/catch →
  ephemeral error; the bot and other commands are unaffected. (FR-018)
