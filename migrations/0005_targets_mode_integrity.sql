-- Enforce per-mode addressing integrity on discord_targets.
--
-- 001 created discord_targets with mode IN ('webhook','bot') and noted in comments that a bot
-- target needs a channel_id and a webhook target needs a webhook_url_ref — but nothing enforced
-- it. Now that bot-mode delivery is live, a half-configured row (a 'bot' target with no
-- channel_id, or a 'webhook' target with no webhook_url_ref) would only fail at delivery time.
-- This constraint rejects such a row at edit time in the table editor instead.
--
-- Defense-in-depth: the delivery service also classes a missing required field as a permanent
-- failure at runtime, so correctness does not depend on this migration. Additive and idempotent
-- (drop-if-exists then add); existing valid rows are unaffected (the only seeded target is the
-- webhook-mode demo row from 001, which has its webhook_url_ref).

ALTER TABLE discord_targets
  DROP CONSTRAINT IF EXISTS discord_targets_mode_addressing_chk;

ALTER TABLE discord_targets
  ADD CONSTRAINT discord_targets_mode_addressing_chk
  CHECK (
    (mode = 'bot'     AND channel_id      IS NOT NULL) OR
    (mode = 'webhook' AND webhook_url_ref IS NOT NULL)
  );
