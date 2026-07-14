// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseDuration } from '../../src/bot/commands/moderation-adapter.js';

// parseDuration turns a human duration into ms for the timeout command; unparseable → null.

describe('parseDuration', () => {
  it('parses units s/m/h/d', () => {
    expect(parseDuration('30s')).toBe(30_000);
    expect(parseDuration('10m')).toBe(600_000);
    expect(parseDuration('2h')).toBe(7_200_000);
    expect(parseDuration('7d')).toBe(604_800_000);
  });

  it('treats a bare number as minutes', () => {
    expect(parseDuration('5')).toBe(300_000);
  });

  it('treats 0 as clear (zero ms)', () => {
    expect(parseDuration('0')).toBe(0);
  });

  it('tolerates whitespace and case', () => {
    expect(parseDuration('  10M ')).toBe(600_000);
  });

  it('returns null for garbage', () => {
    expect(parseDuration('soon')).toBeNull();
    expect(parseDuration('10x')).toBeNull();
    expect(parseDuration('')).toBeNull();
  });
});
