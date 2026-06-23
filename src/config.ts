/**
 * Runtime configuration, read from the environment.
 *
 * Single source of truth for values that vary by environment. In production these
 * come from the platform (e.g. Cloud Run injects PORT); in local development they
 * can be set in a .env file (loaded by the dev/build scripts).
 */

/** Port the server listens on and the dev proxy targets. */
export const PORT = Number(process.env.PORT ?? 8080);
