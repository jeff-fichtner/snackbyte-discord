# Feature Specification: Walking Skeleton — first end-to-end slice of the Discord hub

**Feature Branch**: `001-walking-skeleton`

**Created**: 2026-06-22

**Status**: Draft

**Input**: User description: "Phase 1 walking skeleton for the snackbyte-discord integration hub: exercise every architectural seam once, thinly — receive a verified webhook from one external source (ClickUp), route it through database-driven configuration to a Discord channel, post a formatted message, and record the outcome; plus a minimal always-on bot that responds to a slash command. Outcome: a real external event reaches a Discord channel via an operator-editable route, and a slash command responds."

## Clarifications

### Session 2026-06-22

- Q: When an event matches more than one enabled route, what happens? → A: Fan out to all matching enabled routes; each delivers independently and is de-duplicated per route.
- Q: When does the hub acknowledge the sender relative to delivering to Discord? → A: Acknowledge immediately on successful verification (return success before delivery); deliver to Discord asynchronously afterward.
- Q: How does a route match an event's type — exact or wildcard? → A: Exact event-type match for this slice; a catch-all/wildcard match is a later-phase capability and the model must not preclude it.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - An external event reaches the right Discord channel (Priority: P1)

A team uses an external tool (ClickUp) and wants activity from it to show up in a specific
Discord channel. When something happens in the external tool (e.g. a task changes status),
a notification appears in the chosen Discord channel, formatted clearly enough to be useful
at a glance, with a link back to the source.

**Why this priority**: This is the core reason the hub exists — turning external activity
into Discord notifications. It is the thinnest slice that delivers real value on its own and
proves the entire inbound path (receive → authenticate → route → format → deliver → record).

**Independent Test**: Configure one route (this external event type → this Discord channel),
trigger or simulate the external event, and confirm a correctly formatted message appears in
that channel and the delivery is recorded as successful.

**Acceptance Scenarios**:

1. **Given** a route exists linking a ClickUp event type to a Discord channel and the route
   is enabled, **When** a genuine, authenticated ClickUp event of that type arrives, **Then**
   a formatted message (summary text plus a link back to the source item) appears in that
   Discord channel and the delivery is recorded as successful.
2. **Given** the same configuration, **When** the same event is delivered more than once (the
   external tool retries), **Then** only one message appears in Discord and the duplicate is
   recorded as skipped rather than re-posted.
3. **Given** an incoming request that does not carry valid proof it came from the configured
   source, **When** it is received, **Then** it is rejected as unauthorized, no message is
   posted, and nothing is routed.
4. **Given** an authenticated event for which no enabled route exists, **When** it is
   received, **Then** the request is accepted (the sender is not told to retry) and no
   message is posted.
5. **Given** two enabled routes match the same event (e.g. the same event type pointing at
   two different channels), **When** the event arrives, **Then** a message is delivered to
   each route's channel, each delivery is recorded independently, and a failure on one does
   not prevent the other.

---

### User Story 2 - An operator manages routing without a redeploy (Priority: P2)

An operator decides where external events go. They can register a new route (this source +
event type → this Discord channel) and strike an existing route (turn it off), and the
change takes effect on the next event — without anyone redeploying or restarting the service.

**Why this priority**: The hub's promise is cheap, no-deploy operation. Without runtime-
editable routing, every change is an engineering task. This makes Story 1 operable by a
non-engineer and is what turns a single hard-coded integration into a managed hub.

**Independent Test**: With the service running, add a route through the routing
configuration, send a matching event, and confirm it is delivered; then disable that route,
send the same event again, and confirm nothing is delivered — all without restarting.

**Acceptance Scenarios**:

1. **Given** the service is running with no route for a given event type, **When** an
   operator adds an enabled route for it and a matching event then arrives, **Then** the
   event is delivered to the configured channel with no restart or redeploy.
2. **Given** an enabled route, **When** an operator disables (strikes) it and a matching
   event then arrives, **Then** nothing is delivered for that route.
3. **Given** a route pointing at a Discord target, **When** the operator changes which
   channel the target represents, **Then** subsequent matching events go to the new channel.

---

### User Story 3 - The bot is present and responsive in Discord (Priority: P3)

A Discord member can confirm the hub's bot is online and working by issuing a simple command
and getting an immediate reply. The bot stays connected continuously.

**Why this priority**: It proves the second half of the hub — a persistent, interactive bot
presence — exists and is wired correctly, establishing the foundation that later roles,
moderation, and richer commands build on. It is lowest priority because the inbound
notification path (Stories 1–2) is the larger near-term value.

**Independent Test**: In a Discord server where the bot is installed, run the bot's basic
command and confirm it replies promptly; observe that the bot shows as online.

**Acceptance Scenarios**:

1. **Given** the service is running and the bot is connected, **When** a member issues the
   bot's basic health/availability command, **Then** the bot replies promptly in the channel
   where it was invoked.
2. **Given** the bot is connected, **When** a relevant Discord server event occurs (such as
   a member joining), **Then** the hub registers/observes that event (demonstrating it can
   react to server activity), without disrupting other functions.
3. **Given** the bot is running, **When** time passes with no activity, **Then** the bot
   remains connected and continues to respond to commands.

---

### Edge Cases

- **Duplicate deliveries**: external tools retry webhooks; the same event delivered twice
  must not produce two Discord messages (covered by US1 scenario 2).
- **Unauthenticated or tampered request**: rejected as unauthorized; never routed
  (US1 scenario 3).
- **Unknown source**: a request addressed to a source the hub does not recognize is rejected
  as not found; nothing is routed.
- **No matching route**: an authenticated event with no enabled route is accepted and
  silently produces no message (US1 scenario 4) — this is normal, not an error.
- **Discord temporarily unavailable**: a delivery that cannot reach Discord is retried a
  bounded number of times and, if still failing, recorded as failed; the sender is still
  acknowledged so it does not retry-storm.
- **Routing store temporarily unavailable**: when routing configuration cannot be read, the
  inbound request fails in a way that invites the sender to retry later (the event is not
  silently dropped); the bot's basic command still works.
- **Misconfigured route/target**: a route pointing at a target with missing delivery
  information records a failed delivery with a reason, rather than crashing the service.
- **Bot command error**: if a command's handler errors, the failure is contained — the bot
  stays connected and the member gets an error reply rather than silence.

## Requirements _(mandatory)_

### Functional Requirements

**Inbound receipt & authentication**

- **FR-001**: The system MUST expose an endpoint that receives webhooks from an external
  source, identified by the source.
- **FR-002**: The system MUST verify that each inbound request genuinely originates from the
  configured source before any further processing, using proof carried by the request
  checked against a secret the system holds (not supplied by the request).
- **FR-003**: The system MUST reject a request that fails verification as unauthorized,
  perform no routing or delivery for it, and signal a permanent failure (the sender should
  not retry).
- **FR-004**: The system MUST reject a request addressed to an unrecognized source as not
  found, performing no routing.
- **FR-004a**: For a verified, well-formed inbound request, the system MUST acknowledge the
  sender with success as soon as verification succeeds — before delivery to Discord completes —
  and then perform routing and delivery asynchronously. (Accepted trade-off for this slice: a
  crash between acknowledgement and delivery can drop that in-flight event; a durable
  store-and-forward buffer is deferred to a later feature. Per-route de-duplication still
  prevents double-posting when a sender legitimately retries.)
- **FR-004b**: When the routing store is unreachable and a verified inbound event therefore
  cannot be processed, the system MUST fail closed — signal a transient failure so the sender
  retries later — rather than acknowledge or silently drop the event.

**Normalization & routing**

- **FR-005**: The system MUST translate a verified inbound payload into a normalized internal
  representation of the event (including at minimum: the source, the event type, a stable
  per-event identifier usable for de-duplication, a human-readable summary, and a link back
  to the source item when available).
- **FR-006**: The system MUST determine delivery destinations by looking up routing
  configuration that maps a source and event type to Discord targets, honoring an
  enabled/disabled flag per route. A route matches an event when its source and **exact**
  event type match (catch-all/wildcard matching is a later-phase capability the model must
  not preclude). When an event matches more than one enabled route, the system MUST fan out
  to **all** matching routes, processing each independently so that a failure on one route
  does not prevent delivery on another.
- **FR-007**: The system MUST treat routing configuration as runtime-editable: adding,
  disabling, or repointing a route MUST take effect for subsequent events without a restart
  or redeploy.
- **FR-008**: The system MUST accept (not signal retry for) an authenticated event that
  matches no enabled route, and produce no Discord message for it.

**Formatting & delivery**

- **FR-009**: The system MUST format a normalized event into a Discord message that includes,
  at minimum, the event summary and a link back to the source item when one exists.
- **FR-010**: The system MUST deliver the formatted message to each configured Discord target
  for the event.
- **FR-011**: All delivery to Discord MUST pass through a single delivery path (no ad-hoc
  bypasses), so that de-duplication and rate-limit handling are enforced in one place.
- **FR-012**: The system MUST respect Discord's rate limits, retrying a delivery a bounded
  number of times with backoff on transient failures and honoring any wait period Discord
  requests.

**Idempotency & recording**

- **FR-013**: The system MUST ensure a given event delivered to a given route results in at
  most one Discord message, even if the same event is received multiple times. De-duplication
  is tracked per (route, event): when an event fans out to multiple routes, each route
  produces its own single message, and each is de-duplicated independently.
- **FR-014**: The system MUST record the outcome of each delivery attempt (at least:
  succeeded, failed, or skipped-as-duplicate), with enough detail (source, event type, event
  identifier, target, and a reason on failure) to audit what happened.

**Bot presence & interaction**

- **FR-015**: The system MUST maintain a continuous, automatically-reconnecting bot
  connection to Discord while the service is running.
- **FR-016**: The system MUST provide at least one bot command that a member can invoke and
  receive a prompt reply confirming the bot is responsive.
- **FR-017**: The system MUST be able to observe at least one Discord server event (such as a
  member joining), demonstrating the bot can react to server activity.
- **FR-018**: The system MUST contain command/handler failures so that one failing command
  does not disconnect the bot or stop other functions; the invoking member receives an error
  response.
- **FR-019**: Bot commands that do not depend on routing configuration MUST continue to work
  when the routing store is temporarily unavailable.

**Operability, resilience & security (cross-cutting)**

- **FR-020**: The system MUST expose a liveness signal that stays healthy whenever the
  process is running, independent of whether Discord or the routing store is currently
  reachable.
- **FR-021**: The system MUST provide a readiness signal that reflects whether dependencies
  (routing store reachable, bot connected) are currently available, kept separate from
  liveness.
- **FR-022**: The system MUST keep all credentials (bot credentials, source signing secrets,
  Discord channel delivery URLs) out of source control and out of routing configuration rows;
  where configuration must reach a secret, it MUST reference it indirectly rather than store
  its value.
- **FR-023**: The system MUST NOT record secrets, credentials, or full inbound payloads in
  its normal operational logs.

### Key Entities _(include if feature involves data)_

- **Source**: a recognized external system that can send events to the hub. Has a stable
  identifier (used to address its endpoint), a display name, an enabled/disabled state, and a
  reference to the secret used to authenticate its requests. Whether a source's events are
  acted upon is operator-controllable; the set of source _types_ the hub understands is fixed
  by the system.
- **Discord target**: a place a message can be sent — a specific Discord channel — described
  in enough detail to deliver to it. Carries how delivery is performed and an
  enabled/disabled state. Secret delivery details are referenced indirectly, not stored
  inline.
- **Route**: the operator-editable mapping that says "events of this type from this source go
  to this Discord target," with an enabled/disabled flag and optional per-route formatting
  preferences. Matches on an exact event type in this slice; the field is modeled so a future
  catch-all/wildcard value can be added without restructuring. This is the primary thing
  operators add and strike.
- **Normalized event**: the internal, source-agnostic representation of one occurrence —
  source, event type, a stable de-duplication identifier, a summary, an optional link, and
  the time it occurred.
- **Delivery record**: an audit entry for an attempt to deliver an event to a target —
  which route and event, which target, the outcome (succeeded / failed / skipped-duplicate),
  and a reason on failure. Doubles as the de-duplication ledger.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: An operator can take a brand-new external event type and have it appear in a
  chosen Discord channel by adding a single route — with no code change, restart, or
  redeploy.
- **SC-002**: A genuine external event that matches an enabled route appears in the target
  Discord channel within a few seconds of being received, under normal conditions.
- **SC-003**: When the same external event is delivered repeatedly (sender retries), exactly
  one message appears in Discord — zero duplicates across repeated deliveries of the same
  event.
- **SC-004**: 100% of inbound requests that fail authenticity verification are rejected with
  no message posted and nothing routed.
- **SC-005**: A member invoking the bot's basic command receives a reply promptly (within a
  couple of seconds) while the bot is running.
- **SC-006**: The bot remains continuously connected across an extended idle period and is
  still responsive afterward, without manual intervention.
- **SC-007**: Every delivery attempt is reflected in the audit record with its outcome, so an
  operator can determine, after the fact, whether any given event was delivered, skipped, or
  failed.
- **SC-008**: While Discord or the routing store is briefly unavailable, the service's
  liveness signal stays healthy (the service is not cycled), and dependency-free bot commands
  still respond.

## Assumptions

- **One source first (ClickUp)**: This slice implements exactly one external source end to
  end as the worked example. The receipt/verify/normalize/route/deliver pattern is built to
  generalize, but only ClickUp is wired in this feature; additional sources are later
  features.
- **One delivery style first**: Delivery to Discord uses the channel-webhook style (post to a
  channel via its delivery URL) for this slice; posting under the bot's own identity is a
  later feature. The single delivery path is designed to accommodate both.
- **Minimal bot scope**: The bot proves presence and interactivity with one basic command and
  observation of one server event; roles, moderation, and richer commands are out of scope
  here.
- **Operator-facing route management**: For this slice, operators manage routes directly
  through the routing store's own editing surface; a purpose-built admin UI is out of scope.
- **Single Discord server**: This slice targets one Discord server; multi-server routing is
  not required to be exercised, though the model should not preclude it.
- **Inbound acknowledgement strategy**: Acknowledge-then-deliver (asynchronous) — see
  FR-004a. The hub returns success on successful verification and delivers afterward;
  per-route de-duplication protects against the sender's retries. A durable buffer to survive
  a crash between acknowledgement and delivery is out of scope for this slice.
- **Always-on operation**: The service is expected to run continuously (the bot requires a
  persistent connection); the deployment provides a single always-running instance.

## Dependencies

- An external ClickUp workspace able to send webhooks to the hub, with a configurable signing
  secret.
- A Discord server where the bot is installed with the permissions it needs, and at least one
  channel reachable for delivery.
- A persistent store for routing configuration and delivery records that the running service
  can read and write, and that an operator can edit.
