/**
 * /purge — bulk-delete recent messages in the current channel. Gated by the invoker's native Manage
 * Messages permission. Messages older than the platform's 14-day bulk limit are reported as skipped.
 */
import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type GuildMember,
  type GuildTextBasedChannel,
} from 'discord.js';
import type { SlashCommand } from './types.js';
import { purgeMessages } from '../moderation/channel.js';
import { isModerator } from '../moderation/standing.js';
import { purgeChannelView } from './channel-adapter.js';

export const purgeCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Bulk-delete recent messages in this channel (1–100).')
    .addIntegerOption((opt) =>
      opt
        .setName('count')
        .setDescription('How many recent messages to delete (1–100).')
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName('reason')
        .setDescription('Reason (recorded in the audit log where supported).')
        .setRequired(false),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const invoker = interaction.member;
    if (!interaction.inCachedGuild() || !invoker || !('roles' in invoker) || !interaction.channel) {
      await interaction.editReply({ content: 'This command only works in a server channel.' });
      return;
    }
    if (!isModerator((invoker as GuildMember).permissions, 'purge')) {
      await interaction.editReply({ content: 'You lack the Manage Messages permission.' });
      return;
    }

    const count = interaction.options.getInteger('count', true);
    const reason = interaction.options.getString('reason') ?? undefined;
    const view = purgeChannelView(interaction.channel as GuildTextBasedChannel);
    const result = await purgeMessages(view, count, { now: () => Date.now() }, { reason });

    let content: string;
    if (result.outcome === 'done') {
      content =
        result.skippedTooOld > 0
          ? `Purged ${result.deleted} message(s). ${result.skippedTooOld} were too old to bulk-delete (>14 days) and were skipped.`
          : `Purged ${result.deleted} message(s).`;
    } else {
      content =
        result.reason === 'unsupported-channel'
          ? "This channel type doesn't support bulk delete."
          : result.reason === 'invalid-input'
            ? 'Count must be between 1 and 100.'
            : "Couldn't purge messages here.";
    }
    await interaction.editReply({ content });
  },
};
