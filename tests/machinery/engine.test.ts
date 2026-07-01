// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { dispatch } from '../../src/routing/engine.js';
import type { Repository, DeliveryRecordInput } from '../../src/db/repository.js';
import type { RouteRecord, DeliveryTarget } from '../../src/routing/types.js';
import type { DeliveryService, DiscordMessage } from '../../src/discord/delivery.js';
import type { CanonicalEvent } from '../../src/sources/types.js';

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

function makeRoute(id: string, targetId = 't1'): RouteRecord {
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
  delivered = new Set<string>(); // routeId:dedupeKey that are "ok"
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
  async listSelfAssignableRoles(): Promise<string[]> {
    return [];
  }
  async ping(): Promise<boolean> {
    return true;
  }
  async close(): Promise<void> {}
}

class FakeDelivery implements DeliveryService {
  sent: { target: DeliveryTarget; msg: DiscordMessage }[] = [];
  failOnTarget?: string;
  async send(target: DeliveryTarget, msg: DiscordMessage): Promise<void> {
    if (this.failOnTarget && target.id === this.failOnTarget) {
      throw new Error('simulated delivery failure');
    }
    this.sent.push({ target, msg });
  }
}

const webhookTarget = (id: string): DeliveryTarget => ({
  id,
  mode: 'webhook',
  webhookUrlRef: 'demo',
});

describe('routing engine', () => {
  let repo: FakeRepo;
  let delivery: FakeDelivery;

  beforeEach(() => {
    repo = new FakeRepo();
    delivery = new FakeDelivery();
  });

  it('delivers to a single matching route and records ok', async () => {
    repo.routes = [makeRoute('r1')];
    repo.targets.set('t1', webhookTarget('t1'));
    const result = await dispatch(makeEvent(), { repo, delivery });
    expect(result).toMatchObject({ matched: 1, delivered: 1, skipped: 0, failed: 0 });
    expect(delivery.sent).toHaveLength(1);
    expect(repo.records.at(-1)?.status).toBe('ok');
  });

  it('fans out to all matching routes independently', async () => {
    repo.routes = [makeRoute('r1', 't1'), makeRoute('r2', 't2')];
    repo.targets.set('t1', webhookTarget('t1'));
    repo.targets.set('t2', webhookTarget('t2'));
    const result = await dispatch(makeEvent(), { repo, delivery });
    expect(result.matched).toBe(2);
    expect(result.delivered).toBe(2);
    expect(delivery.sent).toHaveLength(2);
  });

  it('produces no delivery when no route matches', async () => {
    repo.routes = [];
    const result = await dispatch(makeEvent(), { repo, delivery });
    expect(result).toMatchObject({ matched: 0, delivered: 0 });
    expect(delivery.sent).toHaveLength(0);
  });

  it('skips (does not re-send) a duplicate already-delivered event', async () => {
    repo.routes = [makeRoute('r1')];
    repo.targets.set('t1', webhookTarget('t1'));
    repo.delivered.add('r1:dk-1');
    const result = await dispatch(makeEvent(), { repo, delivery });
    expect(result).toMatchObject({ matched: 1, delivered: 0, skipped: 1 });
    expect(delivery.sent).toHaveLength(0);
    expect(repo.records.at(-1)?.status).toBe('skipped');
  });

  it('isolates a failing route — the other route still delivers', async () => {
    repo.routes = [makeRoute('r1', 't1'), makeRoute('r2', 't2')];
    repo.targets.set('t1', webhookTarget('t1'));
    repo.targets.set('t2', webhookTarget('t2'));
    delivery.failOnTarget = 't1';
    const result = await dispatch(makeEvent(), { repo, delivery });
    expect(result.delivered).toBe(1);
    expect(result.failed).toBe(1);
    expect(delivery.sent).toHaveLength(1);
    expect(delivery.sent[0].target.id).toBe('t2');
  });

  it('records failed when the target is missing', async () => {
    repo.routes = [makeRoute('r1', 'missing')];
    const result = await dispatch(makeEvent(), { repo, delivery });
    expect(result.failed).toBe(1);
    expect(repo.records.at(-1)).toMatchObject({ status: 'failed' });
  });
});
