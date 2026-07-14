/**
 * Component-handler registry. A component handler claims a customId prefix and handles matching
 * button / select interactions. Handlers self-register; dispatchComponent routes a live interaction
 * to the first handler whose prefix matches its customId, with per-handler error containment — one
 * failing handler never disconnects the gateway or affects other components.
 *
 * Adding a component style is: write a handler module, register it here — no switch statement in the
 * dispatch core (Principle I).
 */
import { MessageFlags, type MessageComponentInteraction } from 'discord.js';
import { childLogger } from '../../core/logger.js';

const log = childLogger('bot-component');

export interface ComponentHandler {
  /** The customId prefix this handler claims (e.g. "role:", "menu:roles:"). */
  prefix: string;
  handle(interaction: MessageComponentInteraction): Promise<void>;
}

const handlers: ComponentHandler[] = [];

export function registerComponent(handler: ComponentHandler): void {
  handlers.push(handler);
}

export function allComponents(): ComponentHandler[] {
  return [...handlers];
}

/** Route a component interaction to the first handler whose prefix matches; contained failure. */
export async function dispatchComponent(interaction: MessageComponentInteraction): Promise<void> {
  const handler = handlers.find((h) => interaction.customId.startsWith(h.prefix));
  if (!handler) return; // an unclaimed component is ignored
  try {
    await handler.handle(interaction);
  } catch (err) {
    log.error(
      { customId: interaction.customId, err: err instanceof Error ? err.message : String(err) },
      'component handler failed',
    );
    const content = 'Something went wrong handling that.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
  }
}
