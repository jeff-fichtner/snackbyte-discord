/**
 * Build runner. Produces a self-contained dist/ that the container runs:
 *   - frontend assets (vite build), with build-time prerendered HTML if this app prerenders
 *   - (server apps) the compiled server that serves the build and exposes the API
 */
import './load-env.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const binDir = fileURLToPath(new URL('../node_modules/.bin/', import.meta.url));
/** Resolves a locally-installed CLI binary (Windows uses the .cmd shim). */
const bin = (name) => `${binDir}${name}${process.platform === 'win32' ? '.cmd' : ''}`;

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

// Frontend build.
run(bin('vite'), ['build']);

// Compile the server that serves the build (static apps serve files; server apps
// also expose the API). Both modes ship this compiled server.
run(bin('tsc'), ['-p', 'tsconfig.build.json']);
