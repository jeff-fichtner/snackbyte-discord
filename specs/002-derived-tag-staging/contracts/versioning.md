# Contract: Version Derivation

The exact behavior the `version-and-tag` job MUST implement. This is the verification target for the
fresh-app spin-up and the snackbyte-site feedback loop.

> **As-built note.** The derivation is implemented as a standalone, tested script
> (`scripts/derive-version.sh`) that the workflow calls — not inline YAML. This makes it lintable and,
> crucially, **locally testable**: `scripts/derive-version.test.sh` (run via `npm run test:release`)
> exercises the script against every row below using throwaway git fixtures. The workflow runs
> `test:release` on push before relying on the derivation. `test:release` is intentionally kept OUT of
> `check:all` (which stays the app-code gate; release-tooling is its own bash/git gate). This is a
> deliberate refinement over the guinea-pig's inline form — tested = shipped, one source of truth.

## Inputs

- `BRANCH` = the pushed branch (`main` or `dev`; any other → error).
- `MM` = `MAJOR.MINOR` from `package.json` (`version.split('.').slice(0,2).join('.')`). The patch field
  in `package.json` is ignored.
- The full set of git tags (checkout MUST be `fetch-depth: 0` with tags fetched).

## Algorithm (symmetric; both branches)

```
MM      = major.minor from package.json
MME     = MM regex-escaped

# Shallow-clone guard: a truncated clone would HIDE existing tags and mis-derive.
# Test the clone directly (not a commit-count heuristic): the workflow ships fetch-depth:0,
# so a complete clone is expected; refuse only if the checkout is actually shallow.
if `git rev-parse --is-shallow-repository` == "true": FAIL
# On a complete clone, zero tags genuinely means FIRST PUSH → fall through → P = 0 → v<MM>.0[-dev].
# The workflow mints the first tag automatically on the first push to main OR dev; no manual tagging.

# 1. Cross-stream reuse: opposite-suffix tag ON this exact commit.
SIBLING =
  on dev : a tag matching ^vMM\.([0-9]+)$        among `git tag --points-at HEAD`   (a PROD tag)
  on main: a tag matching ^vMM\.([0-9]+)-dev$    among `git tag --points-at HEAD`   (a -dev tag)

if SIBLING exists:
    P = its captured patch
else:
    # 2. Global-max advance (collisions impossible; build-id semantics).
    P = max( captured patch of every tag matching ^vMM\.([0-9]+)(-dev)?$ ) + 1
        (empty set ⇒ -1 ⇒ P = 0)

TAG = (BRANCH == dev) ? "vMM.P-dev" : "vMM.P"

# 3. Fail-loud: never overwrite/reuse an existing tag.
if tag TAG exists: FAIL    # → no tag output → needs:-gated deploy is skipped (no silent success)

create annotated tag TAG on HEAD; push ONLY the tag (no commit, no branch push)
emit outputs: version = "MM.P", tag = TAG
```

**Parsing MUST be anchored** (`^…$`) so stray/hand-made tags are skipped, not mis-parsed.

## Required scenario outcomes (the acceptance matrix)

Minor `0.1` unless noted. "advance" = global-max+1; "reuse" = `--points-at HEAD` sibling.

| # | State / action | Branch | Result | Mechanism |
|---|---|---|---|---|
| 1 | **first push ever**, no tags, push main (any commit count) | main | `v0.1.0` | advance (max=-1); mints the first tag |
| 1d | **first push ever**, no tags, push dev (any commit count) | dev | `v0.1.0-dev` | advance (max=-1); mints the first tag |
| 2 | `v0.1.0` exists, push main again | main | `v0.1.1` | advance |
| 3 | dev push, `v0.1.0/1` exist | dev | `v0.1.2-dev` | advance |
| 4 | dev extends with new commits | dev | next `-dev` | advance |
| 5 | FF promote: main→dev commit tagged `v0.1.2-dev` | main | `v0.1.2` | reuse (sibling on HEAD) |
| 6 | re-run #5 (`v0.1.2` now exists on HEAD) | main | **FAIL-loud** | tag exists → no deploy |
| 7 | resume direct-to-main after promote (new commit) | main | advance (next free) | no sibling on HEAD — **does NOT jam** |
| 8 | resync: FF dev to a `v0.2.0` commit | dev | `v0.2.0-dev` | reuse (prod sibling on HEAD) |
| 9 | 3 main hotfixes, then a dev commit | dev | jumps ~3 ahead | global-max (build-id; correct) |
| 10 | truly-diverged branches merged (both unique) | either | fresh number | advance (merge commit untagged) |
| 11 | **shallow** checkout (tags hidden by truncation) | either | **FAIL** | shallow-clone guard (`is-shallow-repository`) |
| 12 | app never creates dev, many main pushes | main | `v0.1.0,1,2,…` | advance (self-increment) |

Rows **1/1d** confirm the workflow mints the first tag itself on the first push to *either* branch — no
manual first tag, no dependence on commit count (the guard keys on *shallow*, not history length).
Rows **5, 7, 9, 10** are the refinement over snackbyte-site's `git describe` logic (which would jam on 7).
These are the priority cases for live verification (the fresh-app spin-up and the snackbyte-site loop).

## Promotion gate (enforced outside the derivation)

Promotion `dev`→`main` MUST require `main` ⊆ `dev` (fast-forwardable). Guarantees row 5's sibling lands
on HEAD (number reused, not re-minted) and makes hotfix-missing `dev` code unpromotable. Enforced via
branch protection where possible; documented as the reflex regardless. NOT part of the derivation script
— it's a merge-flow rule.

## Robustness guards (all REQUIRED)

- `fetch-depth: 0` + tags in the checkout; then fail only if the clone is actually shallow
  (`git rev-parse --is-shallow-repository` == `true`) — NOT on a commit-count heuristic (row 11). Zero
  tags on a complete clone is a legitimate first push (rows 1/1d), not an error.
- Anchored regex parsing of machine tags.
- Fail-loud on existing target tag (row 6).
- `concurrency: group: version-${{ github.ref }}`, `cancel-in-progress: false` — serialize same-branch
  runs so two pushes can't derive the same patch.

## Invariants

- CI creates a **tag only** — never a commit or branch push (FR-003).
- No two commits ever receive the same patch (global-max, FR-006).
- The same commit MAY carry both `vMM.P-dev` and `vMM.P` (FR-008).
- `package.json` patch is never read for the running version (FR-004/009).
