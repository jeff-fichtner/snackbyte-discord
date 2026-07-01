// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import request from 'supertest';

// The ClickUp adapter resolves its secret from CLICKUP_WEBHOOK_SECRET; set it before
// the app/handler modules read it.
const SECRET = 'integration-secret';
process.env.CLICKUP_WEBHOOK_SECRET = SECRET;

import { createApp } from '../../src/server.js';
import { setContext } from '../../src/core/context.js';
import '../../src/sources/index.js'; // register the clickup adapter
import type { Repository } from '../../src/db/repository.js';
import type { RouteRecord, DeliveryTarget } from '../../src/routing/types.js';
import type { DeliveryService } from '../../src/discord/delivery.js';

const distIndex = fileURLToPath(new URL('../../dist/index.html', import.meta.url));

beforeAll(() => {
  if (!existsSync(distIndex)) {
    execFileSync('node', ['scripts/build.mjs'], { stdio: 'ignore' });
  }
});

// Minimal fakes so the route can dispatch without a real DB/Discord.
class FakeRepo implements Repository {
  routes: RouteRecord[] = [];
  async getSourceRecord(slug: string) {
    // The clickup source is registered, enabled, and its secret_ref names the env var
    // the test sets (CLICKUP_WEBHOOK_SECRET).
    if (slug === 'clickup') {
      return { slug, enabled: true, secretRef: 'clickup_webhook_secret' };
    }
    return null;
  }
  async findEnabledRoutes(): Promise<RouteRecord[]> {
    return this.routes;
  }
  async getTarget(id: string): Promise<DeliveryTarget | null> {
    return { id, mode: 'webhook', webhookUrlRef: 'demo' };
  }
  async alreadyDelivered(): Promise<boolean> {
    return false;
  }
  async recordDelivery(): Promise<void> {}
  async listSelfAssignableRoles(): Promise<string[]> {
    return [];
  }
  async ping(): Promise<boolean> {
    return true;
  }
  async close(): Promise<void> {}
}
class FakeDelivery implements DeliveryService {
  async send(): Promise<void> {}
}

function sign(body: string): string {
  return createHmac('sha256', SECRET).update(Buffer.from(body)).digest('hex');
}

const validBody = JSON.stringify({
  event: 'taskStatusUpdated',
  task_id: 'abc',
  webhook_id: 'w',
  history_items: [{ id: 'h' }],
});

describe('POST /webhooks/:source', () => {
  beforeEach(() => {
    setContext({ repo: new FakeRepo(), delivery: new FakeDelivery() });
  });

  it('accepts (202) a verified, well-formed request', async () => {
    const res = await request(createApp())
      .post('/webhooks/clickup')
      .set('content-type', 'application/json')
      .set('x-signature', sign(validBody))
      .send(validBody);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ accepted: true });
  });

  it('rejects (401) a request with a bad signature', async () => {
    const res = await request(createApp())
      .post('/webhooks/clickup')
      .set('content-type', 'application/json')
      .set('x-signature', 'deadbeef')
      .send(validBody);
    expect(res.status).toBe(401);
  });

  it('rejects (404) an unknown source', async () => {
    const res = await request(createApp())
      .post('/webhooks/notreal')
      .set('content-type', 'application/json')
      .send('{}');
    expect(res.status).toBe(404);
  });

  it('still accepts (202) a verified event that matches no route', async () => {
    // FakeRepo returns no routes; verification still passes, so the sender is acked.
    const res = await request(createApp())
      .post('/webhooks/clickup')
      .set('content-type', 'application/json')
      .set('x-signature', sign(validBody))
      .send(validBody);
    expect(res.status).toBe(202);
  });
});
