/**
 * The one place a live discord.js GuildMember is mapped onto the role capability's MemberView. Every
 * interaction style that toggles a role — the /role command, reaction-roles, component menus, and
 * text-prefix — builds its member view here, so how the bot's position and Manage Roles permission
 * are read lives in exactly one file rather than being copied per style.
 */
import { PermissionFlagsBits, type GuildMember } from 'discord.js';
import type { MemberView } from './roles.js';

export function roleMemberView(member: GuildMember): MemberView {
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
