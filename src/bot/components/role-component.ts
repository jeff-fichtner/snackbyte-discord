/**
 * The role-component handler: a member clicks a button (or picks a select option) bound to a
 * self-assignable role, and the role is toggled — the same outcome as the slash and reaction styles,
 * over the unchanged toggleSelfRole capability and the same whitelist gate.
 *
 * Component key: a button's customId, or a select's customId plus the chosen option value (so each
 * option is an independently bindable component). Operators name their components with the "role:"
 * prefix so this handler claims them.
 */
import {
  MessageFlags,
  PermissionFlagsBits,
  type MessageComponentInteraction,
  type GuildMember,
} from 'discord.js';
import { getContext } from '../../core/context.js';
import { resolveComponentRole } from './resolve.js';
import { toggleSelfRole, type MemberView, type RoleView } from '../members/roles.js';
import type { ComponentHandler } from './registry.js';

const PREFIX = 'role:';

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

/** The stable component key: for a select, customId + the chosen value; for a button, the customId. */
function componentKey(interaction: MessageComponentInteraction): string {
  if (interaction.isStringSelectMenu()) {
    return `${interaction.customId}::${interaction.values[0] ?? ''}`;
  }
  return interaction.customId;
}

export const roleComponent: ComponentHandler = {
  prefix: PREFIX,
  async handle(interaction: MessageComponentInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.inCachedGuild() || !interaction.member || !('roles' in interaction.member)) {
      await interaction.editReply({ content: 'This only works in a server.' });
      return;
    }
    const member = interaction.member as GuildMember;
    const ctx = getContext();
    if (!ctx) {
      await interaction.editReply({ content: 'Not ready — try again shortly.' });
      return;
    }

    const [bindings, whitelistRoleIds] = await Promise.all([
      ctx.repo.listComponentRoleBindings(interaction.guildId),
      ctx.repo.listSelfAssignableRoles(interaction.guildId),
    ]);
    const roleId = resolveComponentRole({
      bindings,
      whitelistRoleIds,
      componentKey: componentKey(interaction),
    });
    if (!roleId) {
      await interaction.editReply({ content: "That option isn't available." });
      return;
    }
    const role = interaction.guild.roles.cache.get(roleId);
    if (!role) {
      await interaction.editReply({ content: 'That role no longer exists.' });
      return;
    }

    const roleView: RoleView = { id: role.id, name: role.name, position: role.position };
    const result = await toggleSelfRole(memberView(member), roleView, whitelistRoleIds);

    let content: string;
    switch (result.outcome) {
      case 'added':
        content = `Added the **${role.name}** role.`;
        break;
      case 'removed':
        content = `Removed the **${role.name}** role.`;
        break;
      case 'unchanged':
        content = `No change to the **${role.name}** role.`;
        break;
      default:
        content =
          result.reason === 'not-whitelisted'
            ? `**${role.name}** isn't self-assignable.`
            : result.reason === 'bot-cannot-manage'
              ? `I can't manage **${role.name}** — it's above my role, or I'm missing the permission.`
              : `That role couldn't be changed.`;
    }
    await interaction.editReply({ content });
  },
};
