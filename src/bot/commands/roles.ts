/**
 * /roles — list the roles you can self-assign in this server. Thin adapter: reads the guild's
 * whitelist, resolves the ids to live roles via the listSelfAssignableRoles capability, and replies
 * ephemerally with the names (or that none are available). Reflects the live whitelist, so an
 * operator edit shows up on the next call.
 */
import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import type { SlashCommand } from './types.js';
import { getContext } from '../../core/context.js';
import { listSelfAssignableRoles, type RoleView } from '../members/roles.js';

export const rolesCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('roles')
    .setDescription('List the roles you can give yourself.'),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.inCachedGuild()) {
      await interaction.editReply({ content: 'This command only works in a server.' });
      return;
    }

    const whitelist = (await getContext()?.repo.listSelfAssignableRoles(interaction.guildId)) ?? [];
    const liveRoles: RoleView[] = interaction.guild.roles.cache.map((r) => ({
      id: r.id,
      name: r.name,
      position: r.position,
    }));
    const assignable = listSelfAssignableRoles(liveRoles, whitelist);

    const content =
      assignable.length === 0
        ? 'No roles are currently self-assignable.'
        : `Self-assignable roles:\n${assignable.map((r) => `• ${r.name}`).join('\n')}`;
    await interaction.editReply({ content });
  },
};
