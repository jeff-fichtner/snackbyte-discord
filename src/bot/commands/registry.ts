/**
 * Slash-command registry. Commands self-register here; one interactionCreate listener
 * dispatches by name. Adding a command is "write a module + register it" — no central
 * switch statement enumerates commands.
 */
import type { SlashCommand } from './types.js';

const commands = new Map<string, SlashCommand>();

export function registerCommand(command: SlashCommand): void {
  commands.set(command.data.name, command);
}

export function getCommand(name: string): SlashCommand | undefined {
  return commands.get(name);
}

export function allCommands(): SlashCommand[] {
  return [...commands.values()];
}
