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
  status: 'ok' | 'failed' | 'skipped' | 'filtered';
  error?: string;
}

/**
 * An operator-curated reaction-role mapping: reacting with `emojiKey` on `messageId` grants
 * `roleId`. `emojiKey` is the emoji's stable identity — a custom emoji's numeric id, or a standard
 * emoji's unicode codepoint string — so the match survives a custom-emoji rename. A mapping is
 * additive configuration only: the role must also be on the guild's self-assignable whitelist for a
 * reaction to grant it.
 */
export interface ReactionRoleMapping {
  messageId: string;
  emojiKey: string;
  roleId: string;
}

/**
 * An operator-curated component→role binding: activating `componentKey` (a button's customId, or a
 * select's customId plus option value) grants `roleId`. Additive configuration — the role must also
 * be on the guild's self-assignable whitelist for the component to grant it.
 */
export interface ComponentRoleBinding {
  componentKey: string;
  roleId: string;
}

export interface Repository {
  /** Fetch a source row by slug (for enablement + its secret reference), or null. */
  getSourceRecord(slug: string): Promise<SourceRecord | null>;
  /** Enabled routes whose source + exact event type match (fan-out: may return many). */
  findEnabledRoutes(source: string, eventType: string): Promise<RouteRecord[]>;
  /** Resolve a delivery target by id (or null if missing/disabled). */
  getTarget(id: string): Promise<DeliveryTarget | null>;
  /** Role ids an operator has marked self-assignable in this guild (empty when none). */
  listSelfAssignableRoles(guildId: string): Promise<string[]>;
  /** Reaction-role mappings an operator has configured in this guild (empty when none). */
  listReactionRoleMappings(guildId: string): Promise<ReactionRoleMapping[]>;
  /** Component→role bindings an operator has configured in this guild (empty when none). */
  listComponentRoleBindings(guildId: string): Promise<ComponentRoleBinding[]>;
  /** True if this (route, event) was already delivered (idempotency pre-check). */
  alreadyDelivered(routeId: string, dedupeKey: string): Promise<boolean>;
  /** Record a delivery attempt outcome; the unique (route_id, dedupe_key) guards dups. */
  recordDelivery(input: DeliveryRecordInput): Promise<void>;
  /** Lightweight reachability check for readiness. */
  ping(): Promise<boolean>;
  /** Close underlying resources on shutdown. */
  close(): Promise<void>;
}
