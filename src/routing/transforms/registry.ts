/**
 * Transform registry. A route names a transform by key; null selects the default.
 * Adding a rendering style is "write a Transform + register it"; per-route variation
 * (channel, mentions, color) lives in the route's config, so one transform serves many.
 */
import type { Transform } from './types.js';
import { defaultTransform } from './default.js';

const transforms = new Map<string, Transform>();

export function registerTransform(key: string, transform: Transform): void {
  transforms.set(key, transform);
}

export function resolveTransform(key: string | null): Transform {
  return (key && transforms.get(key)) || defaultTransform;
}
