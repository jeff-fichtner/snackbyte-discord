// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { dispatch } from '../../src/routing/engine.js';
import type { Repository, DeliveryRecordInput } from '../../src/db/repository.js';
import type { RouteRecord, DeliveryTarget } from '../../src/routing/types.js';
import type { DeliveryService, DiscordMessage } from '../../src/discord/delivery.js';
import type { CanonicalEvent } from '../../src/sources/types.js';

// Proves the engine treats bot-mode and webhook-mode targets identically: it fans out to both,
// records each outcome independently, and dedups bot-mode deliveries — all without the engine
// knowing the delivery mechanism (it never reads target.mode).

function makeEvent(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    source: 'clickup',
    eventType: 'taskStatusUpdated',
    dedupeKey: 'dk-1',
    occurredAt: new Date(0).toISOString(),
    title: 'test',
    data: {},
    raw: {},
    ...overrides,
  };
}

function makeRoute(id: string, targetId: string): RouteRecord {
  return {
    id,
    source: 'clickup',
    eventType: 'taskStatusUpdated',
    targetId,
    transform: null,
    config: {},
    enabled: true,
    priority: 0,
  };
}

class FakeRepo implements Repository {
  routes: RouteRecord[] = [];
  targets = new Map<string, DeliveryTarget>();
  delivered = new Set<string>();
  records: DeliveryRecordInput[] = [];

  async getSourceRecord() {
    return { slug: 'clickup', enabled: true, secretRef: 'clickup_webhook_secret' };
  }
  async findEnabledRoutes(): Promise<RouteRecord[]> {
    return this.routes;
  }
  async getTarget(id: string): Promise<DeliveryTarget | null> {
    return this.targets.get(id) ?? null;
  }
  async alreadyDelivered(routeId: string, dedupeKey: string): Promise<boolean> {
    return this.delivered.has(`${routeId}:${dedupeKey}`);
  }
  async recordDelivery(input: DeliveryRecordInput): Promise<void> {
    this.records.push(input);
    if (input.status === 'ok') this.delivered.add(`${input.routeId}:${input.dedupeKey}`);
  }
  async ping(): Promise<boolean> {
    return true;
  }
  async close(): Promise<void> {}
}

class FakeDelivery implements DeliveryService {
  sent: { target: DeliveryTarget; msg: DiscordMessage }[] = [];
  failOnTarget?: string;
  failReason = 'bot delivery failed: missing permission';
  async send(target: DeliveryTarget, msg: DiscordMessage): Promise<void> {
    if (this.failOnTarget && target.id === this.failOnTarget) {
      throw new Error(this.failReason);
    }
    this.sent.push({ target, msg });
  }
}

const botTarget: DeliveryTarget = { id: 'bt', mode: 'bot', channelId: '900', guildId: '500' };
const webhookTarget: DeliveryTarget = { id: 'wt', mode: 'webhook', webhookUrlRef: 'demo' };

describe('engine — bot + webhook dual-mode fan-out and idempotency', () => {
  let repo: FakeRepo;
  let delivery: FakeDelivery;

  beforeEach(() => {
    repo = new FakeRepo();
    delivery = new FakeDelivery();
    repo.targets.set('bt', botTarget);
    repo.targets.set('wt', webhookTarget);
  });

  it('one event matching a bot route and a webhook route delivers to both, each recorded ok', async () => {
    repo.routes = [makeRoute('r-bot', 'bt'), makeRoute('r-web', 'wt')];

    const result = await dispatch(makeEvent(), { repo, delivery });

    expect(result.matched).toBe(2);
    expect(result.delivered).toBe(2);
    expect(delivery.sent.map((s) => s.target.id).sort()).toEqual(['bt', 'wt']);
    const ok = repo.records
      .filter((r) => r.status === 'ok')
      .map((r) => r.routeId)
      .sort();
    expect(ok).toEqual(['r-bot', 'r-web']);
  });

  it('a duplicate event to the bot route posts once and records the second as skipped', async () => {
    repo.routes = [makeRoute('r-bot', 'bt')];

    await dispatch(makeEvent(), { repo, delivery });
    await dispatch(makeEvent(), { repo, delivery }); // same dedupeKey

    expect(delivery.sent).toHaveLength(1); // posted once
    const statuses = repo.records.map((r) => r.status);
    expect(statuses).toContain('ok');
    expect(statuses).toContain('skipped');
  });

  it('a failing bot route records failed (with reason) but does not block another route, and dispatch resolves', async () => {
    repo.routes = [makeRoute('r-bot', 'bt'), makeRoute('r-web', 'wt')];
    delivery.failOnTarget = 'bt';

    // dispatch must resolve (no throw) so the inbound provider still gets its ack.
    const result = await dispatch(makeEvent(), { repo, delivery });

    expect(result.failed).toBe(1);
    expect(result.delivered).toBe(1);
    expect(delivery.sent.map((s) => s.target.id)).toEqual(['wt']); // the other route still delivered
    const botRecord = repo.records.find((r) => r.routeId === 'r-bot');
    expect(botRecord?.status).toBe('failed');
    expect(botRecord?.error).toContain('missing permission'); // diagnosable reason recorded
    expect(repo.records.find((r) => r.routeId === 'r-web')?.status).toBe('ok');
  });
});
