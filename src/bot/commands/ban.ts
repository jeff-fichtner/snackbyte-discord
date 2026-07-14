/**
 * /ban — one unified command for the whole ban surface. The supplied option selects the mode:
 *   member    → ban a present member (hierarchy-guarded)
 *   user_id   → pre-emptively ban a user by id (may not be in the server)
 *   user_ids  → bulk-ban several ids (comma/space separated), per-id outcomes reported
 * Gated by the invoker's native Ban Members permission. Thin adapter onto the ban capabilities.
 */
import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import type { SlashCommand } from './types.js';
import { banMember, banUserId, bulkBanUserIds } from '../moderation/sanctions.js';
import { isModerator } from '../moderation/standing.js';
import { sanctionMemberView, guildBanView, BOT_PERMISSION } from './moderation-adapter.js';
import { sanctionRefusal } from './moderation-messages.js';

/** Convert an optional "delete last N days" (0–7) choice into seconds for the ban call. */
function deleteWindowSeconds(days: number | null): number | undefined {
  if (days === null || days <= 0) return undefined;
  return Math.min(days, 7) * 86_400;
}

export const banCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member, pre-emptively ban a user id, or bulk-ban several ids.')
    .addUserOption((opt) =>
      opt.setName('member').setDescription('A present member to ban.').setRequired(false),
    )
    .addStringOption((opt) =>
      opt
        .setName('user_id')
        .setDescription('A user id to pre-emptively ban (not in the server).')
        .setRequired(false),
    )
    .addStringOption((opt) =>
      opt
        .setName('user_ids')
        .setDescription('Several user ids (comma or space separated) to bulk-ban.')
        .setRequired(false),
    )
    .addStringOption((opt) =>
      opt
        .setName('reason')
        .setDescription('Reason (recorded in the audit log).')
        .setRequired(false),
    )
    .addIntegerOption((opt) =>
      opt
        .setName('delete_messages')
        .setDescription("Days of the banned user's recent messages to purge (0–7).")
        .setMinValue(0)
        .setMaxValue(7)
        .setRequired(false),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const invoker = interaction.member;
    if (!interaction.inCachedGuild() || !invoker || !('roles' in invoker)) {
      await interaction.editReply({ content: 'This command only works in a server.' });
      return;
    }
    const invokerMember = invoker as GuildMember;
    if (!isModerator(invokerMember.permissions, 'ban')) {
      await interaction.editReply({ content: 'You lack the Ban Members permission.' });
      return;
    }

    const reason = interaction.options.getString('reason') ?? undefined;
    const deleteMessageSeconds = deleteWindowSeconds(
      interaction.options.getInteger('delete_messages'),
    );
    const member = interaction.options.getUser('member');
    const userId = interaction.options.getString('user_id');
    const userIds = interaction.options.getString('user_ids');

    // Exactly one mode must be supplied — refuse (don't silently drop) if two or three are given,
    // so a moderator is never told "banned" when only part of their intent ran.
    const modesSupplied = [member, userId, userIds].filter(Boolean).length;
    if (modesSupplied > 1) {
      await interaction.editReply({
        content: 'Supply only one of `member`, `user_id`, or `user_ids` per command.',
      });
      return;
    }

    // Present-member ban (hierarchy-guarded).
    if (member) {
      const target = await interaction.guild.members.fetch(member.id).catch(() => null);
      if (!target) {
        await interaction.editReply({
          content: "That member isn't in this server (use `user_id` to pre-emptively ban).",
        });
        return;
      }
      const view = sanctionMemberView(target, invokerMember, BOT_PERMISSION.ban);
      const result = await banMember(view, { reason, deleteMessageSeconds });
      await interaction.editReply({
        content:
          result.outcome === 'done'
            ? `Banned ${target.toString()}.`
            : sanctionRefusal(result.reason, target.toString()),
      });
      return;
    }

    const guild = guildBanView(interaction.guild);

    // Bulk ban by ids.
    if (userIds) {
      const ids = userIds.split(/[\s,]+/).filter(Boolean);
      if (ids.length === 0) {
        await interaction.editReply({ content: 'Provide at least one user id to bulk-ban.' });
        return;
      }
      const results = await bulkBanUserIds(guild, ids, { reason, deleteMessageSeconds });
      const banned = results.filter((r) => r.outcome === 'banned').length;
      const lines = results.map((r) => {
        const detail =
          r.outcome === 'refused'
            ? r.reason === 'invalid-input'
              ? 'invalid id'
              : 'failed'
            : r.outcome;
        return `• \`${r.userId}\` — ${detail}`;
      });
      await interaction.editReply({
        content: `Bulk ban: ${banned}/${results.length} newly banned.\n${lines.join('\n')}`,
      });
      return;
    }

    // Pre-emptive ban by a single id.
    if (userId) {
      const result = await banUserId(guild, userId, { reason, deleteMessageSeconds });
      let content: string;
      if (result.outcome === 'refused') {
        content =
          result.reason === 'invalid-input'
            ? `\`${userId}\` isn't a valid user id.`
            : `Couldn't ban \`${userId}\`.`;
      } else if (result.outcome === 'already-banned') {
        content = `\`${userId}\` is already banned.`;
      } else {
        content = `Banned \`${userId}\` (pre-emptive).`;
      }
      await interaction.editReply({ content });
      return;
    }

    await interaction.editReply({
      content: 'Provide a `member`, a `user_id`, or `user_ids` to ban.',
    });
  },
};
