#!/usr/bin/env bash
# Push runtime secrets from a local env file to a Cloud Run service — without ever
# printing the values. Use this to set or rotate secrets on prod or staging.
#
# Usage:
#   ./scripts/set-secrets.sh prod        # reads .env          -> snackbyte-discord
#   ./scripts/set-secrets.sh staging     # reads .env.staging  -> snackbyte-discord-staging
#
# It only pushes the app's real secrets/config (not PORT/LOG_LEVEL/build metadata). Missing
# keys in the env file are skipped (so you can rotate just one by leaving others blank? no —
# blank means "set empty", so only include keys you intend to set). Values are never echoed;
# the script reports which KEYS it set.
#
# Requires: gcloud (authenticated), and the env file to exist.
set -euo pipefail

ENVIRONMENT="${1:?Usage: ./scripts/set-secrets.sh <prod|staging>}"
PROJECT="snackbyte-apps"
REGION="us-central1"

case "$ENVIRONMENT" in
  prod)
    SERVICE="snackbyte-discord"
    ENV_FILE=".env"
    ;;
  staging)
    SERVICE="snackbyte-discord-staging"
    ENV_FILE=".env.staging"
    ;;
  *)
    echo "Unknown environment '$ENVIRONMENT' (expected: prod | staging)" >&2
    exit 1
    ;;
esac

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Env file '$ENV_FILE' not found. Create it with the keys below before running." >&2
  exit 1
fi

# The runtime secrets/config this app reads. Add new keys here as they appear in config.ts.
KEYS=(
  DISCORD_BOT_TOKEN
  DISCORD_APP_ID
  DISCORD_DEV_GUILD_ID
  DATABASE_URL
  LOG_LEVEL
  CLICKUP_WEBHOOK_SECRET
  GITHUB_WEBHOOK_SECRET
  DEMO_CHANNEL_WEBHOOK
)

# Load the env file into this shell (values stay in memory; never printed).
set -a
# shellcheck disable=SC1090
. "./$ENV_FILE"
set +a

# Build the --update-env-vars argument using a non-comma delimiter (^|^), since values like
# DATABASE_URL contain characters gcloud would otherwise mis-split. Only include keys that
# are actually set (non-empty) in the env file.
pairs=""
set_keys=""
for key in "${KEYS[@]}"; do
  val="${!key:-}"
  if [[ -n "$val" ]]; then
    pairs+="${key}=${val}|"
    set_keys+="${key} "
  fi
done

if [[ -z "$pairs" ]]; then
  echo "No recognized keys with values found in $ENV_FILE — nothing to set." >&2
  exit 1
fi

pairs="${pairs%|}" # strip trailing delimiter

echo "Setting on ${SERVICE} (${ENVIRONMENT}): ${set_keys}"
gcloud run services update "$SERVICE" \
  --project "$PROJECT" --region "$REGION" \
  --update-env-vars "^|^${pairs}"

echo "Done. (${SERVICE} restarts with the new values; check /api/ready.)"
