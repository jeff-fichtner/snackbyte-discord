# Contract — Additional Interaction Styles (Components & Text-Prefix)

Two new input adapters over the EXISTING role/nickname capabilities. Neither adds capability logic;
both resolve to the same `src/bot/members/` calls through the same authorization gate the slash and
reaction styles use (Principle I, FR-013).

## Component style (buttons / select menus)

**Dispatch**: extends the existing `interactionCreate`. After the current chat-input-command branch,
a component branch routes `interaction.isButton()` / `isAnySelectMenu()` to a component registry keyed
by `customId`. **No new gateway intent** — component interactions arrive on the same event as
commands.

**Resolution** (`src/bot/components/resolve.ts`, pure — mirrors 005's reaction resolver):

```
resolveComponentRole(input: {
  bindings: ComponentRoleBinding[];   // this guild's rows
  whitelistRoleIds: string[];         // this guild's self_assignable_roles
  componentKey: string;               // button customId, or select customId+value
}): string | null                     // role id to toggle, or null (ignore)
```

Returns a role id only when a binding matches `componentKey` AND that binding's role is on the
whitelist; else `null`. The handler then calls the existing `toggleSelfRole` capability and replies
ephemerally.

| Activation | Resolver | Gate | Effect |
|------------|----------|------|--------|
| button/option bound + whitelisted, bot can manage | role id | pass | role **toggled**, ephemeral confirm |
| bound but role not whitelisted | `null` | — | no-op (silent/ephemeral) |
| unbound component | `null` | — | no-op |
| bound + whitelisted, role above bot | role id | refuse `bot-cannot-manage` | ephemeral safe refusal, no change |
| binding's role deleted / de-whitelisted | `null` or refuse | — | clean no-op, never a crash |

**Config**: bindings are operator-editable runtime data in `component_role_bindings` (FR-014). Rapid
repeated clicks converge to a single consistent role state (toggle idempotency).

## Text-prefix style (`!role`, `!roles`, `!nick`)

**Enablement**: a process config flag (`src/config.ts`) — **off by default**. The flag gates BOTH the
`messageCreate` handler AND the conditional **Message Content** intent in `src/bot/client.ts`: the
intent is requested *only* when the flag is on. (research §6)

**Dispatch**: a new `messageCreate` handler. When enabled, it parses a message that starts with the
configured prefix into a `(capability, args)` and calls the same role/nickname capability the slash
command uses, through the same gate. When disabled, the handler is a no-op and the intent is absent.

| Prefix command | Maps to capability | Gate |
|----------------|--------------------|------|
| `!role <role>` | `toggleSelfRole` | self-assignable whitelist + bot-position (same as `/role`) |
| `!roles` | `listSelfAssignableRoles` | — (read) |
| `!nick <name>` / `!nick` | `setOwnNickname` | 32-char + whitespace + bot-position (same as `/nick`) |

**Isolation (FR-015, SC-006)**: with the flag OFF (default), the bot boots, Message Content is NOT
requested, and slash / reaction / component styles all work — text-prefix simply does nothing. The
`bot-intents` test asserts Message Content is absent by default and present only when the style is
enabled.

## Shared invariants (both styles)

- **Same authorization, no bypass** — a component or text command can never grant a role the
  self-assignable whitelist does not allow; it reuses the exact gate, never a parallel one (FR-013,
  SC-007).
- **No capability rewrite** — adding either style is a new adapter + (for components) a resolver +
  binding store; `src/bot/members/` is unchanged. (FR-013)
- **Generic dispatch** — components via the registry keyed by `customId`; text-prefix via its message
  dispatcher — no central switch enumerating them (FR-019).
- **Containment** — a throwing component/text handler is caught by its dispatcher's per-handler guard
  (same pattern as `bindHandlers`); one failure never disconnects the gateway or affects other styles
  (FR-018).
- **Ephemeral / quiet** — component replies are ephemeral to the acting member; a failed text-prefix
  command does not spam the channel (FR-016).
