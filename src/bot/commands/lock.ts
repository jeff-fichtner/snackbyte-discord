/**
 * /lock and /unlock — deny or allow @everyone sending in the current channel. Both gated by the
 * invoker's native Manage Channels permission (the `lock` capability key — /unlock reuses it, it is
 * the same permission). Two commands, one shared handler.
 */
import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type GuildMember,
  type GuildTextBasedChannel,
} from 'discord.js';
import type { SlashCommand } from './types.js';
import { setChannelLock } from '../moderation/channel.js';
import { isModerator } from '../moderation/standing.js';
import { manageableChannelView } from './channel-adapter.js';

function lockHandler(locked: boolean) {
  return async (interaction: ChatInputCommandInteraction): Promise<void> => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const invoker = interaction.member;
    if (!interaction.inCachedGuild() || !invoker || !('roles' in invoker) || !interaction.channel) {
      await interaction.editReply({ content: 'This command only works in a server channel.' });
      return;
    }
    if (!isModerator((invoker as GuildMember).permissions, 'lock')) {
      await interaction.editReply({ content: 'You lack the Manage Channels permission.' });
      return;
    }

    const reason = interaction.options.getString('reason') ?? undefined;
    const view = manageableChannelView(interaction.channel as GuildTextBasedChannel);
    const result = await setChannelLock(view, locked, { reason });

    let content: string;
    if (result.outcome === 'refused') {
      content =
        result.reason === 'unsupported-channel'
          ? "This channel type can't be locked."
          : `Couldn't ${locked ? 'lock' : 'unlock'} this channel.`;
    } else {
      content = locked ? 'Channel locked — members can no longer send.' : 'Channel unlocked.';
    }
    await interaction.editReply({ content });
  };
}

export const lockCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Prevent members from sending in this channel.')
    .addStringOption((opt) =>
      opt
        .setName('reason')
        .setDescription('Reason (recorded in the audit log).')
        .setRequired(false),
    ),
  execute: lockHandler(true),
};

export const unlockCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Allow members to send in this channel again.')
    .addStringOption((opt) =>
      opt
        .setName('reason')
        .setDescription('Reason (recorded in the audit log).')
        .setRequired(false),
    ),
  execute: lockHandler(false),
};
