// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  messageReactionAdd,
  messageReactionRemove,
} from '../../src/bot/events/message-reaction.js';
import { setContext } from '../../src/core/context.js';
import type { Repository } from '../../src/db/repository.js';

// The reaction event handler adapts a live reaction onto the resolver + capability. These tests use
// minimal fakes for the discord.js surface to verify the adapter-level guards that the pure
// resolver can't cover — chiefly that the bot's OWN reaction is ignored even when the reacting user
// arrives as a partial (a reaction-remove for an un-cached user, whose `.bot` is null).

const BOT_ID = 'bot-user-id';

/** A repository stub whose mapping/whitelist reads are spied so we can assert they never run. */
function repoStub(): Repository {
  return {
    listReactionRoleMappings: vi.fn(async () => [
      { messageId: 'm1', emojiKey: '🔔', roleId: 'r1' },
    ]),
    listSelfAssignableRoles: vi.fn(async () => ['r1']),
  } as unknown as Repository;
}

/** A minimal live-reaction stand-in. */
function fakeReaction(over: { partial?: boolean } = {}) {
  return {
    partial: over.partial ?? false,
    emoji: { id: null, name: '🔔' },
    client: { user: { id: BOT_ID } },
    message: { id: 'm1', guild: { id: 'g1', roles: { cache: new Map() }, members: {} } },
    fetch: vi.fn(async function (this: unknown) {
      return this;
    }),
  };
}

afterEach(() => {
  // Clear the context so one test's stub does not leak into another.
  setContext(undefined as never);
});

describe('reaction handler — ignores the bot’s own reaction (reliable even for a partial user)', () => {
  it('does not read mappings when the reactor IS the bot (partial user, .bot is null)', async () => {
    const repo = repoStub();
    setContext({ repo, delivery: {} as never });
    const reaction = fakeReaction();
    // A PartialUser for the bot on a reaction-remove: `.bot` is null, id equals the client id.
    const botPartialUser = { id: BOT_ID, bot: null, partial: true };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- feeding the fake into the handler
    await messageReactionRemove.handle(reaction as any, botPartialUser as any, {} as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await messageReactionAdd.handle(reaction as any, botPartialUser as any, {} as any);

    // The bot-self guard returns before any repository read.
    expect(repo.listReactionRoleMappings).not.toHaveBeenCalled();
    expect(repo.listSelfAssignableRoles).not.toHaveBeenCalled();
  });

  it('proceeds to read mappings for a non-bot reactor', async () => {
    const repo = repoStub();
    setContext({ repo, delivery: {} as never });
    const reaction = fakeReaction();
    const humanUser = { id: 'human-1', bot: false };

    // The member fetch will fail against the empty fake guild, ending the flow as a clean no-op —
    // but the repository reads (past the bot-self guard) must have happened, proving we did not
    // short-circuit a real user.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    reaction.message.guild.members = { fetch: vi.fn(async () => null) } as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await messageReactionAdd.handle(reaction as any, humanUser as any, {} as any);

    expect(repo.listReactionRoleMappings).toHaveBeenCalledWith('g1');
    expect(repo.listSelfAssignableRoles).toHaveBeenCalledWith('g1');
  });

  it('does nothing when there is no runtime context (e.g. before bootstrap)', async () => {
    setContext(undefined as never);
    const reaction = fakeReaction();
    const humanUser = { id: 'human-1', bot: false };
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messageReactionAdd.handle(reaction as any, humanUser as any, {} as any),
    ).resolves.toBeUndefined();
  });
});
