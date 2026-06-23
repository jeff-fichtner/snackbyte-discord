// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { createApp } from '../../src/server.js';
import { setDbReachable, setGatewayConnected } from '../../src/core/lifecycle.js';

const distIndex = fileURLToPath(new URL('../../dist/index.html', import.meta.url));

beforeAll(() => {
  if (!existsSync(distIndex)) {
    execFileSync('node', ['scripts/build.mjs'], { stdio: 'ignore' });
  }
});

describe('liveness vs readiness', () => {
  it('liveness stays 200 even when dependencies are down', async () => {
    setDbReachable(false);
    setGatewayConnected(false);
    const res = await request(createApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
  });

  it('readiness is 503 and names the failing dependency when something is down', async () => {
    setDbReachable(false);
    setGatewayConnected(true);
    const res = await request(createApp()).get('/api/ready');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ ready: false, checks: { db: 'down', gateway: 'ok' } });
  });

  it('readiness is 200 when all dependencies are up', async () => {
    setDbReachable(true);
    setGatewayConnected(true);
    const res = await request(createApp()).get('/api/ready');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ready: true });
  });
});
