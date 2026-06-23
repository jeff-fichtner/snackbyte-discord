#!/usr/bin/env bash
# Derive this push's version tag from git tags — the release flow never commits anything.
#
# The version PATCH is not stored in package.json (which holds only MAJOR.MINOR); it is a
# global, monotonic build id derived from the tags that already exist. The branch selects
# the environment and the tag suffix:
#   - dev  -> staging, tag vMAJOR.MINOR.PATCH-dev
#   - main -> production, tag vMAJOR.MINOR.PATCH
#
# One symmetric rule, both branches:
#   1. If the OTHER stream already tagged THIS exact commit (a fast-forward promotion or
#      resync), reuse that number — dev reuses a prod tag on HEAD, main reuses a -dev tag on
#      HEAD. The promoted/resynced commit then carries both suffixes for one number.
#   2. Otherwise advance to (highest patch among ALL vMM.* tags) + 1. Taking the max over
#      every tag — prod and -dev, both branches — makes two commits sharing a number
#      impossible. The cost is gaps (a hotfix consumes a number, so the other branch's next
#      number skips ahead); that is correct for a build id.
#
# Output: prints nothing to stdout except, when GITHUB_OUTPUT is set, writes `version=` and
# `tag=` for the workflow. The tag is created and pushed here; no commit, no branch push.
#
# Usage: scripts/derive-version.sh <branch>   (branch defaults to $GITHUB_REF_NAME)
set -euo pipefail

BRANCH="${1:-${GITHUB_REF_NAME:-}}"
if [ "$BRANCH" != "main" ] && [ "$BRANCH" != "dev" ]; then
  echo "Unsupported branch: '${BRANCH}' (expected main or dev)" >&2
  exit 1
fi

# A shallow checkout would hide existing tags and mis-derive a number that already exists.
# Test the clone directly rather than guessing from history length: zero tags on a COMPLETE
# clone is a legitimate first push (which mints vMM.0), but zero tags on a shallow clone is a
# truncation we must refuse.
if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
  echo "Shallow checkout — tags may be hidden; refusing to derive. Use a full clone (fetch-depth: 0)." >&2
  exit 1
fi

# MAJOR.MINOR from package.json; the patch field there is ignored.
MM="$(node -p "require('./package.json').version.split('.').slice(0,2).join('.')")"
MME="${MM//./\\.}" # regex-escape the dots for anchored matching

if [ "$BRANCH" = "dev" ]; then
  sibling_re="^v${MME}\.([0-9]+)$"      # dev reuses a PROD tag on HEAD
  suffix="-dev"
else
  sibling_re="^v${MME}\.([0-9]+)-dev$"  # main reuses a -dev tag on HEAD
  suffix=""
fi

# Step 1 — reuse the opposite-stream number if it is on THIS exact commit.
patch="$(git tag --points-at HEAD | sed -nE "s/${sibling_re}/\1/p" | sort -n | tail -1)"

# Step 2 — otherwise advance to the global max patch + 1 (empty set => -1 => 0 => first tag).
if [ -z "$patch" ]; then
  max="$(git tag -l "v${MM}.*" | sed -nE "s/^v${MME}\.([0-9]+)(-dev)?\$/\1/p" | sort -n | tail -1)"
  patch="$(( ${max:--1} + 1 ))"
fi

version="${MM}.${patch}"
tag="v${version}${suffix}"

# Never overwrite or silently reuse a tag. If the target already exists this is a re-run or a
# race (or, on main, an attempt to re-tag an already-released number) — fail loudly so no tag
# is produced and the deploy that depends on the tag is skipped rather than silently re-run.
if git rev-parse "$tag" >/dev/null 2>&1; then
  echo "Tag ${tag} already exists — refusing to overwrite (re-run, race, or already released)." >&2
  exit 1
fi

git tag -a "$tag" -m "Release ${tag}"
git push origin "$tag" # push the TAG only — never a commit, never a branch

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "version=${version}"
    echo "tag=${tag}"
  } >> "$GITHUB_OUTPUT"
fi
echo "Derived ${tag} on ${BRANCH} (no commit pushed)." >&2
