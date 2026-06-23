-- Initial schema for the Discord integration hub's routing store.
--
-- The database holds runtime-mutable routing the operator edits without a deploy:
-- which source/event goes to which Discord target, on/off, plus an audit + de-dup
-- ledger. Verification, parsing, and transforms live in code, not here. Secret VALUES
-- are never stored — rows hold reference names that the app resolves at runtime.

-- pgcrypto provides gen_random_uuid() (Supabase enables it by default).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Recognized inbound sources. The authoritative list of source *types* is the code
-- adapter registry; rows control operational enablement and hold the secret reference.
CREATE TABLE IF NOT EXISTS sources (
  slug         text PRIMARY KEY,
  display_name text NOT NULL,
  enabled      boolean NOT NULL DEFAULT true,
  secret_ref   text,                          -- reference name, NOT the secret value
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Where a message can be delivered. This slice uses mode='webhook' (post to a channel
-- webhook URL); mode='bot' is accepted for a later feature.
CREATE TABLE IF NOT EXISTS discord_targets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  mode            text NOT NULL CHECK (mode IN ('webhook', 'bot')),
  guild_id        text,
  channel_id      text,                        -- required when mode='bot'
  webhook_url_ref text,                        -- reference name, NOT the URL; required when mode='webhook'
  enabled         boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- The operator-editable routing table — the primary thing operators add and strike.
-- A route matches when its source and EXACT event_type equal the event's.
CREATE TABLE IF NOT EXISTS routes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source     text NOT NULL REFERENCES sources(slug),
  event_type text NOT NULL,                    -- exact match this slice; wildcard is a later capability
  target_id  uuid NOT NULL REFERENCES discord_targets(id),
  transform  text,                             -- named transform key; NULL = default transform
  config     jsonb NOT NULL DEFAULT '{}',      -- per-route knobs (mention roles, embed color, ...)
  enabled    boolean NOT NULL DEFAULT true,
  priority   int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Hot lookup path: enabled routes for a (source, event_type).
CREATE INDEX IF NOT EXISTS routes_source_event_enabled_idx
  ON routes (source, event_type)
  WHERE enabled;

-- A route is uniquely identified by (source, event_type, target_id): the same event from a
-- source maps to a given target at most once. This makes the seed below idempotent on
-- re-run (its ON CONFLICT has a real target) and prevents accidental duplicate fan-out.
CREATE UNIQUE INDEX IF NOT EXISTS routes_source_event_target_uniq
  ON routes (source, event_type, target_id);

-- Audit trail and de-duplication ledger. One row per (route, event) delivery outcome.
CREATE TABLE IF NOT EXISTS delivery_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id   uuid REFERENCES routes(id),
  source     text NOT NULL,                    -- denormalized for fast filtering
  event_type text NOT NULL,
  dedupe_key text NOT NULL,
  target_id  uuid REFERENCES discord_targets(id),
  status     text NOT NULL CHECK (status IN ('ok', 'failed', 'skipped')),
  error      text,                             -- redacted reason on failure
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotency: a given event delivered to a given route is recorded at most once. A
-- duplicate delivery (provider retry) short-circuits to 'skipped' instead of re-posting.
CREATE UNIQUE INDEX IF NOT EXISTS delivery_log_route_dedupe_uniq
  ON delivery_log (route_id, dedupe_key);

-- --- Seed data: makes the walking-skeleton demo work out of the box. ---
-- One source (clickup), one webhook target, one enabled route. Edit/replace via the
-- store's table editor. The *_ref values name env vars that hold the real secrets.
INSERT INTO sources (slug, display_name, secret_ref)
  VALUES ('clickup', 'ClickUp', 'clickup_webhook_secret')
  ON CONFLICT (slug) DO NOTHING;

INSERT INTO discord_targets (id, name, mode, webhook_url_ref)
  VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Demo channel',
    'webhook',
    'demo_channel_webhook'
  )
  ON CONFLICT (id) DO NOTHING;

INSERT INTO routes (source, event_type, target_id)
  VALUES (
    'clickup',
    'taskStatusUpdated',
    '00000000-0000-0000-0000-000000000001'
  )
  ON CONFLICT (source, event_type, target_id) DO NOTHING;
