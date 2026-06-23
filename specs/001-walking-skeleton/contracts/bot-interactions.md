# Contract: Bot interactions

The bot's Discord-facing surface for this slice: one slash command and one observed gateway
event. Both are instances of the registry patterns (Principle I); dispatch is generic.

## Gateway connection

- The bot logs in over the gateway at bootstrap and maintains a continuous,
  auto-reconnecting connection while the process runs (FR-015).
- **Intents (least privilege)**: `Guilds`, `GuildMembers` only. Message Content is **not**
  requested (FR/Principle II) — nothing in this slice reads message text.

## Slash command: `/ping`

| Aspect | Contract |
|--------|----------|
| Name | `ping` |
| Registration | Definitions pushed via `scripts/deploy-commands.mjs` — guild-scoped in dev, global in prod. |
| Invocation | A member runs `/ping` in a guild where the bot is installed. |
| Dispatch | One `interactionCreate` listener routes by command name into the command registry. |
| Response | A prompt reply confirming responsiveness (e.g. "Pong" with the round-trip/latency), within a couple of seconds (SC-005). |
| Error containment | If the handler throws, the failure is contained — the bot stays connected and the member gets an ephemeral error reply, not silence (FR-018). |
| Dependency | Does not require the routing store; works even when the DB is unavailable (FR-019). |

### Acceptance mapping
- US3 scenario 1 / SC-005 → `/ping` replies promptly while connected.
- US3 scenario 3 / SC-006 → still responds after an extended idle period.
- FR-018 → a thrown handler does not disconnect the bot; member sees an error reply.

## Gateway event handler: member join

| Aspect | Contract |
|--------|----------|
| Event | `guildMemberAdd`. |
| Handler | Registered in the event registry; bound at login by the registry's binding loop. |
| Action (this slice) | Observe and log the join (proves the bot can react to server activity); no role/welcome side-effects yet. |
| Isolation | A throw in this handler is contained and does not affect the gateway or other handlers (FR-018). |

### Acceptance mapping
- US3 scenario 2 / FR-017 → a member joining is observed/registered without disrupting other
  functions.

## Extension note (no code citations of spec)

Adding another command or handler is "write one module + register it at the one wiring point"
(`src/bot/commands/index.ts` or `src/bot/events/index.ts`). The interaction style is itself an
extension axis (slash now; prefix/components/etc. later) — see `ARCHITECTURE.md` §3.4. Shipped
code describes these rules in its own terms, never citing FRs/specs (Principle V).
