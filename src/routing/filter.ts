/**
 * Per-route event filtering. A route's config may carry an `excludeSubtypes` list; if the
 * event's normalized `data.subtype` is in that list, the route suppresses the event (the
 * engine records it as `filtered` and delivers nothing). Matching is on the single
 * `data.subtype` field the adapter writes — not a scan of all data — so the recognized
 * vocabulary is exactly what adapters emit as `subtype`.
 *
 * Source-agnostic: this applies to any source's events, keyed only off config + data.
 */
import type { CanonicalEvent } from '../sources/types.js';

/** True if the event should be delivered for this route; false if its subtype is excluded. */
export function passesFilter(event: CanonicalEvent, config: Record<string, unknown>): boolean {
  const exclude = config.excludeSubtypes;
  if (!Array.isArray(exclude) || exclude.length === 0) return true;
  const subtype = event.data?.subtype;
  if (typeof subtype !== 'string') return true; // no subtype → nothing to exclude
  return !exclude.includes(subtype);
}
