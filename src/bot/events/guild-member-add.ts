/**
 * guildMemberAdd — observes a member joining, proving the bot can react to server
 * activity. This slice only logs the join (no welcome/auto-role side-effects yet).
 */
import { Events, type GuildMember } from 'discord.js';
import { childLogger } from '../../core/logger.js';
import type { EventHandler } from './types.js';

const log = childLogger('bot-member');

export const guildMemberAdd: EventHandler<Events.GuildMemberAdd> = {
  event: Events.GuildMemberAdd,
  handle(member: GuildMember) {
    log.info({ guild: member.guild.id, member: member.id }, 'member joined');
  },
};
