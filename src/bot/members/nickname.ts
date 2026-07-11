/**
 * Self-service nickname capability — the logic behind /nick, independent of any interaction style.
 * Takes a minimal member view and a value (or undefined to reset), enforces the platform's 32-char
 * limit, applies the bot-position guard, and returns a structured outcome. Acts only on the member
 * passed in. The command module adapts a live GuildMember onto this.
 */

const MAX_NICKNAME_LENGTH = 32;

/** The minimal member surface the capability acts on (a live GuildMember maps onto this). */
export interface NicknameMemberView {
  setNickname(value: string | null): Promise<void>;
  /** Whether the bot's highest role is above the target member's — required to manage its nickname. */
  botOutranksMember: boolean;
  /** Whether the bot holds the Manage Nicknames permission in this guild. */
  botCanManageNicknames: boolean;
}

export type NicknameOutcome =
  | { outcome: 'set' | 'cleared' }
  | { outcome: 'refused'; reason: 'invalid-input' | 'bot-cannot-manage' };

/**
 * Set a member's nickname to `value`, or reset it (clear) when `value` is undefined. A provided
 * value must be ≤ 32 characters and not whitespace-only. The bot-position guard applies to both set
 * and reset (a change when the member outranks the bot is refused, not attempted). Never throws for
 * an expected failure. The member view is target-agnostic — it carries whether the bot outranks
 * *this* member — so this is the shared core of both the self and cross-member paths.
 */
async function applyNickname(
  member: NicknameMemberView,
  value: string | undefined,
): Promise<NicknameOutcome> {
  // Validate a provided value (a reset has no value to validate).
  if (value !== undefined) {
    if (value.trim().length === 0 || value.length > MAX_NICKNAME_LENGTH) {
      return { outcome: 'refused', reason: 'invalid-input' };
    }
  }
  // Bot-position guard — applies to set AND reset.
  if (!member.botCanManageNicknames || !member.botOutranksMember) {
    return { outcome: 'refused', reason: 'bot-cannot-manage' };
  }
  try {
    await member.setNickname(value ?? null);
    return { outcome: value === undefined ? 'cleared' : 'set' };
  } catch {
    return { outcome: 'refused', reason: 'bot-cannot-manage' };
  }
}

/**
 * Set the invoking member's own nickname (the self-service path — no moderator standing needed).
 * Acts only on the member passed in.
 */
export async function setOwnNickname(
  member: NicknameMemberView,
  value: string | undefined,
): Promise<NicknameOutcome> {
  return applyNickname(member, value);
}

/**
 * Set another member's nickname (the moderation path). Identical validation and bot-position guard
 * as the self path, applied to the target member's view. The caller is responsible for the
 * moderator-standing check before invoking this; the bot-position guard here is the second gate.
 */
export async function setMemberNickname(
  member: NicknameMemberView,
  value: string | undefined,
): Promise<NicknameOutcome> {
  return applyNickname(member, value);
}
