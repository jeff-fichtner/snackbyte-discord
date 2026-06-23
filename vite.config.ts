/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
// SPINUP:server-only:start
import { PORT } from './src/config';
// SPINUP:server-only:end

const webRoot = fileURLToPath(new URL('./src/web', import.meta.url));
const distDir = fileURLToPath(new URL('./dist', import.meta.url));

// Version constants baked into the frontend bundle at build time (so server-render and
// client-hydration see identical values — no live values, no hydration mismatch). The version
// is NOT read from package.json (which holds only MAJOR.MINOR); it arrives as the APP_VERSION
// build-arg the deploy flow sets, alongside CI + BUILD_GIT_COMMIT + BUILD_DATE. Locally they
// fall back to dev. Chip visibility is keyed on APP_IS_PRODUCTION, NOT NODE_ENV (the build
// always runs NODE_ENV=production): default 'true' hides the chip (prod); staging passes
// 'false'. scripts/prerender.mjs MUST read these identically or prerender and hydration disagree.
const isBuildServer = process.env.CI === 'true';
const versionDefines = {
  'globalThis.__APP_VERSION__': JSON.stringify(
    isBuildServer ? (process.env.APP_VERSION ?? '0.0.0') : '0.0.0-dev',
  ),
  'globalThis.__GIT_COMMIT__': JSON.stringify(process.env.BUILD_GIT_COMMIT ?? 'dev'),
  'globalThis.__BUILD_DATE__': JSON.stringify(process.env.BUILD_DATE ?? 'dev'),
  'globalThis.__IS_PRODUCTION__': JSON.stringify(
    (process.env.APP_IS_PRODUCTION ?? 'true') !== 'false',
  ),
};

export default defineConfig({
  root: webRoot,
  plugins: [react()],
  define: versionDefines,
  // SPINUP:server-only:start
  // Forward /api calls from the dev frontend to the Express API (same-origin in
  // production), so app code can call relative /api paths in both dev and prod.
  server: {
    proxy: { '/api': `http://localhost:${PORT}` },
  },
  // SPINUP:server-only:end
  build: {
    outDir: distDir,
    emptyOutDir: true,
  },
  test: {
    // jsdom by default so component tests have a DOM. Tests that need the plain Node
    // environment (e.g. server integration tests) declare `// @vitest-environment node`
    // at the top of the file.
    environment: 'jsdom',
    include: ['tests/machinery/**/*.test.ts', 'tests/machinery/**/*.test.tsx'],
    root: fileURLToPath(new URL('.', import.meta.url)),
    globals: true,
    // Integration tests build into the shared dist/ and bind fixed ports, so test
    // files must run serially rather than in parallel.
    fileParallelism: false,
  },
});
