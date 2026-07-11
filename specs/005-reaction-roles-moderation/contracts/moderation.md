# Contract — Cross-Member Moderation

The `/nick` and `/role` commands grow an **optional target-member option**. No target (or self as
target) → the 004 self-service path, unchanged. A different target → a moderator-standing gate runs
before the existing bot-position guard. Replies stay ephemeral.

## `/nick [nickname] [member]`

| Option | Type | Required | Meaning |
|--------|------|----------|---------|
| `nickname` | string (≤32) | no | New nickname; omit to reset/clear. |
| `member` | user | no | Target member. Omit (or self) → change own nickname (004 path). |

- **Self path** (no `member`, or `member` = invoker): identical to 004 — `setOwnNickname`, 32-char +
  whitespace validation, bot-position guard, ephemeral reply.
- **Cross-member path** (`member` ≠ invoker): gate on the invoker's **Manage Nicknames** permission
  (FR-010). If absent → refuse, no change, "you can only change your own nickname" (FR-008). If
  present → `setMemberNickname(targetView, value)` — same 32-char/whitespace rules and the same
  bot-position guard applied to the **target** (bot must outrank the target and hold Manage
  Nicknames), else safe refusal (FR-011).

## `/role <role> [member]`

| Option | Type | Required | Meaning |
|--------|------|----------|---------|
| `role` | role | yes | Role to act on. |
| `member` | user | no | Target member. Omit (or self) → toggle on self (004 path). |

- **Self path** (no `member`, or `member` = invoker): identical to 004 — `toggleSelfRole`,
  whitelist-gated, bot-position guard, ephemeral reply.
- **Cross-member path** (`member` ≠ invoker): gate on the invoker's **Manage Roles** permission
  (FR-010). If absent → refuse, no change (FR-009). If present → `setMemberRole(targetView, role)`,
  which **toggles** the role on the target and is **not** whitelist-bounded (FR-009 — moderation
  manages roles a member could not self-assign), but IS bounded by:
  - the **bot-position** guard (bot above the role + Manage Roles) — FR-011; and
  - an **invoker-position** guard: the target role must be **below the invoking moderator's** own
    highest role (a moderator cannot grant a role they do not themselves outrank — mirrors Discord's
    hierarchy rule, prevents escalation). Else safe refusal.

## Moderator standing (`src/bot/moderation/standing.ts`)

```
isModerator(view: { has(permission): boolean }, capability: 'nickname' | 'role'): boolean
```

Returns whether the invoker holds the **native** permission for the capability — Manage Nicknames
for `'nickname'`, Manage Roles for `'role'`. Evaluated per invocation from the invoker's live
permissions, so revoking standing takes effect on the next command (spec edge case). Pure over a
minimal permission view; unit tested with plain objects. No moderator-role store (FR-010).

## Outcomes & replies (ephemeral — FR-012)

| Case | Reply |
|------|-------|
| own nick set/reset | 004 messages, unchanged |
| own role toggled | 004 messages, unchanged |
| cross-member nick set/reset (moderator) | `Set **@target**'s nickname to **X**.` / `Reset **@target**'s nickname.` |
| cross-member role added/removed (moderator) | `Added **Role** to **@target**.` / `Removed **Role** from **@target**.` |
| non-moderator targets another member | `You can only change your own nickname.` / `You can only manage your own roles.` — no change |
| bot cannot manage target/role | `I can't manage that — it's above my role, or I'm missing the permission.` — no change |
| invoker outranked by the role (role path) | `You can't assign a role at or above your own highest role.` — no change |
| not in a guild | `This command only works in a server.` |

## Invariants

- **Self path is byte-for-byte 004 behavior** (SC-007) — the target option is additive; omitting it
  changes nothing about the existing flow.
- **No new intent** — moderation reads target/role/value from **command options**, not message text,
  so Message Content stays off (FR-013).
- **Every mutation is gated before it happens** — standing (cross-member) → bot-position → (role
  path) invoker-position, all before any write; a failure at any gate is a safe, ephemeral refusal
  with no partial change (FR-011, SC-005).
- **Containment** — a throwing command is caught by the existing `interactionCreate` try/catch →
  ephemeral error; the bot and other commands are unaffected (FR-014).
