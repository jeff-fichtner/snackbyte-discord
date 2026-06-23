/**
 * Version info for the server (the /api/version endpoint).
 *
 * On a build/deploy the version, commit, and date are injected via environment
 * variables (set by the deploy flow). Locally they fall back to a dev placeholder.
 * Reading from env (not package.json) avoids depending on package.json being present
 * next to the compiled server in dist/.
 *
 * `environment` is reported from APP_ENV when set, else NODE_ENV. This lets a deploy
 * label itself (e.g. APP_ENV=staging) without flipping NODE_ENV away from 'production'
 * — which matters because `isBuild` below keys off NODE_ENV to read the real version.
 * Unset by default, so existing prod (NODE_ENV=production) and local runs are unchanged.
 */
const isBuild = process.env.CI === 'true' || process.env.NODE_ENV === 'production';

export interface VersionInfo {
  number: string;
  commit: string;
  buildDate: string;
  environment: string;
}

export const version: VersionInfo = {
  number: isBuild ? (process.env.APP_VERSION ?? '0.0.0') : '0.0.0-dev',
  commit: process.env.BUILD_GIT_COMMIT ?? 'dev',
  buildDate: process.env.BUILD_DATE ?? 'dev',
  environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development',
};
