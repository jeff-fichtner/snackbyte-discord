// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { passesFilter } from '../../src/routing/filter.js';
import { dispatch } from '../../src/routing/engine.js';
import type { Repository, DeliveryRecordInput } from '../../src/db/repository.js';
import type { RouteRecord, DeliveryTarget } from '../../src/routing/types.js';
import type { DeliveryService, DiscordMessage } from '../../src/discord/delivery.js';
import type { CanonicalEvent } from '../../src/sources/types.js';

function event(subtype?: string): CanonicalEvent {
  return {
    source: 'github',
    eventType: 'push',
    dedupeKey: 'dk-' + (subtype ?? 'none'),
    occurredAt: new Date(0).toISOString(),
    title: 'push',
    data: subtype ? { subtype } : {},
    raw: {},
  };
}

function route(id: string, config: Record<string, unknown>): RouteRecord {
  return {
    id,
    source: 'github',
    eventType: 'push',
    targetId: 't1',
    transform: null,
    config,
    enabled: true,
    priority: 0,
  };
}

describe('passesFilter (pure)', () => {
  it('passes when no excludeSubtypes configured', () => {
    expect(passesFilter(event('branch:dev'), {})).toBe(true);
    expect(passesFilter(event('branch:dev'), { excludeSubtypes: [] })).toBe(true);
  });
  it('suppresses when the event subtype is excluded', () => {
    expect(passesFilter(event('branch:dev'), { excludeSubtypes: ['branch:dev'] })).toBe(false);
  });
  it('passes a non-excluded subtype', () => {
    expect(passesFilter(event('branch:main'), { excludeSubtypes: ['branch:dev'] })).toBe(true);
  });
  it('passes when the event has no subtype', () => {
    expect(passesFilter(event(), { excludeSubtypes: ['branch:dev'] })).toBe(true);
  });
});

class FakeRepo implements Repository {
  routes: RouteRecord[] = [];
  records: DeliveryRecordInput[] = [];
  async getSourceRecord() {
    return { slug: 'github', enabled: true, secretRef: 'github_webhook_secret' };
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
  async recordDelivery(input: DeliveryRecordInput): Promise<void> {
    this.records.push(input);
  }
  async ping(): Promise<boolean> {
    return true;
  }
  async close(): Promise<void> {}
}
class FakeDelivery implements DeliveryService {
  sent: DiscordMessage[] = [];
  async send(_t: DeliveryTarget, msg: DiscordMessage): Promise<void> {
    this.sent.push(msg);
  }
}

describe('engine — filtered outcome', () => {
  let repo: FakeRepo;
  let delivery: FakeDelivery;
  beforeEach(() => {
    repo = new FakeRepo();
    delivery = new FakeDelivery();
  });

  it('records filtered and delivers nothing when a route excludes the subtype', async () => {
    repo.routes = [route('r1', { excludeSubtypes: ['branch:dev'] })];
    const result = await dispatch(event('branch:dev'), { repo, delivery });
    expect(result.filtered).toBe(1);
    expect(result.delivered).toBe(0);
    expect(delivery.sent).toHaveLength(0);
    expect(repo.records.at(-1)?.status).toBe('filtered');
  });

  it('delivers a non-excluded subtype normally', async () => {
    repo.routes = [route('r1', { excludeSubtypes: ['branch:dev'] })];
    const result = await dispatch(event('branch:main'), { repo, delivery });
    expect(result.delivered).toBe(1);
    expect(result.filtered).toBe(0);
    expect(delivery.sent).toHaveLength(1);
  });

  it('one route filters while another (no filter) still delivers the same event', async () => {
    repo.routes = [route('r1', { excludeSubtypes: ['branch:dev'] }), route('r2', {})];
    const result = await dispatch(event('branch:dev'), { repo, delivery });
    expect(result.filtered).toBe(1);
    expect(result.delivered).toBe(1);
    expect(delivery.sent).toHaveLength(1);
  });
});
