/**
 * Runtime configuration, read once from the environment at startup.
 *
 * Single source of truth for values that vary by environment. In production these
 * come from the platform (Cloud Run injects PORT; secrets come from Secret Manager);
 * in local development they can be set in a .env file (loaded by the dev/build scripts).
 *
 * Required values are validated at boot — the process fails fast with a clear message
 * rather than starting in a half-configured state. Secrets are never logged.
 */

/** Reads a required string env var, throwing a clear error if missing/empty. */
function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Reads an optional string env var, returning undefined when unset/empty. */
function optional(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? undefined : value;
}

/** Port the server listens on and the dev proxy targets. */
export const PORT = Number(process.env.PORT ?? 8080);

/** Structured-logging level. */
export const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';

/**
 * Resolve a secret by its reference name. Database rows store a reference (e.g.
 * "clickup_webhook_secret"); the running app resolves it to the value here, so live
 * secret values never live in browsable rows or in source control. The reference name
 * is upper-cased to an env var name (CLICKUP_WEBHOOK_SECRET).
 */
export function resolveSecret(ref: string): string | undefined {
  return optional(ref.toUpperCase());
}

/**
 * Full runtime config. Call once at boot (in the bootstrap) so missing required values
 * fail fast. Kept as a function rather than top-level constants so importing config in
 * tests (which mount the app without a live bot/DB) does not force all secrets to be set.
 */
export function loadConfig() {
  return {
    port: PORT,
    logLevel: LOG_LEVEL,
    discordBotToken: required('DISCORD_BOT_TOKEN'),
    discordAppId: required('DISCORD_APP_ID'),
    discordDevGuildId: optional('DISCORD_DEV_GUILD_ID'),
    databaseUrl: required('DATABASE_URL'),
  };
}

export type AppConfig = ReturnType<typeof loadConfig>;
