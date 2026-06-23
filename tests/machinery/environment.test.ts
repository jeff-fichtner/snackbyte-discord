// @vitest-environment node
//
// Proves the staging-vs-production runtime distinction the template guarantees:
//   - /api/version reports `environment` from APP_ENV (falling back to NODE_ENV), so a staging
//     deploy can label itself via APP_ENV=staging WITHOUT flipping NODE_ENV — which would break
//     the version number (the build/version gate keys on NODE_ENV=production).
//   - a non-production response carries `X-Robots-Tag: noindex` (so staging isn't search-indexed);
//     production emits no such header.
import { describe, it, expect, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server.js';

// version.ts reads process.env at import time, so re-import it fresh under each env to observe
// the value it computes.
async function freshVersion() {
  vi.resetModules();
  return (await import('../../src/version.js')).version;
}

const ORIGINAL = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.resetModules();
});

describe('environment label (version.ts)', () => {
  it('reports "staging" from APP_ENV while NODE_ENV stays production (real number preserved)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_ENV = 'staging';
    process.env.APP_VERSION = '0.1.2-dev';
    const v = await freshVersion();
    expect(v.environment).toBe('staging');
    // NODE_ENV=production keeps the build gate on, so the real number is read — never 0.0.0-dev.
    expect(v.number).toBe('0.1.2-dev');
  });

  it('reports "production" when APP_ENV is unset', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.APP_ENV;
    process.env.APP_VERSION = '0.1.2';
    const v = await freshVersion();
    expect(v.environment).toBe('production');
    expect(v.number).toBe('0.1.2');
  });

  it('falls back to "development" with neither set', async () => {
    delete process.env.NODE_ENV;
    delete process.env.APP_ENV;
    const v = await freshVersion();
    expect(v.environment).toBe('development');
  });
});

describe('noindex middleware (server.ts)', () => {
  it('emits X-Robots-Tag: noindex when APP_ENV=staging', async () => {
    process.env.APP_ENV = 'staging';
    const res = await request(createApp()).get('/');
    expect(res.headers['x-robots-tag']).toBe('noindex');
  });

  it('emits no X-Robots-Tag in production (APP_ENV unset)', async () => {
    delete process.env.APP_ENV;
    const res = await request(createApp()).get('/');
    expect(res.headers['x-robots-tag']).toBeUndefined();
  });
});
