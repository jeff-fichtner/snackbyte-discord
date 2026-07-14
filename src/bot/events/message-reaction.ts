/**
 * messageReactionAdd / messageReactionRemove — the reaction-roles interaction style. Each handler
 * adapts a live reaction onto the pure resolver (which mapping+whitelisted role a given emoji on a
 * given message grants) and the role capability's directed grant/revoke. Reacting grants the role;
 * un-reacting removes it (the reaction is the source of truth).
 *
 * A reaction on a message the bot did not cache this session arrives partial; the emoji, message id,
 * and user are available without fetching message text (no Message Content). A null resolve, a
 * DM/non-guild reaction, or any failure is a silent, logged no-op — reactions never post to the
 * channel, and the per-handler containment in bindHandlers keeps one failure from affecting others.
 */
import {
  Events,
  type MessageReaction,
  type PartialMessageReaction,
  type User,
  type PartialUser,
} from 'discord.js';
import { childLogger } from '../../core/logger.js';
import { getContext } from '../../core/context.js';
import { resolveReactionRole } from '../reactions/resolve.js';
import { grantSelfRole, revokeSelfRole, type RoleView } from '../members/roles.js';
import { roleMemberView } from '../members/member-view.js';
import type { EventHandler } from './types.js';

const log = childLogger('bot-reaction');

/** The stable emoji identity used to match a mapping: a custom emoji's id, or the unicode char. */
function emojiKey(reaction: MessageReaction | PartialMessageReaction): string | null {
  return reaction.emoji.id ?? reaction.emoji.name ?? null;
}

function roleView(role: { id: string; name: string; position: number }): RoleView {
  return { id: role.id, name: role.name, position: role.position };
}

/**
 * Shared handling for add/remove: resolve the reaction to a role, then apply the directed action.
 * `direction` selects grant (add) or revoke (remove) — never a toggle, so a duplicate event does not
 * flip the role the other way.
 */
async function handleReaction(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  direction: 'grant' | 'revoke',
): Promise<void> {
  const ctx = getContext();
  if (!ctx) return; // no runtime services (e.g. tests) — nothing to do

  // Ignore the bot's own reactions (e.g. seeding an emoji on a mapping message). Compare against
  // the client's own id rather than user.bot — on a reaction-remove for an un-cached user, `user`
  // is a PartialUser whose `.bot` is null, so relying on `.bot` would let the bot's own un-react
  // through and strip a role from the bot itself.
  if (user.id === reaction.client.user?.id) return;

  // Hydrate a partial reaction (older/un-cached message) so guild + emoji are available.
  if (reaction.partial) {
    try {
      reaction = await reaction.fetch();
    } catch {
      return; // message gone or unreachable — clean no-op
    }
  }

  const key = emojiKey(reaction);
  const guild = reaction.message.guild;
  if (!key || !guild) return; // DM reaction or unknown emoji — ignore

  const [mappings, whitelistRoleIds] = await Promise.all([
    ctx.repo.listReactionRoleMappings(guild.id),
    ctx.repo.listSelfAssignableRoles(guild.id),
  ]);

  const roleId = resolveReactionRole({
    mappings,
    whitelistRoleIds,
    messageId: reaction.message.id,
    emojiKey: key,
    // The bot's own reactions are already filtered above by client-id (reliable even for a partial
    // user); the resolver keeps reactorIsBot as defense-in-depth for other callers.
    reactorIsBot: false,
  });
  if (!roleId) return; // unmapped or not whitelisted — silent no-op

  const role = guild.roles.cache.get(roleId);
  if (!role) return; // role deleted after mapping — clean no-op

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return; // reactor not a resolvable member — ignore

  const view = roleMemberView(member);
  const rv = roleView(role);
  const result =
    direction === 'grant'
      ? await grantSelfRole(view, rv, whitelistRoleIds)
      : await revokeSelfRole(view, rv, whitelistRoleIds);

  if (result.outcome === 'refused') {
    // Diagnosable, not posted — reactions never spam the channel (contract reaction-roles.md).
    log.warn(
      { guild: guild.id, member: member.id, role: roleId, direction, reason: result.reason },
      'reaction-role change refused',
    );
  } else {
    log.info(
      { guild: guild.id, member: member.id, role: roleId, direction, outcome: result.outcome },
      'reaction-role change',
    );
  }
}

export const messageReactionAdd: EventHandler<Events.MessageReactionAdd> = {
  event: Events.MessageReactionAdd,
  async handle(reaction, user) {
    await handleReaction(reaction, user, 'grant');
  },
};

export const messageReactionRemove: EventHandler<Events.MessageReactionRemove> = {
  event: Events.MessageReactionRemove,
  async handle(reaction, user) {
    await handleReaction(reaction, user, 'revoke');
  },
};
