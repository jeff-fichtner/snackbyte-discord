# Feature Specification: GitHub source + per-route formatting

**Feature Branch**: `002-github-source`

**Created**: 2026-06-23

**Status**: Draft

**Input**: User description: "GitHub as a second inbound source, plus the per-route formatting layer it exercises. GitHub-adapter-first proves the source-adapter pattern generalizes beyond ClickUp. Add a GitHub source (verify its signature, parse key events into the canonical event), named transforms a route can select by name so GitHub renders differently from ClickUp, and per-route config driving operator-tunable formatting (mention roles, embed color, event filtering). Reuse the existing routing engine, single delivery path, secrets-by-reference, and runtime-mutable routing. Out of scope: posting under the bot's identity, admin endpoints, and bot/interaction work."

## Clarifications

### Session 2026-06-23

- Q: How is a filter-suppressed delivery recorded in the audit log? → A: Add a distinct `filtered` outcome value (a new status alongside ok/failed/skipped), so an operator can tell an intentional filter-suppression from a duplicate or a failure at a glance.
- Q: How does the GitHub source express event types so operators can route per action without changing the exact-match engine? → A: A combined `type.action` discriminator (e.g. `pull_request.opened`, `pull_request.closed`, `issues.opened`, `push`); each routes as its own row via the existing exact-match lookup, keeping scale in cheap runtime-editable data rather than code.
- Q: What is the per-route event filter's shape? → A: An exclusion list of event subtypes in the route config — listed subtypes are suppressed (recorded `filtered`); empty/absent means deliver all matched events. (Exact config key settled at planning.)

## User Scenarios & Testing _(mandatory)_

### User Story 1 - GitHub activity reaches the right Discord channel (Priority: P1)

A team uses GitHub and wants repository activity (a pull request opened, a push, an issue
filed) to show up in a specific Discord channel, the same way ClickUp activity already does.
When something happens in GitHub, a formatted notification appears in the chosen channel, with
a clear summary and a link back to the GitHub item.

**Why this priority**: This is the core deliverable — it proves the hub supports a second
external source end to end, which is the whole point of this feature. It delivers standalone
value (GitHub → Discord) and validates that adding a source is cheap and pattern-based.

**Independent Test**: Register GitHub as a source and a route (a GitHub event type → a Discord
channel), trigger or simulate that GitHub event with a valid signature, and confirm a correctly
formatted message appears in the channel and the delivery is recorded as successful.

**Acceptance Scenarios**:

1. **Given** GitHub is registered as a source and an enabled route maps a GitHub event type to a
   Discord channel, **When** a genuine, authenticated GitHub event of that type arrives, **Then**
   a formatted message (summary + link to the GitHub item) appears in that channel and the
   delivery is recorded as successful.
2. **Given** the same configuration, **When** the same GitHub event is delivered more than once
   (the provider retries), **Then** only one message appears and the duplicate is recorded as
   skipped.
3. **Given** an incoming request that does not carry valid proof it came from GitHub, **When** it
   is received, **Then** it is rejected as unauthorized, no message is posted, and nothing is
   routed.
4. **Given** an authenticated GitHub event of a type the system does not handle (or for which no
   enabled route exists), **When** it is received, **Then** the request is accepted (the sender is
   not told to retry) and no message is posted.
5. **Given** both ClickUp and GitHub routes are configured, **When** events from each arrive,
   **Then** each is delivered to its own configured destination, with neither source affecting the
   other.

---

### User Story 2 - An operator chooses how each route is formatted (Priority: P2)

An operator wants GitHub notifications to look different from ClickUp notifications, and wants to
pick the presentation per route. They can select, for a given route, which named formatting
style applies — without writing code — so the same underlying style can serve many routes.

**Why this priority**: Notifications from different sources need to read differently to be
useful; a single generic format undersells the hub. Selecting a named style per route is what
makes formatting an operator concern rather than an engineering task, and it's the layer the
GitHub source naturally exercises.

**Independent Test**: With two routes for the same event, assign one a named formatting style and
leave the other on the default; trigger the event and confirm each channel receives its
respectively-formatted message.

**Acceptance Scenarios**:

1. **Given** a route configured to use a specific named formatting style, **When** a matching
   event arrives, **Then** the message is rendered in that style.
2. **Given** a route with no named style selected, **When** a matching event arrives, **Then** the
   message is rendered in the default style (unchanged from today's behavior).
3. **Given** a route referencing a named style that does not exist, **When** a matching event
   arrives, **Then** the system falls back to the default style and still delivers (it does not
   fail the delivery).

---

### User Story 3 - An operator tunes formatting and filtering per route via configuration (Priority: P3)

An operator wants to adjust a route's presentation and noise level without code or new styles —
e.g. mention a specific role on important events, set an accent color, or suppress event
subtypes they don't care about. They do this through per-route configuration, so one formatting
style covers many routes with different settings.

**Why this priority**: Real use demands per-channel tuning (a "@team" ping in one channel,
quieter output in another). Doing this through configuration rather than new styles keeps the
number of code-level styles small and puts control in the operator's hands. Lower priority
because Stories 1–2 already deliver working, differentiated GitHub notifications.

**Independent Test**: On one route, set a configuration value (e.g. a role to mention and a
filter excluding a subtype); trigger matching and non-matching events; confirm the mention
appears, the accent applies, and filtered subtypes produce no message — all without changing
code or the selected style.

**Acceptance Scenarios**:

1. **Given** a route configured to mention a role, **When** a matching event arrives, **Then** the
   delivered message includes that mention.
2. **Given** a route configured with an accent color (or similar presentation setting), **When** a
   matching event arrives, **Then** the message reflects that setting.
3. **Given** a route configured to filter out a specific event subtype, **When** an event of that
   subtype arrives, **Then** no message is delivered for that route and the outcome is recorded as
   `filtered`, while non-filtered subtypes still deliver.
4. **Given** the same formatting style used by two routes with different configuration, **When**
   matching events arrive, **Then** each route's message reflects its own configuration.

---

### Edge Cases

- **Unauthenticated or tampered GitHub request**: rejected as unauthorized; never routed
  (US1 scenario 3).
- **Unhandled / unsubscribed event type**: an authenticated GitHub event the system does not
  handle (or that GitHub sends for subscription bookkeeping, e.g. a ping) is accepted and produces
  no message — normal, not an error.
- **Duplicate delivery**: GitHub retries; the same event must not double-post (US1 scenario 2),
  using the same per-route de-duplication already in place.
- **Malformed payload**: an authenticated request whose body cannot be parsed for GitHub is
  rejected as a bad request; nothing is routed.
- **Filtered-to-empty**: when per-route filtering suppresses an event, the route delivers nothing
  but the decision is recorded as `filtered` (so an operator can see it was intentionally
  suppressed, not lost or duplicated).
- **Config that references a missing role/style**: the system degrades gracefully (default style,
  mention omitted if unresolvable) rather than failing the delivery.
- **Both sources active**: a misconfiguration or failure in one source's handling must not affect
  the other (source isolation).

## Requirements _(mandatory)_

### Functional Requirements

**GitHub as a source (instance of the existing pattern)**

- **FR-001**: The system MUST accept inbound GitHub events on the same generic inbound mechanism
  used for other sources, identified as the GitHub source — without the routing, delivery, or
  de-duplication behavior having to know it is GitHub specifically.
- **FR-002**: The system MUST verify that each inbound GitHub request genuinely originates from
  GitHub before any further processing, using proof carried by the request checked against a
  secret the system holds (resolved by reference, not stored in routing rows or source control).
- **FR-003**: The system MUST reject a GitHub request that fails verification as unauthorized,
  perform no routing or delivery, and signal a permanent failure (the sender should not retry).
- **FR-004**: The system MUST translate a verified GitHub payload into the same normalized
  internal event representation other sources produce (source, event type, a stable per-event
  identifier for de-duplication, a human-readable summary, a link back to the GitHub item, and the
  time it occurred).
- **FR-005**: The system MUST handle a defined initial set of GitHub event types (at minimum:
  pull request opened and closed, push, and issue opened and closed) and MUST accept-without-acting
  on GitHub event types it does not handle. A **merged** pull request is the `pull_request.closed`
  event with a merged indicator carried in the event data — NOT a separate `pull_request.merged`
  discriminator (GitHub has no such action); merged-vs-unmerged is distinguished downstream via the
  event's `subtype`/data, not by a distinct event type. Each handled event MUST be expressed as a
  combined `type.action` discriminator (e.g. `pull_request.opened`, `pull_request.closed`,
  `issues.opened`, `push`) so an operator routes each action as its own route via the existing
  exact-match lookup —
  no change to the matching engine.
- **FR-006**: Adding GitHub MUST NOT require changes to the routing engine, the delivery path, or
  the de-duplication mechanism; GitHub MUST be an additional source registered alongside the
  existing one.

**Named formatting styles (transforms selectable per route)**

- **FR-007**: The system MUST support multiple named formatting styles, and a route MUST be able to
  select which named style renders its messages.
- **FR-008**: A route that selects no named style MUST render in the default style, preserving the
  behavior that exists today.
- **FR-009**: If a route references a named style that does not exist, the system MUST fall back to
  the default style and still deliver (it MUST NOT fail the delivery).
- **FR-010**: Operators MUST be able to add or change which named style a route uses at runtime
  (no redeploy), consistent with the existing runtime-mutable routing.

**Per-route configuration (formatting + filtering)**

- **FR-011**: The system MUST let each route carry operator-editable configuration that adjusts
  presentation (at minimum: mentioning one or more roles, and an accent/color setting) without
  requiring a new style or code change.
- **FR-012**: The system MUST let a route's configuration filter which events it delivers via an
  **exclusion list of event subtypes** in the route's config (an event whose subtype is listed is
  suppressed for that route); an empty or absent list means "deliver everything that matched the
  route." So an authenticated, routed event can be intentionally suppressed for that route while
  other subtypes still deliver. (The exact config key/shape is settled at planning.)
- **FR-013**: When per-route configuration suppresses an event, the system MUST deliver nothing for
  that route and MUST record the outcome as a distinct `filtered` status (separate from
  succeeded, failed, and skipped-as-duplicate) so the suppression is auditable and unambiguous.
- **FR-014**: The same named style MUST be reusable across many routes, each with its own
  configuration, so configuration — not new code — accounts for per-route variation.
- **FR-015**: Configuration changes MUST take effect at runtime for subsequent events (no restart
  or redeploy).

**Preserved guarantees (carried over, must still hold)**

- **FR-016**: All delivery for GitHub events MUST go through the same single delivery path used by
  other sources (no separate bypass), so de-duplication and rate-limit handling remain enforced in
  one place.
- **FR-017**: A given GitHub event delivered to a given route MUST result in at most one message,
  even if the event is received multiple times.
- **FR-018**: The system MUST record the outcome of each GitHub delivery attempt — one of
  succeeded, failed, skipped-as-duplicate, or `filtered` — with enough detail to audit what
  happened.
- **FR-019**: A failure or misconfiguration affecting one source MUST NOT prevent the other
  source's events from being processed and delivered.

### Key Entities _(include if feature involves data)_

- **GitHub source**: a recognized external source, registered alongside the existing one, with its
  own authenticity secret (referenced, not stored inline) and its own enable/disable control. The
  set of GitHub event types the system understands is fixed in code and expressed as combined
  `type.action` discriminators (e.g. `pull_request.opened`, `push`); whether they are acted upon is
  operator-controlled via routes that match those discriminators exactly.
- **Named formatting style**: a selectable way of rendering a normalized event into a Discord
  message. There is a default style plus additional named styles; a route names the style it wants
  (or none, meaning default). Styles are defined in code; selection is operator data.
- **Route configuration**: operator-editable settings attached to a route that tune presentation
  (role mentions, accent color) and filtering (which event subtypes to deliver), letting one style
  serve many routes differently. (Extends the route's existing configuration capability.)
- **Delivery outcome**: the recorded result of an attempt for a (route, event) — now adding a
  distinct `filtered` status alongside the existing succeeded / failed / skipped-duplicate (the
  set of recordable outcomes grows by one value).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: An operator can make GitHub activity appear in a chosen Discord channel by
  registering the GitHub source and adding one route — with no code change beyond the GitHub source
  itself shipping, and no change to routing/delivery internals.
- **SC-002**: A genuine GitHub event that matches an enabled route appears in the target channel
  within a few seconds of being received, under normal conditions.
- **SC-003**: 100% of inbound GitHub requests that fail authenticity verification are rejected with
  no message posted and nothing routed.
- **SC-004**: When the same GitHub event is delivered repeatedly, exactly one message appears —
  zero duplicates.
- **SC-005**: An operator can give two routes for the same event different presentations (different
  named style, or same style with different configuration) and each channel receives its
  respectively-formatted message — with no code change.
- **SC-006**: An operator can suppress an event subtype on one route via configuration, and that
  subtype produces no message on that route while still delivering on routes that don't filter it.
- **SC-007**: ClickUp notifications continue to work unchanged after GitHub is added (no
  regression), and an issue with one source does not stop the other.
- **SC-008**: Every GitHub delivery attempt is reflected in the audit record with its outcome
  (delivered, failed, skipped-duplicate, or filtered), so an operator can determine after the fact
  what happened to any event.

## Assumptions

- **GitHub's signature scheme**: GitHub signs webhook deliveries with an HMAC (the
  `X-Hub-Signature-256` header); the GitHub source verifies against a per-source signing secret,
  the same secrets-by-reference approach used for the existing source.
- **Event-type identifier**: GitHub's delivery carries an event/action discriminator and a stable
  per-delivery identifier usable for de-duplication; where a stable id is unavailable, a hash of
  the payload is an acceptable de-dup key (consistent with the existing source).
- **Initial event coverage**: pull request opened/closed/merged, push, and issue opened/closed are
  the initial mapped events; more can be added later by extending the GitHub source. GitHub's
  subscription "ping" and unmapped events are accepted and ignored.
- **Delivery style**: GitHub notifications use the existing channel-webhook delivery path (the same
  one ClickUp uses). Posting under the bot's identity is out of scope (a later feature).
- **Configuration shape**: per-route configuration reuses the route's existing configuration field;
  this feature defines the formatting/filtering keys it reads, with sensible defaults when keys are
  absent.
- **Operator route management**: operators add the GitHub source row, routes, named-style
  selections, and per-route configuration through the routing store's existing editing surface — no
  purpose-built admin UI in this feature.
- **Out of scope (later phases)**: bot-REST delivery path, admin/diagnostics endpoints, and any
  bot or interaction-style work.

## Dependencies

- The existing inbound/verify/normalize/route/deliver pipeline and runtime-mutable routing store
  from the walking skeleton (the foundation this feature extends).
- A GitHub repository (or organization) able to send webhooks to the hub, with a configurable
  signing secret.
- The existing Discord delivery target(s) and the channel-webhook delivery path.
