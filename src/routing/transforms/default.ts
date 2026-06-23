/**
 * Default transform: renders any canonical event as a simple Discord embed using only
 * source-agnostic fields (title + link + actor). Serves every route that does not name
 * a more specific transform.
 */
import type { Transform } from './types.js';

export const defaultTransform: Transform = (event) => {
  const embed: Record<string, unknown> = {
    title: event.title,
    url: event.url,
    timestamp: event.occurredAt,
  };
  if (event.actor?.displayName) {
    embed.author = { name: event.actor.displayName, icon_url: event.actor.avatarUrl };
  }
  return { embeds: [embed] };
};
