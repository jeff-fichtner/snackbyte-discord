/**
 * messageCreate — the text-prefix interaction style. A no-op unless the text-prefix style is enabled
 * (a process-wide opt-in that also turns on the Message Content intent). When enabled, a prefixed
 * message runs the SAME role/nickname capability the slash command uses, through the same gate — a
 * pure input adapter over the existing capability (Principle I). Failures are quiet (no channel spam)
 * and contained; other styles are unaffected.
 */
import {
  Events,
  PermissionFlagsBits,
  MessageFlags,
  type Message,
  type GuildMember,
} from 'discord.js';
import { childLogger } from '../../core/logger.js';
import { getContext } from '../../core/context.js';
import { loadConfig } from '../../config.js';
import { parseTextCommand } from '../text/prefix.js';
import { toggleSelfRole, listSelfAssignableRoles, type RoleView } from '../members/roles.js';
import { roleMemberView } from '../members/member-view.js';
import { setOwnNickname, type NicknameMemberView } from '../members/nickname.js';
import type { EventHandler } from './types.js';

const log = childLogger('bot-text');
const { textPrefix, textPrefixEnabled } = loadConfig();

function nicknameMemberView(member: GuildMember): NicknameMemberView {
  const me = member.guild.members.me;
  const botHighest = me?.roles.highest.position ?? 0;
  return {
    setNickname: async (value) => {
      await member.setNickname(value);
    },
    botOutranksMember: botHighest > member.roles.highest.position,
    botCanManageNicknames: me?.permissions.has(PermissionFlagsBits.ManageNicknames) ?? false,
  };
}

/** Reply ephemerally-ish: a plain reply in-channel (text-prefix has no ephemeral); kept terse. */
async function respond(message: Message, content: string): Promise<void> {
  await message
    .reply({ content, flags: MessageFlags.SuppressNotifications })
    .catch(() => undefined);
}

export const messageCreate: EventHandler<Events.MessageCreate> = {
  event: Events.MessageCreate,
  async handle(message: Message) {
    // Isolation: do nothing at all unless the style is explicitly enabled.
    if (!textPrefixEnabled || !textPrefix) return;
    if (message.author.bot || !message.inGuild() || !message.member) return;

    const command = parseTextCommand(message.content, textPrefix);
    if (!command) return;

    const ctx = getContext();
    if (!ctx) return;
    const member = message.member;
    const whitelist = await ctx.repo.listSelfAssignableRoles(message.guildId);

    try {
      if (command.kind === 'roles') {
        const live = [...message.guild.roles.cache.values()].map((r) => ({
          id: r.id,
          name: r.name,
          position: r.position,
        }));
        const assignable = listSelfAssignableRoles(live, whitelist);
        await respond(
          message,
          assignable.length === 0
            ? 'No roles are currently self-assignable.'
            : `Self-assignable roles: ${assignable.map((r) => r.name).join(', ')}.`,
        );
        return;
      }

      if (command.kind === 'role') {
        const role = message.guild.roles.cache.find(
          (r) => r.name.toLowerCase() === command.roleName.toLowerCase(),
        );
        if (!role) {
          await respond(message, `No role named **${command.roleName}**.`);
          return;
        }
        const roleView: RoleView = { id: role.id, name: role.name, position: role.position };
        const result = await toggleSelfRole(roleMemberView(member), roleView, whitelist);
        await respond(
          message,
          result.outcome === 'added'
            ? `Added the **${role.name}** role.`
            : result.outcome === 'removed'
              ? `Removed the **${role.name}** role.`
              : result.outcome === 'refused' && result.reason === 'not-whitelisted'
                ? `**${role.name}** isn't self-assignable.`
                : `Couldn't change **${role.name}**.`,
        );
        return;
      }

      // command.kind === 'nick'
      const result = await setOwnNickname(nicknameMemberView(member), command.nickname);
      await respond(
        message,
        result.outcome === 'set'
          ? `Nickname set to **${command.nickname}**.`
          : result.outcome === 'cleared'
            ? 'Nickname reset.'
            : result.outcome === 'refused' && result.reason === 'invalid-input'
              ? 'That nickname is invalid (1–32 characters, not only spaces).'
              : "I couldn't change your nickname.",
      );
    } catch (err) {
      log.error(
        { guild: message.guildId, err: err instanceof Error ? err.message : String(err) },
        'text-prefix command failed',
      );
    }
  },
};
