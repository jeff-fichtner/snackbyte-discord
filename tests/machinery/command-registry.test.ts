// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { registerCommand, getCommand, allCommands } from '../../src/bot/commands/registry.js';
import type { SlashCommand } from '../../src/bot/commands/types.js';
import { SlashCommandBuilder } from 'discord.js';

describe('command registry', () => {
  it('registers a command and finds it by name', () => {
    const cmd: SlashCommand = {
      data: new SlashCommandBuilder().setName('testcmd').setDescription('test'),
      async execute() {},
    };
    registerCommand(cmd);
    expect(getCommand('testcmd')).toBe(cmd);
    expect(allCommands().some((c) => c.data.name === 'testcmd')).toBe(true);
  });

  it('returns undefined for an unknown command', () => {
    expect(getCommand('no-such-command')).toBeUndefined();
  });

  it('includes the ping command once its module is imported', async () => {
    await import('../../src/bot/commands/index.js');
    expect(getCommand('ping')).toBeDefined();
  });
});
