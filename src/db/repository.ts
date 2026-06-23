/**
 * The storage-agnostic routing-store interface.
 *
 * Everything above the database talks to this interface, never to a concrete driver, so
 * the backend (Supabase/Postgres now) stays swappable and unit tests can use a fake.
 */
import type { RouteRecord, DeliveryTarget } from '../routing/types.js';

/** A registered inbound source row (operational enablement + secret reference). */
export interface SourceRecord {
  slug: string;
  enabled: boolean;
  /** Reference name of the signing secret (resolved to a value at runtime), or null. */
  secretRef: string | null;
}

export interface DeliveryRecordInput {
  routeId: string;
  source: string;
  eventType: string;
  dedupeKey: string;
  targetId: string;
  status: 'ok' | 'failed' | 'skipped';
  error?: string;
}

export interface Repository {
  /** Fetch a source row by slug (for enablement + its secret reference), or null. */
  getSourceRecord(slug: string): Promise<SourceRecord | null>;
  /** Enabled routes whose source + exact event type match (fan-out: may return many). */
  findEnabledRoutes(source: string, eventType: string): Promise<RouteRecord[]>;
  /** Resolve a delivery target by id (or null if missing/disabled). */
  getTarget(id: string): Promise<DeliveryTarget | null>;
  /** True if this (route, event) was already delivered (idempotency pre-check). */
  alreadyDelivered(routeId: string, dedupeKey: string): Promise<boolean>;
  /** Record a delivery attempt outcome; the unique (route_id, dedupe_key) guards dups. */
  recordDelivery(input: DeliveryRecordInput): Promise<void>;
  /** Lightweight reachability check for readiness. */
  ping(): Promise<boolean>;
  /** Close underlying resources on shutdown. */
  close(): Promise<void>;
}
