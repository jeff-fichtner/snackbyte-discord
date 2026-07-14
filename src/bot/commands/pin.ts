/**
 * /pin and /unpin — toggle a message's pinned state by id. Both gated by the invoker's native Manage
 * Messages permission (the `pin` capability key — /unpin reuses it). Two commands, one shared handler.
 */
import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type GuildMember,
  type GuildTextBasedChannel,
} from 'discord.js';
import type { SlashCommand } from './types.js';
import { setMessagePinned } from '../moderation/channel.js';
import { isModerator } from '../moderation/standing.js';
import { pinMessageView } from './channel-adapter.js';

function pinHandler(pinned: boolean) {
  return async (interaction: ChatInputCommandInteraction): Promise<void> => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const invoker = interaction.member;
    if (!interaction.inCachedGuild() || !invoker || !('roles' in invoker) || !interaction.channel) {
      await interaction.editReply({ content: 'This command only works in a server channel.' });
      return;
    }
    if (!isModerator((invoker as GuildMember).permissions, 'pin')) {
      await interaction.editReply({ content: 'You lack the Manage Messages permission.' });
      return;
    }

    const messageId = interaction.options.getString('message_id', true);
    const channel = interaction.channel as GuildTextBasedChannel;
    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (!message) {
      await interaction.editReply({ content: "Couldn't find that message in this channel." });
      return;
    }

    const result = await setMessagePinned(pinMessageView(message), pinned);
    await interaction.editReply({
      content:
        result.outcome === 'done'
          ? pinned
            ? 'Message pinned.'
            : 'Message unpinned.'
          : `Couldn't ${pinned ? 'pin' : 'unpin'} that message.`,
    });
  };
}

export const pinCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('pin')
    .setDescription('Pin a message by its id.')
    .addStringOption((opt) =>
      opt.setName('message_id').setDescription('The message id to pin.').setRequired(true),
    ),
  execute: pinHandler(true),
};

export const unpinCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('unpin')
    .setDescription('Unpin a message by its id.')
    .addStringOption((opt) =>
      opt.setName('message_id').setDescription('The message id to unpin.').setRequired(true),
    ),
  execute: pinHandler(false),
};
