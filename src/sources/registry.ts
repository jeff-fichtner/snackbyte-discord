/**
 * Source-adapter registry. Adapters self-register here; the HTTP layer resolves an
 * adapter by slug. Adding a source is "write an adapter + register it" — core code
 * never branches on a specific source.
 */
import type { SourceAdapter } from './types.js';

const adapters = new Map<string, SourceAdapter>();

export function registerSource(adapter: SourceAdapter): void {
  adapters.set(adapter.slug, adapter);
}

export function getSource(slug: string): SourceAdapter | undefined {
  return adapters.get(slug);
}

export function allSources(): SourceAdapter[] {
  return [...adapters.values()];
}
