-- Reaction-role mappings: reacting with a specific emoji on a specific message grants a role.
--
-- Each row binds (guild, message, emoji) to one role. An operator curates this table directly (the
-- table editor, like routes and self_assignable_roles) — the app never auto-inserts a row. Reacting
-- with the emoji grants the role; removing the reaction removes it (the reaction is the source of
-- truth). A mapping is NOT by itself authorization: at reaction time the role must ALSO be on the
-- guild's self_assignable_roles whitelist, so a mapping can never grant a role an operator has not
-- whitelisted, and the app never auto-adds a role to the whitelist.
--
-- Emoji identity is stored stably: for a custom server emoji, its numeric id (rename-safe); for a
-- standard emoji, the unicode codepoint string. emoji_kind records which so a row reads
-- unambiguously; the match key (emoji_key) already disambiguates. The (guild, message, emoji) triple
-- is unique — one emoji on a message maps to exactly one role (a role may appear in many rows).
--
-- Keyed by stable Discord identifiers, not names; no FKs (guild_id/message_id/role_id are external
-- Discord ids, not rows here). A role deleted or de-whitelisted after a mapping is created is a clean
-- no-op at reaction time (the whitelist intersection or the live-role lookup fails), not an error.

CREATE TABLE IF NOT EXISTS reaction_role_mappings (
  guild_id   text NOT NULL,
  message_id text NOT NULL,
  emoji_key  text NOT NULL,
  emoji_kind text NOT NULL CHECK (emoji_kind IN ('unicode', 'custom')),
  role_id    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, message_id, emoji_key)
);
