-- Component→role bindings: activating a message component (a button, or a select-menu option) grants
-- a self-assignable role. The component style's analogue of the reaction-role mappings (0007).
--
-- Each row binds (guild, component) to one role. An operator curates this table directly (the table
-- editor, like routes and the whitelist) — the app never auto-inserts a row. Activating the component
-- toggles the role, exactly as the slash and reaction styles do. A binding is NOT by itself
-- authorization: the role must ALSO be on the guild's self_assignable_roles whitelist, so a component
-- can never grant a role an operator has not whitelisted.
--
-- component_key is the component's stable identity: a button's customId, or a select's customId plus
-- the chosen option value. component_kind ('button' | 'select') records which for readability; the
-- match uses component_key alone. The (guild, component) triple is unique — one component maps to one
-- role (a role may appear in many bindings).
--
-- Keyed by stable Discord identifiers; no FKs (guild_id/role_id are external ids). A role deleted or
-- de-whitelisted after a binding is created is a clean no-op at activation time, not an error.

CREATE TABLE IF NOT EXISTS component_role_bindings (
  guild_id       text NOT NULL,
  component_key  text NOT NULL,
  component_kind text NOT NULL CHECK (component_kind IN ('button', 'select')),
  role_id        text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, component_key)
);
