/**
 * /unban — remove a user id from the server's ban list. Gated by the invoker's native Ban Members
 * permission. Thin adapter onto the unbanUserId capability.
 */
import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import type { SlashCommand } from './types.js';
import { unbanUserId } from '../moderation/sanctions.js';
import { isModerator } from '../moderation/standing.js';
import { guildBanView } from './moderation-adapter.js';

export const unbanCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Remove a user id from the ban list.')
    .addStringOption((opt) =>
      opt.setName('user_id').setDescription('The user id to unban.').setRequired(true),
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
    if (!isModerator((invoker as GuildMember).permissions, 'ban')) {
      await interaction.editReply({ content: 'You lack the Ban Members permission.' });
      return;
    }

    const userId = interaction.options.getString('user_id', true);
    const reason = interaction.options.getString('reason') ?? undefined;
    const result = await unbanUserId(guildBanView(interaction.guild), userId, { reason });

    let content: string;
    if (result.outcome === 'refused') {
      content =
        result.reason === 'invalid-input'
          ? `\`${userId}\` isn't a valid user id.`
          : `Couldn't unban \`${userId}\`.`;
    } else if (result.outcome === 'not-banned') {
      content = `\`${userId}\` isn't banned.`;
    } else {
      content = `Unbanned \`${userId}\`.`;
    }
    await interaction.editReply({ content });
  },
};
