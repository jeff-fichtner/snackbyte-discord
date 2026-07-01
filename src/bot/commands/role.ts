/**
 * /role — toggle a self-assignable role on yourself. Thin adapter: it maps the live interaction
 * (the invoking member + the picked role + the guild's whitelist) onto the interaction-agnostic
 * toggleSelfRole capability, then renders the outcome as an ephemeral reply. Acts only on the
 * invoking member — there is no target-member option.
 */
import {
  SlashCommandBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type GuildMember,
  type Role,
} from 'discord.js';
import type { SlashCommand } from './types.js';
import { getContext } from '../../core/context.js';
import { toggleSelfRole, type MemberView, type RoleView } from '../members/roles.js';

function roleView(role: Role): RoleView {
  return { id: role.id, name: role.name, position: role.position };
}

function memberView(member: GuildMember): MemberView {
  const me = member.guild.members.me;
  return {
    hasRole: (roleId) => member.roles.cache.has(roleId),
    addRole: async (roleId) => {
      await member.roles.add(roleId);
    },
    removeRole: async (roleId) => {
      await member.roles.remove(roleId);
    },
    botHighestPosition: me?.roles.highest.position ?? 0,
    botCanManageRoles: me?.permissions.has(PermissionFlagsBits.ManageRoles) ?? false,
  };
}

export const roleCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Give yourself (or remove) a self-assignable role.')
    .addRoleOption((opt) =>
      opt.setName('role').setDescription('The role to toggle on yourself.').setRequired(true),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const member = interaction.member;
    if (!interaction.inCachedGuild() || !member || !('roles' in member)) {
      await interaction.editReply({ content: 'This command only works in a server.' });
      return;
    }
    const role = interaction.options.getRole('role', true);

    const whitelist =
      (await getContext()?.repo.listSelfAssignableRoles(interaction.guildId!)) ?? [];
    const result = await toggleSelfRole(
      memberView(member as GuildMember),
      roleView(role as Role),
      whitelist,
    );

    let content: string;
    switch (result.outcome) {
      case 'added':
        content = `Added the **${role.name}** role.`;
        break;
      case 'removed':
        content = `Removed the **${role.name}** role.`;
        break;
      default:
        content =
          result.reason === 'not-whitelisted'
            ? `**${role.name}** isn't self-assignable.`
            : result.reason === 'bot-cannot-manage'
              ? `I can't manage **${role.name}** — it's above my own role, or I'm missing the Manage Roles permission.`
              : `That role couldn't be changed (it may no longer exist).`;
    }
    await interaction.editReply({ content });
  },
};
