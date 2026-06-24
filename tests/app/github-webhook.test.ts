// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import request from 'supertest';

// Both sources resolve their secret from env via sources.secret_ref. Set them before the
// app/handler modules read them.
const GH_SECRET = 'gh-integration-secret';
const CU_SECRET = 'cu-integration-secret';
process.env.GITHUB_WEBHOOK_SECRET = GH_SECRET;
process.env.CLICKUP_WEBHOOK_SECRET = CU_SECRET;

import { createApp } from '../../src/server.js';
import { setContext } from '../../src/core/context.js';
import '../../src/sources/index.js'; // register clickup + github adapters
import type { Repository } from '../../src/db/repository.js';
import type { RouteRecord, DeliveryTarget } from '../../src/routing/types.js';
import type { DeliveryService } from '../../src/discord/delivery.js';

const distIndex = fileURLToPath(new URL('../../dist/index.html', import.meta.url));

beforeAll(() => {
  if (!existsSync(distIndex)) {
    execFileSync('node', ['scripts/build.mjs'], { stdio: 'ignore' });
  }
});

// Fakes: route both sources to a webhook target; no real DB/Discord.
class FakeRepo implements Repository {
  async getSourceRecord(slug: string) {
    if (slug === 'github') return { slug, enabled: true, secretRef: 'github_webhook_secret' };
    if (slug === 'clickup') return { slug, enabled: true, secretRef: 'clickup_webhook_secret' };
    return null;
  }
  async findEnabledRoutes(): Promise<RouteRecord[]> {
    return [];
  }
  async getTarget(id: string): Promise<DeliveryTarget | null> {
    return { id, mode: 'webhook', webhookUrlRef: 'demo' };
  }
  async alreadyDelivered(): Promise<boolean> {
    return false;
  }
  async recordDelivery(): Promise<void> {}
  async ping(): Promise<boolean> {
    return true;
  }
  async close(): Promise<void> {}
}
class FakeDelivery implements DeliveryService {
  async send(): Promise<void> {}
}

function ghSign(body: string): string {
  return 'sha256=' + createHmac('sha256', GH_SECRET).update(Buffer.from(body)).digest('hex');
}
function cuSign(body: string): string {
  return createHmac('sha256', CU_SECRET).update(Buffer.from(body)).digest('hex');
}

const prBody = JSON.stringify({
  action: 'opened',
  pull_request: { number: 1, title: 'x', html_url: 'u' },
});

describe('POST /webhooks/github', () => {
  beforeEach(() => setContext({ repo: new FakeRepo(), delivery: new FakeDelivery() }));

  it('accepts (202) a verified pull_request event', async () => {
    const res = await request(createApp())
      .post('/webhooks/github')
      .set('content-type', 'application/json')
      .set('x-github-event', 'pull_request')
      .set('x-github-delivery', 'g1')
      .set('x-hub-signature-256', ghSign(prBody))
      .send(prBody);
    expect(res.status).toBe(202);
  });

  it('rejects (401) a bad signature', async () => {
    const res = await request(createApp())
      .post('/webhooks/github')
      .set('content-type', 'application/json')
      .set('x-github-event', 'pull_request')
      .set('x-hub-signature-256', 'sha256=deadbeef')
      .send(prBody);
    expect(res.status).toBe(401);
  });

  it('accepts (202) a verified ping with no message', async () => {
    const body = JSON.stringify({ zen: 'hi' });
    const res = await request(createApp())
      .post('/webhooks/github')
      .set('content-type', 'application/json')
      .set('x-github-event', 'ping')
      .set('x-hub-signature-256', ghSign(body))
      .send(body);
    expect(res.status).toBe(202);
  });

  it('source isolation: ClickUp still verifies + accepts with GitHub registered', async () => {
    const cuBody = JSON.stringify({ event: 'taskStatusUpdated', task_id: 't' });
    const res = await request(createApp())
      .post('/webhooks/clickup')
      .set('content-type', 'application/json')
      .set('x-signature', cuSign(cuBody))
      .send(cuBody);
    expect(res.status).toBe(202);
  });
});
