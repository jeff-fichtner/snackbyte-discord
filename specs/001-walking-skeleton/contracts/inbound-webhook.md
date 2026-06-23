# Contract: Inbound webhook endpoint

The HTTP surface external sources call. One generic route resolves the adapter by slug.

## `POST /webhooks/:source`

Receives a webhook from the external source named by `:source` (e.g. `/webhooks/clickup`).

### Request

- **Path param** `:source` — the source slug; must match a registered source adapter.
- **Headers** — provider-specific authenticity proof. For ClickUp: `X-Signature` (hex
  HMAC-SHA256 of the raw body, keyed by the source's signing secret).
- **Body** — the provider's raw JSON payload. The **raw bytes** are read for signature
  verification before any JSON parsing; raw-body capture is mounted only on `/webhooks/*`.

### Behavior (in order)

1. Resolve the adapter for `:source`. If none → **404**, nothing routed (FR-004).
2. Verify authenticity via the adapter (`X-Signature` HMAC, constant-time). On failure →
   **401**, no parse, no routing, no delivery (FR-002/003).
3. On success → **acknowledge immediately** (see responses), then asynchronously: parse →
   canonical event(s) → match enabled routes (exact source+event_type, fan out to all) →
   transform → deliver per route → record outcome (FR-004a, FR-005..014).

### Responses

| Status | When | Body | Sender should retry? |
|--------|------|------|----------------------|
| `202 Accepted` | Verified & well-formed; accepted for async processing (incl. when no route matches — FR-008). | `{ "accepted": true }` | No |
| `400 Bad Request` | Verified but body is malformed/unparseable for this source. | `{ "error": "invalid payload" }` | No |
| `401 Unauthorized` | Signature missing/invalid (FR-003). | `{ "error": "unauthorized" }` | No (permanent) |
| `404 Not Found` | Unknown `:source` (FR-004). | `{ "error": "unknown source" }` | No |
| `503 Service Unavailable` | Routing store unreachable so the event cannot be processed (fail closed, FR-004b / Principle VI). | `{ "error": "temporarily unavailable" }` | Yes |

Notes:
- A matched-but-Discord-unavailable delivery does **not** change the inbound response — the
  request is already `202`; the delivery is retried then recorded `failed` (FR-012/014).
- "No matching route" is success (`202`), not an error (FR-008).

### Acceptance mapping

- US1 scenario 1 → `202` + message delivered + `delivery_log` `ok`.
- US1 scenario 2 (duplicate) → `202` + exactly one message + duplicate `skipped`.
- US1 scenario 3 (bad signature) → `401`, nothing routed.
- US1 scenario 4 (no route) → `202`, no message.
- US1 scenario 5 (multi-route) → `202` + one message per matching route, independent records.
- Edge "unknown source" → `404`. Edge "routing store down" → `503`.
