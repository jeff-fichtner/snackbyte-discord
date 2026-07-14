# Quickstart — Bot-Depth Completion

Exercise the feature end to end. Assumes the 004/005 bot is deployed; a test role is whitelisted for
your test guild; and the bot's role is positioned above the roles/members it manages.

## 0. Prerequisites

- Bot online with the new build. For **member sanctions**, grant the bot the relevant permissions on
  its role (Moderate Members / Kick Members / Ban Members / Manage Messages / Manage Channels) — least
  privilege, via the dedicated bot role, not Administrator.
- Bot role above the members/roles it will manage.

## 1. Apply the migration & register commands

```bash
npm run migrate          # applies 0008_component_role_bindings.sql
npm run deploy:commands  # registers /timeout /kick /ban /unban /bans /purge /slowmode /lock /pin
```

No new gateway intent for sanctions or components. (Text-prefix is opt-in — see §5.)

## 2. Member sanctions (US1/US2)

As a moderator with the relevant permission:

```
/timeout member:@X duration:10m reason:spam     → @X timed out 10m, reason in audit log
/timeout member:@X duration:0                     → clears @X's timeout
/kick member:@X reason:rulebreak                  → @X removed (may rejoin)
/ban member:@X reason:raid delete_messages:1d     → @X removed + blocked, last day's msgs purged
```

Refusals to verify: a non-moderator is refused; a target above the bot or above **you** is a safe
refusal; timing out for >28 days is refused with the allowed range; self/bot target refused.

## 3. Ban-list management (US3)

```
/ban user_id:<id of someone NOT in the server> reason:preemptive   → pre-emptive ban (can't join)
/unban user_id:<id>                                                 → removed from ban list
/bans                                                               → lists current bans + reasons (ephemeral)
/ban user_ids:<id1,id2,id3> reason:raid                            → bulk; reports per-id outcome
```

Verify: re-banning an already-banned id and unbanning a not-banned id give clear "already/​not banned"
messages, not errors; one bad id in a bulk ban does not abort the rest.

## 4. Message & channel moderation (US4)

```
/purge count:50            → deletes up to 50 recent messages; reports how many (older-than-14d skipped)
/slowmode seconds:10       → 10s slowmode; /slowmode seconds:0 clears it
/lock                      → members can't send; /unlock restores
/pin message_id:<id>       → pins; /unpin unpins
```

Verify: purge across the 14-day boundary reports skipped (not error); slowmode/lock on an unsupported
channel type is refused cleanly; a non-moderator is refused.

## 5. Component role menu (US5)

1. Post a message with a button (or select menu) whose `customId` you know.
2. Bind it (runtime data, no redeploy) to a **whitelisted** role:

   ```sql
   INSERT INTO component_role_bindings (guild_id, component_key, component_kind, role_id)
   VALUES ('<guild_id>', '<button customId>', 'button', '<whitelisted role id>');
   ```
3. Click the button → the role toggles on (ephemeral confirm); click again → off.
4. A component bound to a **non-whitelisted** role does nothing (whitelist is the authorization).

## 6. Text-prefix style (US6) — opt-in, needs Message Content

Text-prefix is OFF by default (Message Content intent not even requested). To enable:

1. Set the text-prefix config (enablement + prefix) and, in the Developer Portal, turn ON the Message
   Content intent for the bot. Redeploy.
2. `!role Announcements`, `!roles`, `!nick NewName` → same outcomes as the slash equivalents, same
   authorization gate.
3. **Isolation check**: with the flag OFF, the bot boots, Message Content is not requested, and slash /
   reaction / component styles all still work — prefix commands do nothing.

## 7. Automated checks

```bash
npm run check:all         # format + lint + typecheck + unit tests (all green)
```

Unit coverage: sanction capabilities (timeout range/clear, kick/ban, ban-list add/remove/list/bulk,
hierarchy + native-permission refusals, self/bot-target); channel/message capabilities (purge
count/age-skip, slowmode range, lock/unlock, pin toggle); the extended standing gate; the component
resolver (binding+whitelist intersection); text-prefix parsing + disabled-no-op; and the intents
assertion (Message Content absent by default, present only when text-prefix enabled).

## 8. What stays unchanged (regression guard)

- Inbound webhook → routing → delivery: untouched (SC-008).
- 004/005 self-service + cross-member commands and reactions: identical behavior.
- Least privilege: no new intent for sanctions/components; Message Content only when text-prefix is
  explicitly enabled.
- No new durable bot record (SC-008, FR-021).
