/** Gateway event-handler contract. A handler names an event and how to handle it. */
import type { ClientEvents } from 'discord.js';

export interface EventHandler<K extends keyof ClientEvents = keyof ClientEvents> {
  event: K;
  once?: boolean;
  handle(...args: ClientEvents[K]): Promise<void> | void;
}
