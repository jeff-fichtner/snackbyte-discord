/**
 * /kick — remove a present member from the server (they may rejoin). Gated by the invoker's native
 * Kick Members permission + the hierarchy guards. Thin adapter onto the kickMember capability.
 */
import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import type { SlashCommand } from './types.js';
import { kickMember } from '../moderation/sanctions.js';
import { isModerator } from '../moderation/standing.js';
import { sanctionMemberView, BOT_PERMISSION } from './moderation-adapter.js';
import { sanctionRefusal } from './moderation-messages.js';

export const kickCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Remove a member from the server (they can rejoin with a new invite).')
    .addUserOption((opt) =>
      opt.setName('member').setDescription('The member to kick.').setRequired(true),
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
    if (!isModerator(invokerMember.permissions, 'kick')) {
      await interaction.editReply({ content: 'You lack the Kick Members permission.' });
      return;
    }

    const reason = interaction.options.getString('reason') ?? undefined;
    const targetUser = interaction.options.getUser('member', true);
    const target = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!target) {
      await interaction.editReply({ content: "That member isn't in this server." });
      return;
    }

    const view = sanctionMemberView(target, invokerMember, BOT_PERMISSION.kick);
    const result = await kickMember(view, { reason });
    await interaction.editReply({
      content:
        result.outcome === 'done'
          ? `Kicked ${target.toString()}.`
          : sanctionRefusal(result.reason, target.toString()),
    });
  },
};
