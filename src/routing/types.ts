/** Routing types shared by the engine, repository, and transforms. */

/** In-memory shape of a `routes` row, as the engine consumes it. */
export interface RouteRecord {
  id: string;
  source: string;
  eventType: string;
  targetId: string;
  /** Named transform key in the code registry; null = default transform. */
  transform: string | null;
  /** Per-route knobs (mention roles, embed color, filters). */
  config: Record<string, unknown>;
  enabled: boolean;
  priority: number;
}

/** A delivery destination, as the delivery service consumes it. */
export interface DeliveryTarget {
  id: string;
  mode: 'webhook' | 'bot';
  /** Reference name of the channel webhook URL secret (webhook mode). */
  webhookUrlRef?: string | null;
  channelId?: string | null;
  guildId?: string | null;
}

/** Outcome of dispatching one event across all matching routes. */
export interface DispatchResult {
  matched: number;
  delivered: number;
  skipped: number;
  failed: number;
}
