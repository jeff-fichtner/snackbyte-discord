#!/usr/bin/env bash
# Push runtime secrets from a local env file to a Cloud Run service — without ever
# printing the values. Use this to set or rotate secrets on prod or staging.
#
# Usage:
#   ./scripts/set-secrets.sh prod        # reads .env.prod     -> snackbyte-discord
#   ./scripts/set-secrets.sh staging     # reads .env.staging  -> snackbyte-discord-staging
#
# The three local env files (all gitignored, chmod 600, never committed):
#   .env         LOCAL DEV — the snackbyte-dev Discord app + the staging database. Loaded by
#                `npm run dev`, `npm run migrate`, `npm run deploy:commands`. This is the DEFAULT,
#                so it is deliberately the harmless one: the worst a careless local command can do
#                is poke dev.
#   .env.staging pushed to the staging Cloud Run service (same dev app + staging DB).
#   .env.prod    pushed to the prod Cloud Run service. Prod credentials live ONLY here and in
#                Cloud Run — never in .env, so no local command defaults to touching prod.
#
# It only pushes the app's config/secrets, LOG_LEVEL included — not PORT (Cloud Run injects it)
# or the build metadata cloudbuild.yaml sets (NODE_ENV/APP_VERSION/BUILD_*/APP_ENV). Missing
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
    # Prod reads its OWN file, never the plain .env. `.env` is the LOCAL DEV environment (the dev
    # Discord app + the staging database), so it is the safe default for `npm run dev` and
    # `deploy:commands`. Pinning prod to .env would make the default local env prod — one careless
    # command away from registering test commands into a live server or writing to prod's database.
    ENV_FILE=".env.prod"
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
