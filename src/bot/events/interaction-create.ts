/**
 * interactionCreate — the single dispatcher for slash commands. Routes by command name
 * into the command registry and contains handler failures: a throwing command never
 * disconnects the bot; the invoking member gets an ephemeral error reply instead.
 */
import { Events, MessageFlags, type Interaction } from 'discord.js';
import { getCommand } from '../commands/registry.js';
import { childLogger } from '../../core/logger.js';
import type { EventHandler } from './types.js';

const log = childLogger('bot-interaction');

export const interactionCreate: EventHandler<Events.InteractionCreate> = {
  event: Events.InteractionCreate,
  async handle(interaction: Interaction) {
    if (!interaction.isChatInputCommand()) return;
    const command = getCommand(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction);
    } catch (err) {
      log.error(
        { command: interaction.commandName, err: err instanceof Error ? err.message : String(err) },
        'command execute failed',
      );
      const content = 'Something went wrong running that command.';
      if (interaction.replied || interaction.deferred) {
        await interaction
          .followUp({ content, flags: MessageFlags.Ephemeral })
          .catch(() => undefined);
      } else {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
      }
    }
  },
};
