# 002 Implementation Summary (overnight)

Status as of this session — read this first in the morning.

## Done

**Feature 002 (GitHub source + per-route formatting) is fully implemented, tested, and
committed on branch `spec/002-github-source`.** All 20 tasks complete; `check:all` green
(57 tests across 12 files; +30 new for 002). Convergence run: **converged** (one latent bug
found + fixed — see below). Nothing pushed to `main`/`dev` — they remain at `ac96a5a`.

Branch: `spec/002-github-source` @ `732adfe` (pushed to origin).

## What was built

- **GitHub source adapter** (`src/sources/github/adapter.ts`): verifies `X-Hub-Signature-256`
  (constant-time), parses `pull_request` (opened/closed; merged→`data.subtype`), `issues`
  (opened/closed), `push` into `CanonicalEvent` with a `type.action` discriminator and a
  normalized `data.subtype`; dedupe key = `X-GitHub-Delivery`; ping/unmapped → ignored.
  Registered alongside ClickUp in `src/sources/index.ts` — no engine/delivery/dedup change.
- **Named GitHub transform** (`src/routing/transforms/github.ts`) selectable via
  `routes.transform='github'`; registered in `transforms/index.ts` (now imported by `main.ts`).
- **Per-route config** (`src/routing/transforms/format-config.ts`, opt-in helper):
  `mentionRoleIds`, `accentColor`. The default transform is untouched → no ClickUp regression.
- **Filtering**: `src/routing/filter.ts` (`excludeSubtypes` vs `data.subtype`) + a
  source-agnostic engine filter step recording a new **`filtered`** outcome
  (migration `0004`, repository status union, `DispatchResult.filtered`).
- Env/ops: `GITHUB_WEBHOOK_SECRET` added to `.env.example` + `set-secrets.sh`;
  `docs/OPERATIONS.md` has a "Sources" section for wiring GitHub.

## Convergence finding (fixed)

The adapter read the issues payload as `body.issues ?? body.issue`; GitHub uses the singular
`issue`. Worked only via the fallback; corrected to `body.issue` (commit `732adfe`).

## NOT done — needs you (intentionally left for you)

- **Not merged to dev/main.** 002 lives only on its spec branch, per the "specs/feature work
  off main until you decide" rule. Merge when ready.
- **No deploy.** No migration run against a real DB, no Cloud Run deploy, no secrets set. To
  ship: merge → run `npm run migrate` (applies `0004`) → set `GITHUB_WEBHOOK_SECRET` via
  `./scripts/set-secrets.sh` → add the `github` source + routes in Supabase → point a GitHub
  webhook at `/webhooks/github`. Full steps in `docs/OPERATIONS.md` and `quickstart.md`.
- **Token rotation** (still outstanding from before): see `ARCHITECTURE.md` — rotate the
  setup-exposed Discord/ClickUp tokens when convenient.

## Verification done

- `npm run check:all` green (format, lint, typecheck, 57 tests).
- Built artifact boots; GitHub source registered; 404 unknown-source / 503 fail-closed-without-DB
  confirmed by smoke test. (Verify→202/401 path proven by the integration tests with a fake
  context, since a no-DB smoke can't reach the verify step.)
