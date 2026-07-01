-- The self-assignable-role whitelist for the member self-service commands.
--
-- Each row marks one server role as available for members to self-assign in one guild. The
-- presence of a row IS the authorization — no row means the role is not self-assignable, so a
-- member can never grant themselves a role an operator has not explicitly listed here. Operators
-- curate this table directly (the table editor, like routes) — the app never auto-inserts a row.
--
-- Keyed by stable identifiers (guild_id, role_id), not names, so a role rename does not break an
-- entry; a whitelisted role that no longer exists is detected at command time (absent from the live
-- guild), not by a foreign key. No FKs: these are external Discord ids, not rows in this database.

CREATE TABLE IF NOT EXISTS self_assignable_roles (
  guild_id   text NOT NULL,
  role_id    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, role_id)
);
