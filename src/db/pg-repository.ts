/**
 * PostgreSQL implementation of the Repository interface. Parameterized queries only;
 * maps rows to the in-memory RouteRecord / DeliveryTarget shapes. Routes are read live
 * per event (no cache) so operator edits take effect on the next event with no restart.
 */
import type { Pool } from 'pg';
import type { Repository, DeliveryRecordInput } from './repository.js';
import type { RouteRecord, DeliveryTarget } from '../routing/types.js';

export class PgRepository implements Repository {
  constructor(private readonly pool: Pool) {}

  async findEnabledRoutes(source: string, eventType: string): Promise<RouteRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT id, source, event_type, target_id, transform, config, enabled, priority
         FROM routes
        WHERE enabled AND source = $1 AND event_type = $2
        ORDER BY priority DESC, created_at ASC`,
      [source, eventType],
    );
    return rows.map((r) => ({
      id: r.id,
      source: r.source,
      eventType: r.event_type,
      targetId: r.target_id,
      transform: r.transform,
      config: r.config ?? {},
      enabled: r.enabled,
      priority: r.priority,
    }));
  }

  async getTarget(id: string): Promise<DeliveryTarget | null> {
    const { rows } = await this.pool.query(
      `SELECT id, mode, webhook_url_ref, channel_id, guild_id
         FROM discord_targets
        WHERE id = $1 AND enabled`,
      [id],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      mode: r.mode,
      webhookUrlRef: r.webhook_url_ref,
      channelId: r.channel_id,
      guildId: r.guild_id,
    };
  }

  async alreadyDelivered(routeId: string, dedupeKey: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `SELECT 1 FROM delivery_log WHERE route_id = $1 AND dedupe_key = $2 AND status = 'ok' LIMIT 1`,
      [routeId, dedupeKey],
    );
    return (rowCount ?? 0) > 0;
  }

  async recordDelivery(input: DeliveryRecordInput): Promise<void> {
    // ON CONFLICT guards the unique (route_id, dedupe_key): a concurrent duplicate that
    // races past the pre-check still cannot create a second 'ok' row.
    await this.pool.query(
      `INSERT INTO delivery_log (route_id, source, event_type, dedupe_key, target_id, status, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (route_id, dedupe_key) DO NOTHING`,
      [
        input.routeId,
        input.source,
        input.eventType,
        input.dedupeKey,
        input.targetId,
        input.status,
        input.error ?? null,
      ],
    );
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
