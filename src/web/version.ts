/**
 * Version info for the frontend (the version chip).
 *
 * Values are build-time constants. In the Vite bundle they come from `define` (see
 * vite.config.ts). If this app prerenders, the build-time render reads the same values
 * from matching globals (set from the same env), so the prerendered HTML and the client
 * hydration agree (no hydration mismatch).
 */

export interface VersionInfo {
  number: string;
  commit: string;
  buildDate: string;
  /** Show the chip everywhere except production. */
  display: boolean;
}

// These MUST be referenced as the full `globalThis.__X__` token (not via an alias) so
// that Vite's `define` textual replacement matches and inlines the build-time literals.
// `define` does exact-source-text substitution: an aliased read like `const g =
// globalThis; g.__X__` does NOT match `globalThis.__X__` and is silently left alone, so
// every constant falls through to its dev fallback in the client bundle — including
// `__IS_PRODUCTION__`, which leaves `display === true` and renders the dev chip on the
// production site. Keep the literal `globalThis.` prefix on each read below.
declare global {
  var __APP_VERSION__: string | undefined;
  var __GIT_COMMIT__: string | undefined;
  var __BUILD_DATE__: string | undefined;
  var __IS_PRODUCTION__: boolean | undefined;
}

export const version: VersionInfo = {
  number: globalThis.__APP_VERSION__ ?? '0.0.0-dev',
  commit: globalThis.__GIT_COMMIT__ ?? 'dev',
  buildDate: globalThis.__BUILD_DATE__ ?? 'dev',
  display: !(globalThis.__IS_PRODUCTION__ ?? false),
};
