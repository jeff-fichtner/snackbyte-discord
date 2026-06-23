-- Make route seeding idempotent across re-runs.
--
-- 0001 seeds a demo route with `ON CONFLICT DO NOTHING`, but `routes` only has a uuid PK
-- (gen_random_uuid()), so that conflict clause never matches — re-running the migration
-- inserts a second identical route. Two identical enabled routes fan out, double-posting
-- the same event to the same channel.
--
-- A route is uniquely identified by (source, event_type, target_id): the same event from
-- the same source should map to a given target at most once. Enforce that, then a seed's
-- ON CONFLICT has something real to catch. (Dedup any existing duplicates first so the
-- index can be created.)

DELETE FROM routes a
  USING routes b
 WHERE a.source = b.source
   AND a.event_type = b.event_type
   AND a.target_id = b.target_id
   AND a.created_at > b.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS routes_source_event_target_uniq
  ON routes (source, event_type, target_id);
