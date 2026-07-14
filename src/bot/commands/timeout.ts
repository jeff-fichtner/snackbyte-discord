/**
 * /timeout — time a member out for a duration, or clear it. Moderation command: gated by the
 * invoker's native Moderate Members permission, then the bot-position + invoker-position guards.
 * Thin adapter onto the timeoutMember capability; renders an ephemeral outcome.
 */
import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import type { SlashCommand } from './types.js';
import { timeoutMember } from '../moderation/sanctions.js';
import { isModerator } from '../moderation/standing.js';
import { sanctionMemberView, parseDuration, BOT_PERMISSION } from './moderation-adapter.js';
import { sanctionRefusal } from './moderation-messages.js';

export const timeoutCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Time a member out for a duration (e.g. 10m, 2h, 7d), or 0 to clear it.')
    .addUserOption((opt) =>
      opt.setName('member').setDescription('The member to time out.').setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName('duration')
        .setDescription('How long (e.g. 30s, 10m, 2h, 7d; max 28d). Use 0 to clear a timeout.')
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName('reason')
        .setDescription('Reason (recorded in the audit log).')
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
    if (!isModerator(invokerMember.permissions, 'timeout')) {
      await interaction.editReply({ content: 'You lack the Timeout Members permission.' });
      return;
    }

    const durationStr = interaction.options.getString('duration', true);
    const durationMs = parseDuration(durationStr);
    if (durationMs === null) {
      await interaction.editReply({
        content: 'That duration is invalid — use e.g. `30s`, `10m`, `2h`, `7d`, or `0` to clear.',
      });
      return;
    }
    const reason = interaction.options.getString('reason') ?? undefined;
    const targetUser = interaction.options.getUser('member', true);
    const target = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!target) {
      await interaction.editReply({ content: "That member isn't in this server." });
      return;
    }

    const view = sanctionMemberView(target, invokerMember, BOT_PERMISSION.timeout);
    const result = await timeoutMember(view, durationMs, { reason });

    let content: string;
    if (result.outcome === 'done') {
      content =
        durationMs === 0
          ? `Cleared ${target.toString()}'s timeout.`
          : `Timed out ${target.toString()} for ${durationStr}.`;
    } else {
      content = sanctionRefusal(result.reason, target.toString());
    }
    await interaction.editReply({ content });
  },
};
