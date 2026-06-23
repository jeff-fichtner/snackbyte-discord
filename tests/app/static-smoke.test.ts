// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { createApp } from '../../src/server.js';

// Smoke test for a static app: the built frontend is served and there is no API —
// any /api request falls through to the SPA HTML.
const distIndex = fileURLToPath(new URL('../../dist/index.html', import.meta.url));

beforeAll(() => {
  if (!existsSync(distIndex)) {
    execFileSync('node', ['scripts/build.mjs'], { stdio: 'ignore' });
  }
});

describe('app serves', () => {
  it('serves the built frontend', async () => {
    const res = await request(createApp()).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<div id="root"');
  });

  it('has no API — /api falls through to the SPA HTML', async () => {
    const res = await request(createApp()).get('/api/anything');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('<div id="root"');
  });
});
