// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseTextCommand } from '../../src/bot/text/prefix.js';

// The parser classifies a prefixed message into a role/nickname command; anything else → null.

describe('parseTextCommand', () => {
  const P = '!';

  it('parses a role toggle with a name', () => {
    expect(parseTextCommand('!role Announcements', P)).toEqual({
      kind: 'role',
      roleName: 'Announcements',
    });
  });

  it('keeps a multi-word role name intact', () => {
    expect(parseTextCommand('!role She / Her', P)).toEqual({ kind: 'role', roleName: 'She / Her' });
  });

  it('parses the roles list', () => {
    expect(parseTextCommand('!roles', P)).toEqual({ kind: 'roles' });
  });

  it('parses nick set and nick reset (no arg → undefined)', () => {
    expect(parseTextCommand('!nick Chief', P)).toEqual({ kind: 'nick', nickname: 'Chief' });
    expect(parseTextCommand('!nick', P)).toEqual({ kind: 'nick', nickname: undefined });
  });

  it('returns null for non-prefixed messages', () => {
    expect(parseTextCommand('role Announcements', P)).toBeNull();
    expect(parseTextCommand('just chatting', P)).toBeNull();
  });

  it('returns null for an unknown command or a role with no name', () => {
    expect(parseTextCommand('!ban someone', P)).toBeNull(); // sanctions are slash-only
    expect(parseTextCommand('!role', P)).toBeNull(); // role name required
    expect(parseTextCommand('!', P)).toBeNull();
  });

  it('returns null when the prefix is empty (style disabled)', () => {
    expect(parseTextCommand('!role X', '')).toBeNull();
  });

  it('tolerates extra whitespace and command case', () => {
    expect(parseTextCommand('!ROLE   Announcements  ', P)).toEqual({
      kind: 'role',
      roleName: 'Announcements',
    });
  });
});
