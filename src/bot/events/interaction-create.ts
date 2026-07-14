/**
 * interactionCreate — the dispatcher for interactions. Forks by interaction kind: chat-input
 * commands route into the command registry; message components (buttons / select menus) route into
 * the component registry by customId. Both paths contain handler failures — a throwing handler never
 * disconnects the bot; the invoking member gets an ephemeral error reply instead.
 */
import { Events, MessageFlags, type Interaction } from 'discord.js';
import { getCommand } from '../commands/registry.js';
import { dispatchComponent } from '../components/registry.js';
import { childLogger } from '../../core/logger.js';
import type { EventHandler } from './types.js';

const log = childLogger('bot-interaction');

export const interactionCreate: EventHandler<Events.InteractionCreate> = {
  event: Events.InteractionCreate,
  async handle(interaction: Interaction) {
    // Component interactions (buttons / select menus) — the component style.
    if (interaction.isMessageComponent()) {
      await dispatchComponent(interaction);
      return;
    }

    // Chat-input slash commands.
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
