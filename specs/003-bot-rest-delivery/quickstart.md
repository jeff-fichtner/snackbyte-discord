# Quickstart: Bot-REST Delivery Path

Validates that a route can post into a Discord channel **as the bot**, alongside the existing
webhook path, with routing/idempotency/outcomes unchanged. References the
[delivery-service contract](./contracts/delivery-service.md) and [data-model](./data-model.md)
rather than repeating them.

## Prerequisites

- The hub running (local `npm run dev`, or a deployed environment) with `DATABASE_URL` and
  `DISCORD_BOT_TOKEN` set — the bot must be **logged in** and a **member of the target guild** with
  **permission to post** in the target channel (the operational precondition; see spec Assumptions).
- Access to the routing store's table editor (Supabase) to add a `discord_targets` row and a
  `routes` row.
- A way to send a signed inbound event the hub already routes (e.g. the ClickUp or GitHub webhook
  flow validated in 001/002), so this guide tests *delivery mode* without re-testing inbound verify.

## Automated checks (run first)

```bash
npm run check:all        # format + lint + typecheck + test — must be green
npm test -- bot-delivery # the feature's unit + engine integration tests
```

Expected: the bot-delivery unit tests prove mode dispatch (webhook target → webhook path; bot
target → bot-REST send), permanent-immediate vs. transient-retry classification, and a
misconfigured target failing permanently; the engine integration test proves dual-mode fan-out,
idempotency on a bot route, and an isolated bot failure that still acks the inbound.

## Manual end-to-end validation

### 1. Configure a bot-mode target (US1)

In the table editor, add a `discord_targets` row:
- `mode = 'bot'`, `channel_id = <a channel id the bot can post in>`, `name = 'Bot demo'`
- (optionally) `guild_id = <its guild>`; leave `webhook_url_ref` null.

Point a route at it: add (or repoint) a `routes` row so a known `(source, event_type)` you can
trigger has `target_id = <the bot target's id>`.

### 2. Trigger a matching event → posted as the bot

Send the signed inbound event for that `(source, event_type)`.

**Expected**: the message appears in the channel **authored by the bot** (bot name/avatar, not a
webhook identity); `delivery_log` has one `ok` row for that route; the message content/embeds match
what the route's transform renders for a webhook target (FR-005, SC-001).

### 3. Dual-mode fan-out (US1 / SC-002)

Add a *second* enabled route for the **same** `(source, event_type)` pointing at an existing
webhook-mode target. Trigger the event once.

**Expected**: two messages — one posted as the bot, one via the channel webhook — and two
independent `delivery_log` rows, each `ok`. Confirms delivery mode does not change routing or
fan-out.

### 4. Idempotency on the bot route (SC-003)

Re-send the identical event (same dedupe identity) to the bot route.

**Expected**: no second bot message; the duplicate is recorded `skipped`. Identical to the webhook
path.

### 5. Operator-safe failure (US2 / SC-004)

Point a bot-mode target at a channel the bot **cannot** post in (or remove the bot's permission),
then trigger the event.

**Expected**: `delivery_log` records `failed` **immediately** (no retry — a permanent permission
error) with an operator-actionable reason; the inbound request still returns its normal
acknowledgement; any other route for the same event is unaffected (SC-004, FR-010).

### 6. Repoint with no redeploy (SC-005)

Edit the route from step 2 to point back at a webhook target (or vice versa). Trigger again.

**Expected**: the next event delivers via the newly selected mechanism with **zero redeploy / zero
code change** (FR-011, SC-005).

## Success signals (map to spec Success Criteria)

- **SC-001/SC-005**: a bot post is achieved and the delivery path switched by editing rows only.
- **SC-002**: one event → exactly one message per route across both modes, independent outcomes.
- **SC-003**: duplicate → zero extra messages, recorded `skipped`.
- **SC-004**: unpostable channel → recorded `failed` immediately, inbound still acked, others
  unaffected.
- **SC-006**: existing webhook-mode routes behave exactly as before (regression check in step 3's
  webhook leg + the unchanged 001/002 tests staying green).
