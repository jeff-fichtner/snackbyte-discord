-- Add the 'filtered' delivery outcome.
--
-- 001 constrained delivery_log.status to ('ok','failed','skipped'). Per-route filtering
-- (added in this feature) intentionally suppresses an event for a route; that suppression must
-- be auditable and distinct from a failure or a duplicate, so it is recorded as 'filtered'.
-- This migration relaxes the CHECK to allow the new value. Additive and idempotent.
--
-- The original constraint is an unnamed inline column CHECK, which Postgres auto-names
-- 'delivery_log_status_check'. Drop it if present (IF EXISTS makes this safe on any environment),
-- then add the widened, explicitly-named constraint.

ALTER TABLE delivery_log
  DROP CONSTRAINT IF EXISTS delivery_log_status_check;

ALTER TABLE delivery_log
  ADD CONSTRAINT delivery_log_status_check
  CHECK (status IN ('ok', 'failed', 'skipped', 'filtered'));

-- Note: the idempotency guard is the partial unique index (route_id, dedupe_key) WHERE
-- status='ok' (migration 0002) — unaffected by this change, so 'filtered' rows coexist freely.
