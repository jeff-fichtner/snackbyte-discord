# Contract: Named transforms + per-route formatting/filter config

How a route selects its rendering and tunes presentation/filtering. This is operator-facing data
(a route's `transform` key + `config` JSONB) plus the code-side transform registry — no HTTP
surface. Reuses 001's transform registry and the existing `routes.config` column.

## Transform selection (per route)

- A route's `transform` column names a registered transform; `null` (or a name not in the
  registry) → the **default** transform (unchanged from 001; FR-008/FR-009).
- Registered transforms after this feature: `default` (existing) and `github` (new; renders PR /
  issue / push events, reading `CanonicalEvent.data` for specifics).
- Selection is runtime-mutable: changing `transform` on a route takes effect on the next event,
  no redeploy (FR-010).

## Per-route config keys (`routes.config` JSONB)

All keys optional. Absent/empty → today's default behavior (so existing routes are unaffected).
A given transform reads these; the same transform + different config = different output (FR-014).

| Key | Type | Default | Effect |
|---|---|---|---|
| `mentionRoleIds` | `string[]` | `[]` | Role ids to mention in the message (prepended/the embed's content). Unresolvable ids are omitted, not an error. |
| `accentColor` | `number` | transform's default | Embed accent color (integer color value). |
| `excludeSubtypes` | `string[]` | `[]` | Event subtypes to suppress for this route. A matched event whose subtype is in this list is **not delivered**; the outcome is recorded as `filtered`. |

### Filter semantics (`excludeSubtypes`)

- The route already matched on the exact `type.action` discriminator. `excludeSubtypes` matches
  against the single normalized `CanonicalEvent.data.subtype` string the adapter writes (not a scan
  of all `data` values), so the recognized vocabulary is exactly the set of `subtype` values
  adapters emit. Initial GitHub vocabulary: `pull_request.merged`, `pull_request.unmerged`, and a
  `branch:<name>` form for `push`. Events without a meaningful subtype omit it (and so are never
  excluded by this filter).
- Empty/absent list → deliver everything the route matched.
- A suppressed event: zero Discord messages for that route; one `delivery_log` row with
  status `filtered` (FR-012/FR-013).
- Filtering is evaluated **before** delivery, in the routing engine, applied uniformly to all
  sources (not GitHub-specific logic).

### Graceful degradation

- A config that references a missing role id → mention omitted, delivery still succeeds.
- A route naming a non-existent transform → default transform, delivery still succeeds (FR-009).
- Malformed/unexpected config values → fall back to defaults rather than failing the delivery.

### Acceptance mapping

- US2 sc.1–3 → transform selection + default fallback + missing-style fallback.
- US3 sc.1 → `mentionRoleIds` produces a mention. US3 sc.2 → `accentColor` reflected.
  US3 sc.3 → `excludeSubtypes` suppresses (recorded `filtered`), others deliver.
  US3 sc.4 → same transform, two configs → two different outputs.
