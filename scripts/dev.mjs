/**
 * Dev runner. Starts the Vite dev server for the frontend. In server mode it also
 * starts the Express API (via tsx) alongside it.
 */
import './load-env.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const binDir = fileURLToPath(new URL('../node_modules/.bin/', import.meta.url));
/** Resolves a locally-installed CLI binary (Windows uses the .cmd shim). */
const bin = (name) => `${binDir}${name}${process.platform === 'win32' ? '.cmd' : ''}`;

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];

function run(command, args) {
  const child = spawn(command, args, { stdio: 'inherit', shell: false });
  child.on('exit', (code) => {
    for (const other of children) {
      if (other !== child) other.kill();
    }
    process.exit(code ?? 0);
  });
  children.push(child);
  return child;
}

run(bin('vite'), []);

run(bin('tsx'), ['watch', 'src/main.ts']);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const child of children) child.kill();
    process.exit(0);
  });
}
