#!/usr/bin/env bash
# Builds the container image and deploys it to Cloud Run — a MANUAL deploy, outside CI.
#
# Usage:
#   ./scripts/deploy.sh <service-name> <gcp-project> [region] [version]
#
# The GCP project is REQUIRED and passed explicitly — the script never relies on whatever
# project gcloud happens to have active, so it can't accidentally deploy into the wrong
# (e.g. a client's) project.
#
# Versioning is owned by CI: the version is a tag derived from git history, NOT a value stored
# in package.json (which holds only MAJOR.MINOR). This manual path therefore takes the version
# you want to stamp as an explicit argument; it does NOT read a patch from package.json. If you
# omit it, the current git description is used (or a 'manual' placeholder), and it is passed as a
# RUNTIME env var that feeds the server's /api/version. The normal release path is CI, not this
# script — use this for one-off manual deploys.
#
# Requires: gcloud, git, and an authenticated account.
set -euo pipefail

SERVICE="${1:?Usage: ./scripts/deploy.sh <service-name> <gcp-project> [region] [version]}"
PROJECT="${2:?Usage: ./scripts/deploy.sh <service-name> <gcp-project> [region] [version]}"
REGION="${3:-us-central1}"

COMMIT="$(git rev-parse --short HEAD)"
# Version: explicit 4th arg wins; else the nearest tag describing HEAD; else a 'manual' marker.
VERSION="${4:-$(git describe --tags --always 2>/dev/null || echo "manual-${COMMIT}")}"
BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Deploying '${SERVICE}' ${VERSION} (${COMMIT}) to Cloud Run (project=${PROJECT}, region=${REGION})..."

# Build from source (Cloud Build) and deploy. The Dockerfile build stage runs CI=true and
# NODE_ENV=production, so the chip is hidden (production default). The frontend bundle's version
# comes from the APP_VERSION build-arg; '--source .' does not forward build-args, so the bundle's
# version/commit/date fall back to their defaults here — only the server's /api/version (from the
# runtime env vars below) reflects the real values on this manual path. For a build that bakes the
# real version into the frontend too, use cloudbuild.yaml (the CI path).
gcloud run deploy "${SERVICE}" \
  --source . \
  --project "${PROJECT}" \
  --region "${REGION}" \
  --allow-unauthenticated \
  --set-env-vars "NODE_ENV=production,APP_VERSION=${VERSION},BUILD_GIT_COMMIT=${COMMIT},BUILD_DATE=${BUILD_DATE}"

echo "Done. Deployed ${VERSION} (${COMMIT})."
