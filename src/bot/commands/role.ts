/**
 * /role — manage a role. With no `member` (or yourself) it toggles a self-ASSIGNABLE role on
 * yourself (the whitelist-gated self-service path). With a different `member` it toggles the role on
 * THAT member — the moderation path, NOT whitelist-bound — gated by the invoker's native Manage
 * Roles permission plus the bot-position and invoker-position (escalation) guards. Thin adapter: maps
 * the live interaction onto the toggleSelfRole / setMemberRole capability and renders it ephemerally.
 */
import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type GuildMember,
  type Role,
} from 'discord.js';
import type { SlashCommand } from './types.js';
import { getContext } from '../../core/context.js';
import { toggleSelfRole, setMemberRole, type RoleView } from '../members/roles.js';
import { roleMemberView } from '../members/member-view.js';
import { isModerator } from '../moderation/standing.js';

function roleView(role: Role): RoleView {
  return { id: role.id, name: role.name, position: role.position };
}

export const roleCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Give yourself a self-assignable role, or (moderators) manage a member’s role.')
    .addRoleOption((opt) =>
      opt.setName('role').setDescription('The role to toggle.').setRequired(true),
    )
    .addUserOption((opt) =>
      opt
        .setName('member')
        .setDescription('Whose role to change (moderators only; defaults to yourself).')
        .setRequired(false),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const invoker = interaction.member;
    if (!interaction.inCachedGuild() || !invoker || !('roles' in invoker)) {
      await interaction.editReply({ content: 'This command only works in a server.' });
      return;
    }
    const role = interaction.options.getRole('role', true) as Role;
    const targetUser = interaction.options.getUser('member');
    const invokerMember = invoker as GuildMember;

    // Self path: no member, or the invoker named themselves. Unchanged 004 whitelist-gated behavior.
    const isSelf = !targetUser || targetUser.id === invokerMember.id;
    if (isSelf) {
      const whitelist =
        (await getContext()?.repo.listSelfAssignableRoles(interaction.guildId!)) ?? [];
      const result = await toggleSelfRole(roleMemberView(invokerMember), roleView(role), whitelist);
      await interaction.editReply({ content: selfMessage(result, role.name) });
      return;
    }

    // Cross-member path: requires the native Manage Roles permission.
    if (!isModerator(invokerMember.permissions, 'role')) {
      await interaction.editReply({ content: 'You can only manage your own roles.' });
      return;
    }
    const target = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!target) {
      await interaction.editReply({ content: "That member isn't in this server." });
      return;
    }
    const result = await setMemberRole(roleMemberView(target), roleView(role), {
      invokerHighestPosition: invokerMember.roles.highest.position,
    });
    await interaction.editReply({
      content: memberMessage(result, role.name, target.toString()),
    });
  },
};

function selfMessage(result: Awaited<ReturnType<typeof toggleSelfRole>>, roleName: string): string {
  switch (result.outcome) {
    case 'added':
      return `Added the **${roleName}** role.`;
    case 'removed':
      return `Removed the **${roleName}** role.`;
    case 'unchanged':
      return `No change to the **${roleName}** role.`;
    default:
      return result.reason === 'not-whitelisted'
        ? `**${roleName}** isn't self-assignable.`
        : result.reason === 'bot-cannot-manage'
          ? `I can't manage **${roleName}** — it's above my own role, or I'm missing the Manage Roles permission.`
          : `That role couldn't be changed (it may no longer exist).`;
  }
}

function memberMessage(
  result: Awaited<ReturnType<typeof setMemberRole>>,
  roleName: string,
  mention: string,
): string {
  switch (result.outcome) {
    case 'added':
      return `Added **${roleName}** to ${mention}.`;
    case 'removed':
      return `Removed **${roleName}** from ${mention}.`;
    default:
      return result.reason === 'invoker-outranked'
        ? `You can't assign **${roleName}** — it's at or above your own highest role.`
        : result.reason === 'bot-cannot-manage'
          ? `I can't manage **${roleName}** — it's above my own role, or I'm missing the Manage Roles permission.`
          : `That role couldn't be changed (it may no longer exist).`;
  }
}
