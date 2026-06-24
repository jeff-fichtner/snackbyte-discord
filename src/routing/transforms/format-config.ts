/**
 * Shared per-route formatting helpers, driven by a route's `config`.
 *
 * Opt-in by design: with empty/absent config these are no-ops, so a transform that adopts
 * them produces byte-identical output to its pre-config behavior (protects existing routes
 * from any regression). A transform calls these to apply operator-tunable presentation
 * (role mentions, accent color) without needing a new named transform per variation.
 */

/** Build a Discord mention prefix from `config.mentionRoleIds`; '' when none/invalid. */
export function mentionPrefix(config: Record<string, unknown>): string {
  const ids = config.mentionRoleIds;
  if (!Array.isArray(ids)) return '';
  const mentions = ids
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .map((id) => `<@&${id}>`);
  return mentions.length > 0 ? mentions.join(' ') : '';
}

/** Return `config.accentColor` when it's a valid number, else the provided fallback. */
export function accentColor(
  config: Record<string, unknown>,
  fallback?: number,
): number | undefined {
  const c = config.accentColor;
  return typeof c === 'number' && Number.isFinite(c) ? c : fallback;
}
