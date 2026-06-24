/**
 * Named transform for GitHub events: renders PR / issue / push canonical events into a
 * Discord embed, reading GitHub specifics from `event.data` (keeps the shared CanonicalEvent
 * lean). Per-route presentation (role mentions, accent color) comes from the route's config
 * via the shared format helpers — so one transform serves many routes by config alone.
 *
 * A route selects this by setting `transform = 'github'`; null/unknown falls back to default.
 */
import type { Transform } from './types.js';
import { mentionPrefix, accentColor } from './format-config.js';

export const githubTransform: Transform = (event, config) => {
  const embed: Record<string, unknown> = {
    title: event.title,
    url: event.url,
    timestamp: event.occurredAt,
  };

  const color = accentColor(config);
  if (color !== undefined) embed.color = color;

  if (event.actor?.displayName) {
    embed.author = { name: event.actor.displayName, icon_url: event.actor.avatarUrl };
  }

  const message: { content?: string; embeds: unknown[] } = { embeds: [embed] };
  const mention = mentionPrefix(config);
  if (mention) message.content = mention;

  return message;
};
