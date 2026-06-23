-- Make the idempotency guard a PARTIAL unique index.
--
-- The original 0001 unique index on (route_id, dedupe_key) enforced "at most one delivery
-- per (route, event)" — but it spanned ALL rows, so once an 'ok' row existed, the matching
-- 'skipped' audit row for a duplicate delivery collided and was silently dropped. That left
-- duplicates correctly suppressed (no double-post) but unaudited.
--
-- Scoping the unique constraint to status = 'ok' keeps the real guarantee (a given event is
-- delivered to a given route at most once) while letting 'skipped' and 'failed' audit rows
-- coexist, so the delivery_log is a complete record.

DROP INDEX IF EXISTS delivery_log_route_dedupe_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS delivery_log_route_dedupe_ok_uniq
  ON delivery_log (route_id, dedupe_key)
  WHERE status = 'ok';
