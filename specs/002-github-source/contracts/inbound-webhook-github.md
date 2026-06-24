# Contract: GitHub inbound webhook

GitHub uses the **same generic endpoint** as every source —
`POST /webhooks/:source` with `:source = github`. This contract documents only what is
GitHub-specific; the generic behavior (raw-body capture, verify→ack→async dispatch, status
codes) is defined in `specs/001-walking-skeleton/contracts/inbound-webhook.md` and is unchanged.

## `POST /webhooks/github`

### Request

- **Path param** `:source` = `github` → resolves to the GitHub adapter.
- **Headers**:
  - `X-Hub-Signature-256` — `sha256=<hex HMAC-SHA256 of the raw body>` keyed by the source's
    signing secret (`sources.secret_ref='github_webhook_secret'` → env). **Required**; the
    `sha256=` prefix is stripped before constant-time comparison.
  - `X-GitHub-Event` — the event *type* (e.g. `pull_request`, `issues`, `push`, `ping`).
  - `X-GitHub-Delivery` — a per-delivery GUID; used as the de-duplication key.
- **Body** — GitHub's raw JSON payload (read as exact bytes for signature verification).

### Behavior (GitHub-specific points)

1. Verify `X-Hub-Signature-256` (constant-time) before parsing. Failure → **401** (permanent;
   GitHub should not retry).
2. Determine the discriminator: `eventType = <X-GitHub-Event>` + `.` + `payload.action` when an
   action exists (e.g. `pull_request.opened`); type-only when there is no action (`push`).
3. Mapped events (`pull_request.opened`, `pull_request.closed`, `issues.opened`,
   `issues.closed`, `push`) → one `CanonicalEvent`. A merged PR arrives as
   `pull_request.closed` with `merged: true` surfaced in `CanonicalEvent.data`.
4. Unmapped events and `ping` → parsed to **zero** canonical events (accept-without-acting).

### Responses (same codes as the generic contract)

| Status | When |
|--------|------|
| `202 Accepted` | Verified & well-formed; accepted for async processing — including `ping`, unmapped events, and mapped events with no matching/enabled route. |
| `400 Bad Request` | Verified but the body cannot be parsed as the expected GitHub shape. |
| `401 Unauthorized` | Missing/invalid `X-Hub-Signature-256`. Nothing parsed or routed. |
| `404 Not Found` | (Only if `:source` were unknown — not applicable once `github` is registered.) |
| `503 Service Unavailable` | Routing store unreachable (fail closed; GitHub retries). |

### Acceptance mapping

- US1 sc.1 → mapped event + matching route → `202` + message + `delivery_log` `ok`.
- US1 sc.2 → same `X-GitHub-Delivery` twice → one message, duplicate `skipped`.
- US1 sc.3 → bad signature → `401`, nothing routed.
- US1 sc.4 → `ping`/unmapped/no-route → `202`, no message.
- US1 sc.5 → ClickUp + GitHub both configured → each delivers independently (source isolation).
