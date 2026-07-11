# Quickstart — Reaction-Roles & Moderation

Exercise the feature end to end. Assumes the 004 bot is deployed and a role is already on the
`self_assignable_roles` whitelist for your test guild.

## 0. Prerequisites

- Bot online with the new build (reaction intent enabled — see step 1).
- Bot role positioned **above** the roles/members it will manage, holding **Manage Roles** +
  **Manage Nicknames** (via the dedicated "robot" role, not Administrator).
- A test role, e.g. `Announcements`, present in the guild **and** in `self_assignable_roles` for that
  guild.

## 1. Apply the migration & enable the reaction intent

```bash
npm run migrate          # applies 0007_reaction_role_mappings.sql
```

The new build requests `GuildMessageReactions` + Message/Reaction partials. In the Discord Developer
Portal the bot needs **no** privileged intent for this — Message Content stays OFF. (Server Members
Intent is already on from 004.) Redeploy the service with the new build.

## 2. Re-register the grown commands

```bash
npm run deploy:commands   # re-registers /nick and /role with the new optional `member` option
```

Guild-scoped in dev (instant); global in prod (propagates within the hour).

## 3. Reaction-roles (US1/US2)

1. Post a message in the test guild, e.g. "React 🔔 for Announcements." Note its **message id**
   (Developer Mode → Copy Message ID).
2. Insert a mapping row (table editor or SQL) — the operator step, runtime data, no deploy:

   ```sql
   INSERT INTO reaction_role_mappings (guild_id, message_id, emoji_key, emoji_kind, role_id)
   VALUES ('<guild_id>', '<message_id>', '🔔', 'unicode', '<announcements_role_id>');
   ```

   For a **custom** emoji use its numeric id as `emoji_key` and `'custom'` as `emoji_kind`.
3. **React** 🔔 on the message → you receive the **Announcements** role (silently — no bot reply).
4. **Remove** your 🔔 reaction → the role is removed.
5. React with a **different** emoji → nothing happens (unmapped).
6. Point a mapping at a role **not** on the whitelist, react → nothing happens (whitelist is the
   authorization). Remove that test row.
7. **Un-cached message check**: restart the bot, then react on the same (now un-cached) message →
   still works (partials, FR-006).

## 4. Moderate a nickname (US3)

As a member **with Manage Nicknames**:

```
/nick nickname:Chief member:@SomeMember     → sets @SomeMember's nickname to "Chief" (ephemeral confirm)
/nick member:@SomeMember                     → resets @SomeMember's nickname
```

As a member **without Manage Nicknames**:

```
/nick nickname:Whatever member:@SomeMember   → refused: "You can only change your own nickname." (no change)
/nick nickname:MyOwn                          → still works on yourself (004 path unchanged)
```

## 5. Moderate a role (US4)

As a member **with Manage Roles** (bot above the role, moderator above the role):

```
/role role:@SomeRole member:@SomeMember      → toggles @SomeRole on @SomeMember (not whitelist-bound)
```

Refusals to verify:
- Non-moderator with a `member` target → "You can only manage your own roles." (no change).
- A role **above the bot** → "I can't manage that…" (no change).
- A role **above the invoking moderator** → "You can't assign a role at or above your own highest
  role." (no change) — escalation guard.
- No `member` → 004 self-toggle, whitelist-gated, unchanged.

## 6. Automated checks

```bash
npm run check:all         # format + lint + typecheck + unit tests (all green)
```

Unit coverage: reaction resolution (mapping+whitelist intersection, emoji identity unicode/custom,
unmapped/self/bot ignore, stale-role no-op), directed grant/revoke over the shared gate, cross-member
nickname + role capability (standing gate, bot-position + invoker-position guards), and the
intents/partials assertion (reactions on, Message Content off).

## 7. What stays unchanged (regression guard)

- Inbound webhook → routing → delivery: untouched (SC-007).
- 004 self-service `/nick` (own), `/role` (own), `/roles` list: identical behavior when no `member`
  is supplied.
- Least privilege: no Message Content; only the added reactions intent.
