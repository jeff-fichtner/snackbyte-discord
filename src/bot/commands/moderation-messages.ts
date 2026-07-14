/**
 * Shared, member-actionable refusal messages for the moderation commands, so every sanction renders
 * a consistent reason. Kept out of the capability layer (which returns structured reasons) — this is
 * purely the presentation adapter.
 */
import type { SanctionOutcome } from '../moderation/sanctions.js';

type SanctionRefusalReason = Extract<SanctionOutcome, { outcome: 'refused' }>['reason'];

/** Render a sanction refusal reason as an ephemeral message naming the target. */
export function sanctionRefusal(reason: SanctionRefusalReason, mention: string): string {
  switch (reason) {
    case 'bot-cannot-manage':
      return `I can't act on ${mention} — they're above my role, or I'm missing the permission.`;
    case 'invoker-outranked':
      return `You can't act on ${mention} — they're at or above your own highest role.`;
    case 'self-target':
      return "You can't use that on yourself.";
    case 'bot-target':
      return "You can't use that on me.";
    case 'invalid-input':
      return 'That input is invalid.';
    case 'failed':
      return `That action couldn't be completed on ${mention}.`;
  }
}
