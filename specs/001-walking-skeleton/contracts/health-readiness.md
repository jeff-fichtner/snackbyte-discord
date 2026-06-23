# Contract: Health & readiness endpoints

Operability surface. Liveness is independent of downstream health; readiness reflects it. The
two are deliberately separate (FR-020/021, Principle VI).

## `GET /api/health` (liveness)

Returns healthy whenever the process is running, regardless of Discord or DB state, so the
platform does not cycle the always-on instance during a transient downstream blip.

| Status | When | Body |
|--------|------|------|
| `200 OK` | Process is up. Always, while running. | `{ "status": "ok", "uptime": <seconds>, "timestamp": "<iso>" }` |

It MUST NOT call Discord or the database. (Extends the existing snackbyte-base health route.)

## `GET /api/ready` (readiness)

Reports whether dependencies are currently usable. Used for traffic-gating/diagnostics, never
to gate liveness.

| Status | When | Body |
|--------|------|------|
| `200 OK` | Routing store reachable AND gateway connected. | `{ "ready": true, "checks": { "db": "ok", "gateway": "ok" } }` |
| `503 Service Unavailable` | Any dependency not ready. | `{ "ready": false, "checks": { "db": "ok"\|"down", "gateway": "ok"\|"down" } }` |

### Acceptance mapping

- SC-008 / FR-020 → `/api/health` stays `200` while Discord or DB is briefly unavailable.
- FR-021 → `/api/ready` flips to `503` and names the failing dependency, without affecting
  `/api/health`.
