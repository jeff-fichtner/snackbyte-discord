# Feature Specification: Bot-REST Delivery Path

**Feature Branch**: `003-bot-rest-delivery`

**Created**: 2026-06-29

**Status**: Draft

**Input**: User description: "The bot-REST delivery path: a second outbound delivery mechanism so routes can post into Discord through the gateway bot's authenticated REST client, alongside the existing webhook-URL path."

## Clarifications

### Session 2026-06-29

- Q: When a bot-mode delivery fails, how should the system decide whether to retry? → A:
  Distinguish failure classes — retry only transient errors (rate-limit / temporary server
  errors), honoring server-provided retry timing; record permanent errors (missing permission,
  unknown/invalid channel, bot not in guild, target misconfiguration) as a failure immediately
  without retrying. This matches the existing webhook path and Principle VI degradation.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Route a notification to post as the bot into a channel (Priority: P1)

An operator wants a routed notification to appear in a Discord channel posted **as the
server's bot** — carrying the bot's name and avatar — rather than as an arbitrary channel
webhook identity. They register a delivery target that names the channel (a "bot" target),
point a route at it by editing a row, and the next matching inbound event
is posted into that channel by the bot. No code change and no redeploy are required to switch a
route between a webhook-identity target and a bot-identity target.

**Why this priority**: This is the entire feature — a second way for an already-routed event to
reach Discord. Without it, every message must be posted through a channel webhook URL, which
cannot post under the bot's identity and cannot reach channels that have no webhook. It is also
the prerequisite that unblocks later bot-only message capabilities (interactive components,
threads, reactions), none of which can be built until messages can be sent through the bot.

**Independent Test**: Configure one bot-mode target for a real channel the bot can post
in, point a route at it, send a matching signed inbound event, and confirm the message appears
in that channel attributed to the bot and that the delivery is recorded as a success — with the
routing and transform behavior identical to a webhook-mode target.

**Acceptance Scenarios**:

1. **Given** a bot-mode target naming a channel the bot can post in, and an enabled
   route pointing at it, **When** a matching inbound event is received and verified, **Then** the
   rendered message is posted into that channel as the bot and the delivery is recorded as a
   success.
2. **Given** the same inbound event also matches a second enabled route pointing at a
   webhook-mode target, **When** the event is processed, **Then** both targets receive the
   message (one as the bot, one via the channel webhook) and each delivery is recorded
   independently — confirming delivery mode does not change routing or fan-out.
3. **Given** an operator edits a route in the routing table to repoint it from a webhook-mode
   target to a bot-mode target, **When** the next matching event arrives, **Then** it is
   delivered through the bot path with no redeploy.
4. **Given** the same route and the same inbound event delivered twice (same dedupe identity),
   **When** the duplicate is processed, **Then** the bot posts the message only once and the
   duplicate is recorded as skipped — idempotency behaves identically to the webhook path.

---

### User Story 2 - Operator-safe configuration of a bot target (Priority: P2)

An operator setting up a bot-mode target needs the system to tell them clearly when the target
is misconfigured or the bot lacks access, instead of silently failing or posting nowhere. A bot
target that names a channel the bot cannot see or post in, or omits required addressing, must
surface as a recorded, diagnosable delivery failure — not a lost message and not a crash.

**Why this priority**: The webhook path fails visibly (a bad URL returns an error); the bot path
adds new failure modes (bot not in the guild, missing channel permission, wrong channel id) that
an operator editing a row needs to be able to diagnose from the delivery record. This makes the
new mechanism operable, but the core value (US1) is deliverable without it.

**Independent Test**: Configure a bot-mode target pointing at a channel the bot cannot post in,
send a matching event, and confirm the delivery is recorded as a failure with a diagnosable
reason, the inbound request is still acknowledged, and no other route's delivery is affected.

**Acceptance Scenarios**:

1. **Given** a bot-mode target naming a channel the bot is not permitted to post in, **When** a
   matching event is delivered, **Then** the delivery is recorded as a failure immediately (no
   retries, since the condition is permanent) with a reason an operator can act on, and the
   inbound provider still receives acknowledgement.
2. **Given** a bot-mode target missing required addressing (no channel identifier), **When** a
   matching event is delivered, **Then** that delivery is recorded as a failure immediately (a
   permanent misconfiguration, not retried) and does not prevent other routes for the same event
   from delivering.
3. **Given** a bot-mode target's delivery fails transiently (Discord temporarily unavailable or
   rate-limited), **When** delivery is attempted, **Then** the system retries with backoff and,
   only if still failing, records the failure — matching the webhook path's degradation
   behavior.

---

### Edge Cases

- **Bot offline / gateway disconnected at delivery time**: the bot's authenticated posting
  capability depends on the always-on service being up; if the bot cannot currently reach
  Discord, a bot-mode delivery degrades the same way a webhook-mode delivery does (retry with
  backoff, then record failure while still acknowledging the inbound provider). Liveness is not
  affected.
- **Channel deleted or bot removed from guild between configuration and delivery**: surfaces as a
  recorded delivery failure with a diagnosable reason, not a crash.
- **A target row that is neither a valid webhook target nor a valid bot target** (e.g. mode set
  to bot but no channel, or an unrecognized mode): rejected as a delivery failure for that route
  only; other routes for the same event are unaffected.
- **High fan-out to the same channel via the bot**: must respect Discord's per-channel and global
  rate limits through the same single delivery chokepoint, so a burst does not trigger
  rate-limit bans.
- **The same logical message routed once via webhook and once via bot**: each is an independent
  delivery with its own outcome record; one failing does not fail the other.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST support a delivery target that posts into a specified Discord channel
  as the server's bot, in addition to the existing target type that posts to a channel webhook
  URL.
- **FR-002**: A bot-mode target MUST identify the channel it posts into by a stable channel
  identifier, which is the addressing required to send. It MAY also record the guild it belongs to
  for operator readability and precondition checks. It MUST NOT require a channel webhook URL. A
  webhook-mode target MUST continue to be described by its channel webhook reference as before.
- **FR-003**: The delivery mechanism for a route MUST be determined entirely by the target's
  recorded configuration (its mode), selectable by an operator editing routing data — never by
  any property of the event, its source, or its content.
- **FR-004**: Routing behavior — which routes match an event, fan-out to all matching routes, and
  per-route message rendering — MUST be unchanged by the introduction of bot-mode delivery. The
  same event MUST be routable to webhook-mode and bot-mode targets simultaneously, each delivered
  independently.
- **FR-005**: Message rendering (the transform a route selects and its per-route configuration)
  MUST produce the same message regardless of whether it is delivered via the webhook path or the
  bot path. Choosing a delivery mode MUST NOT require a different or new transform.
- **FR-006**: Every bot-mode delivery MUST flow through the single shared delivery service /
  shared Discord client, the same chokepoint all Discord writes use. No bot-mode delivery may
  bypass it.
- **FR-007**: Bot-mode delivery MUST be idempotent on the same basis as webhook-mode delivery: a
  repeat of an already-delivered (route, dedupe identity) MUST NOT post a second message and MUST
  be recorded as skipped.
- **FR-008**: Bot-mode delivery MUST respect Discord's per-bucket and global rate limits and
  honor server-provided retry timing. It MUST retry only **transient** failures (rate-limit
  responses and temporary server errors) with backoff, consistent with the webhook path, and MUST
  NOT retry **permanent** failures (see FR-010).
- **FR-009**: Every bot-mode delivery MUST record a terminal outcome (success, failure, skipped,
  or filtered) in the same delivery audit record used by webhook-mode delivery, with the same set
  of possible outcomes.
- **FR-010**: A bot-mode delivery that fails MUST be recorded as a failure with a diagnosable,
  operator-actionable reason, MUST NOT crash the service, and MUST NOT prevent other routes for
  the same event from delivering; the inbound provider MUST still receive acknowledgement. A
  **permanent** failure — missing channel permission, unknown or invalid channel, the bot not
  being a member of the guild, or target misconfiguration — MUST be recorded immediately without
  retrying. A **transient** failure MUST be recorded only after the retry policy in FR-008 is
  exhausted.
- **FR-011**: Switching a route between a webhook-mode target and a bot-mode target MUST take
  effect by editing routing data only, with no code change and no redeploy.
- **FR-012**: No secret value (bot credential or otherwise) introduced or used by bot-mode
  delivery may be stored in routing or target data rows or logged at normal log levels; any secret
  a row needs MUST be held by reference and resolved at runtime.
- **FR-013**: The scope of bot-mode delivery in this feature is posting a rendered message (text
  and embeds) into a channel as the bot. Interactive components, threads, reactions, and any
  interaction handling are explicitly out of scope and MUST NOT be required to ship this feature.

### Key Entities *(include if feature involves data)*

- **Delivery target**: a configured destination for routed messages. Gains a second variety: a
  **bot-mode** target, addressed by a channel identifier (optionally recording its guild) and
  posting as the bot, alongside the existing **webhook-mode** target addressed by a channel
  webhook reference. A route points at exactly one target; the target's mode determines how the
  message is sent.
- **Route**: unchanged. Continues to associate a source/event with a target, a transform, and
  per-route configuration. The only operator-visible change is that the target it points at may
  now be a bot-mode target.
- **Delivery record**: unchanged in shape. Continues to record the terminal outcome (success,
  failure, skipped, filtered) and a diagnosable reason for each attempted delivery, now including
  bot-mode deliveries.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can make an inbound event post into a Discord channel as the bot by
  configuring a target and pointing a route at it through routing data alone — no code change and
  no redeploy.
- **SC-002**: For an event matching one webhook-mode route and one bot-mode route, 100% of
  processed events result in exactly one message per route (two messages total), each with its own
  recorded outcome.
- **SC-003**: A duplicate delivery of an already-delivered event to a bot-mode route results in
  exactly zero additional messages posted and the duplicate recorded as skipped, matching the
  webhook path.
- **SC-004**: A bot-mode delivery to a channel the bot cannot post in is recorded as a failure
  with an operator-actionable reason in 100% of such cases, with the inbound request still
  acknowledged and other routes unaffected.
- **SC-005**: Repointing an existing route from a webhook-mode target to a bot-mode target changes
  the delivery path for subsequent matching events with zero redeploys and zero code changes.
- **SC-006**: Introducing bot-mode delivery causes no change to which routes match an event or how
  messages are rendered: existing webhook-mode routes behave identically to before this feature.

## Assumptions

- The always-on gateway bot and its authenticated Discord client already exist (used today for
  command registration); bot-mode delivery reuses that client rather than introducing a new
  connection or credential.
- The bot must be a member of the target guild and hold permission to post in the target channel.
  This is an operational precondition the operator arranges in Discord; the feature documents it
  and surfaces violations as recorded delivery failures rather than guaranteeing access itself.
- Per-route message rendering as built today (a default transform plus named transforms selectable
  per route, driven by per-route configuration) is sufficient for bot-mode messages in this
  feature; no new rendering capability is required to post text-and-embed messages as the bot.
- The existing routing engine, transform registry, canonical event contract, delivery audit /
  idempotency model, secrets-by-reference mechanism, and runtime-mutable routing table are reused
  unchanged in contract; this feature adds a delivery mechanism behind the existing delivery
  abstraction, not a new routing or rendering path.
- "Posting as the bot" in this feature means a normal channel message (text and embeds) authored
  by the bot. Bot-only message features that build on this (interactive components, threads,
  reactions) are deferred to later phases and are out of scope here.
- A bot-mode target identifies its channel by a stable channel identifier; addressing a channel by
  human-readable name is not assumed.
