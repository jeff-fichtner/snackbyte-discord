/** Transform contract: turn a canonical event (+ per-route config) into a Discord message. */
import type { CanonicalEvent } from '../../sources/types.js';
import type { DiscordMessage } from '../../discord/delivery.js';

export type Transform = (event: CanonicalEvent, config: Record<string, unknown>) => DiscordMessage;
