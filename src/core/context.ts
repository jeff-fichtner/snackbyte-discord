/**
 * Shared application context — the services routes and the bot need at runtime.
 *
 * Set once by the bootstrap (main.ts) after the DB and delivery service are constructed.
 * Routes read it via getContext(). Kept tiny and explicit rather than threading every
 * dependency through Express; tests can set a context with fakes.
 */
import type { Repository } from '../db/repository.js';
import type { DeliveryService } from '../discord/delivery.js';

export interface AppContext {
  repo: Repository;
  delivery: DeliveryService;
}

let context: AppContext | null = null;

export function setContext(ctx: AppContext): void {
  context = ctx;
}

/** The current context, or null when the app runs without runtime services (e.g. tests). */
export function getContext(): AppContext | null {
  return context;
}
