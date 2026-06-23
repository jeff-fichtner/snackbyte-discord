/**
 * Event-handler registry. Handlers self-register; bindHandlers attaches them all to the
 * client at login. Each handler is wrapped so a throw is contained — one failing handler
 * never disconnects the gateway or stops the others.
 */
import type { Client } from 'discord.js';
import { childLogger } from '../../core/logger.js';
import type { EventHandler } from './types.js';

const log = childLogger('bot-events');
const handlers: EventHandler[] = [];

export function registerEvent(handler: EventHandler): void {
  handlers.push(handler);
}

export function allEvents(): EventHandler[] {
  return [...handlers];
}

/** Attach every registered handler to the client, with per-handler error containment. */
export function bindHandlers(client: Client): void {
  for (const handler of handlers) {
    const wrapped = async (...args: unknown[]): Promise<void> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- args are the event's tuple; the registry is event-generic.
        await handler.handle(...(args as any));
      } catch (err) {
        log.error(
          { event: handler.event, err: err instanceof Error ? err.message : String(err) },
          'event handler failed',
        );
      }
    };
    if (handler.once) client.once(handler.event, wrapped);
    else client.on(handler.event, wrapped);
  }
}
