/**
 * /slowmode — set (or clear, with 0) the current channel's slowmode. Gated by the invoker's native
 * Manage Channels permission.
 */
import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type GuildMember,
  type GuildTextBasedChannel,
} from 'discord.js';
import type { SlashCommand } from './types.js';
import { setSlowmode, MAX_SLOWMODE_SECONDS } from '../moderation/channel.js';
import { isModerator } from '../moderation/standing.js';
import { manageableChannelView } from './channel-adapter.js';

export const slowmodeCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Set this channel’s slowmode in seconds (0 to clear).')
    .addIntegerOption((opt) =>
      opt
        .setName('seconds')
        .setDescription(`Seconds between messages (0–${MAX_SLOWMODE_SECONDS}; 0 clears).`)
        .setMinValue(0)
        .setMaxValue(MAX_SLOWMODE_SECONDS)
        .setRequired(true),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const invoker = interaction.member;
    if (!interaction.inCachedGuild() || !invoker || !('roles' in invoker) || !interaction.channel) {
      await interaction.editReply({ content: 'This command only works in a server channel.' });
      return;
    }
    if (!isModerator((invoker as GuildMember).permissions, 'slowmode')) {
      await interaction.editReply({ content: 'You lack the Manage Channels permission.' });
      return;
    }

    const seconds = interaction.options.getInteger('seconds', true);
    const view = manageableChannelView(interaction.channel as GuildTextBasedChannel);
    const result = await setSlowmode(view, seconds);

    let content: string;
    if (result.outcome === 'done') {
      content = seconds === 0 ? 'Slowmode cleared.' : `Slowmode set to ${seconds}s.`;
    } else {
      content =
        result.reason === 'unsupported-channel'
          ? "This channel type doesn't support slowmode."
          : result.reason === 'invalid-input'
            ? `Seconds must be between 0 and ${MAX_SLOWMODE_SECONDS}.`
            : "Couldn't set slowmode here.";
    }
    await interaction.editReply({ content });
  },
};
