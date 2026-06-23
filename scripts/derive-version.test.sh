#!/usr/bin/env bash
# Local proof of scripts/derive-version.sh against the 14-row acceptance matrix.
#
# The derivation can only be exercised for real against git itself, so this builds a throwaway
# repo (with a local bare "origin" so the script's `git push origin <tag>` succeeds) and runs
# each scenario, asserting the derived tag. Run: bash scripts/derive-version.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd)/derive-version.sh"
PKG_MM="${PKG_MM:-0.1}" # the MAJOR.MINOR the fixtures pretend package.json holds
# Counters live in files because each scenario runs in a ( subshell ); plain vars wouldn't survive.
PASS_F="$(mktemp)"; FAIL_F="$(mktemp)"
export PASS_F FAIL_F SCRIPT PKG_MM

# Build a fresh repo with a local bare origin. Returns the work tree path on stdout.
# Force the initial branch to `main` with `-b main`: the fixtures reference `main` directly
# (e.g. `git rev-parse main`), so without this the suite fails on any host whose
# init.defaultBranch is `master` (the stock git default — and the GitHub Actions runner's).
fresh_repo() {
  local root
  root="$(mktemp -d)"
  git init -q -b main --bare "$root/origin.git"
  git init -q -b main "$root/work"
  (
    cd "$root/work"
    git config user.email t@t.t
    git config user.name t
    git config commit.gpgsign false
    git remote add origin "$root/origin.git"
    printf '{"name":"t","version":"%s.0","private":true}\n' "$PKG_MM" > package.json
    git add package.json
    git commit -q -m "init"
    git push -q origin HEAD:main
  )
  echo "$root/work"
}

# commit [msg] -> new empty-ish commit on current branch
commit() { git commit -q --allow-empty -m "${1:-c}"; }

# run the derivation for a branch; prints the tag the SCRIPT reports it created (via its
# GITHUB_OUTPUT `tag=` line — the authoritative answer), or "FAIL" if it exited non-zero.
derive() {
  local branch="$1" gho
  gho="$(mktemp)"
  if GITHUB_OUTPUT="$gho" "$SCRIPT" "$branch" >/dev/null 2>&1; then
    sed -nE 's/^tag=(.*)$/\1/p' "$gho"
  else
    echo "FAIL"
  fi
}

# assert <row> <expected> <actual> — counters live in files so subshell results propagate.
assert() {
  if [ "$2" = "$3" ]; then echo x >> "$PASS_F"; printf '  ok   %-4s expected %-14s\n' "$1" "$2"
  else echo x >> "$FAIL_F"; printf '  FAIL %-4s expected %-14s got %s\n' "$1" "$2" "$3"; fi
}
export -f fresh_repo commit derive assert

echo "Deriving against package.json MAJOR.MINOR = ${PKG_MM}"

# Row 1 — first push ever, no tags, main -> v0.1.0
W="$(fresh_repo)"; ( cd "$W"; git checkout -q main
  assert 1 "v${PKG_MM}.0" "$(derive main)" )

# Row 1d — first push ever, no tags, dev -> v0.1.0-dev
W="$(fresh_repo)"; ( cd "$W"; git checkout -q -b dev
  assert 1d "v${PKG_MM}.0-dev" "$(derive dev)" )

# Row 2 — v0.1.0 exists, push main again -> v0.1.1 (global-max advance)
W="$(fresh_repo)"; ( cd "$W"; git checkout -q main
  git tag -a "v${PKG_MM}.0" -m x; commit
  assert 2 "v${PKG_MM}.1" "$(derive main)" )

# Row 3 — dev push, v0.1.0 & v0.1.1 exist -> v0.1.2-dev
W="$(fresh_repo)"; ( cd "$W"; git checkout -q -b dev
  git tag -a "v${PKG_MM}.0" -m x; git tag -a "v${PKG_MM}.1" -m x; commit
  assert 3 "v${PKG_MM}.2-dev" "$(derive dev)" )

# Row 4 — dev extends with a new commit (already has v0.1.2-dev) -> next -dev (advance)
W="$(fresh_repo)"; ( cd "$W"; git checkout -q -b dev
  git tag -a "v${PKG_MM}.2-dev" -m x; commit   # new dev commit, nothing tagged on it
  assert 4 "v${PKG_MM}.3-dev" "$(derive dev)" )

# Row 5 — FF promote: main HEAD carries v0.1.2-dev -> reuse -> v0.1.2 (suffix dropped)
W="$(fresh_repo)"; ( cd "$W"; git checkout -q main
  git tag -a "v${PKG_MM}.0" -m x; git tag -a "v${PKG_MM}.1" -m x
  commit; git tag -a "v${PKG_MM}.2-dev" -m x   # the promoted dev commit, now main's HEAD
  assert 5 "v${PKG_MM}.2" "$(derive main)" )

# Row 6 — re-run #5: v0.1.2 now also on HEAD -> FAIL-loud
W="$(fresh_repo)"; ( cd "$W"; git checkout -q main
  commit; git tag -a "v${PKG_MM}.2-dev" -m x; git tag -a "v${PKG_MM}.2" -m x
  assert 6 "FAIL" "$(derive main)" )

# Row 7 — resume direct-to-main after promote: new commit, no -dev on HEAD -> advance (no jam)
W="$(fresh_repo)"; ( cd "$W"; git checkout -q main
  commit; git tag -a "v${PKG_MM}.2-dev" -m x; git tag -a "v${PKG_MM}.2" -m x
  commit   # new direct commit, nothing tagged on it
  assert 7 "v${PKG_MM}.3" "$(derive main)" )

# Row 8 — resync: dev HEAD carries a PROD tag v0.2.0 -> reuse -> v0.2.0-dev
#   (use a second minor so it's unambiguous)
W="$(fresh_repo)"; ( cd "$W"; git checkout -q -b dev
  commit; git tag -a "v${PKG_MM}.5" -m x   # a prod tag sitting on dev's HEAD (resync)
  assert 8 "v${PKG_MM}.5-dev" "$(derive dev)" )

# Row 9 — 3 main hotfixes consume numbers, then a dev commit -> dev jumps past them
W="$(fresh_repo)"; ( cd "$W"; git checkout -q main
  git tag -a "v${PKG_MM}.5-dev" -m x; git tag -a "v${PKG_MM}.5" -m x
  git tag -a "v${PKG_MM}.6" -m x; git tag -a "v${PKG_MM}.7" -m x; git tag -a "v${PKG_MM}.8" -m x
  git checkout -q -b dev; commit
  assert 9 "v${PKG_MM}.9-dev" "$(derive dev)" )

# Row 10 — truly-diverged branches merged (main and dev each have a unique tagged commit) ->
#   the --no-ff merge commit carries no tag -> advance to a fresh number for the merged artifact.
#   Build the divergence from the init commit. The two side commits MUST differ (distinct messages
#   AND distinct file changes) — two empty commits off the same base with identical metadata can
#   collapse to one SHA, which would leave the branches un-diverged and the merge a no-op.
W="$(fresh_repo)"; ( cd "$W"
  base="$(git rev-parse main)"                    # the init commit (fresh_repo's only commit)
  git checkout -q -b mainwork "$base"
  echo mainwork > side.txt; git add side.txt; git commit -q -m mainwork-change
  git tag -a "v${PKG_MM}.5" -m x                  # main-side unique commit
  git checkout -q -b devwork "$base"
  echo devwork > side.txt; git add side.txt; git commit -q -m devwork-change
  git tag -a "v${PKG_MM}.6-dev" -m x              # dev-side unique commit
  git checkout -q -B main mainwork
  git merge -q --no-ff -m merge -X ours devwork   # 2-parent merge commit M, untagged (-X ours: keep main's side.txt)
  assert 10 "v${PKG_MM}.7" "$(derive main)" )

# Row 11 — shallow clone -> FAIL (simulate by truncating to a shallow checkout)
W="$(fresh_repo)"; ( cd "$W"
  commit; commit
  url="$(git remote get-url origin)"
  sh="$(mktemp -d)/shallow"
  git clone -q --depth 1 "file://$(cd "$W" && pwd)/.git" "$sh" 2>/dev/null || git clone -q --depth 1 "$W/.git" "$sh"
  ( cd "$sh"; git checkout -q -B main
    printf '{"name":"t","version":"%s.0","private":true}\n' "$PKG_MM" > package.json
    if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
      assert 11 "FAIL" "$( "$SCRIPT" main >/dev/null 2>&1 && echo unexpected-ok || echo FAIL )"
    else
      echo "  skip 11  (clone was not shallow on this git; guard still unit-correct)"
    fi ) )

# Row 12 — app never creates dev; consecutive main pushes -> v0.1.0, v0.1.1
W="$(fresh_repo)"; ( cd "$W"; git checkout -q main
  t1="$(derive main)"; commit; t2="$(derive main)"
  assert 12a "v${PKG_MM}.0" "$t1"
  assert 12b "v${PKG_MM}.1" "$t2" )

echo ""
P="$(wc -l < "$PASS_F" | tr -d ' ')"; F="$(wc -l < "$FAIL_F" | tr -d ' ')"
echo "PASS=${P} FAIL=${F}"
[ "$F" -eq 0 ]
