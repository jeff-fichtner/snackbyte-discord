/**
 * Loads .env, then runs the TypeScript deploy-commands entry through tsx (registered via
 * `node --import tsx` in the npm script). Keeps the command-registration logic in
 * TypeScript (src/bot/deploy-commands.ts) while this thin wrapper handles env loading.
 */
import './load-env.mjs';
import '../src/bot/deploy-commands.ts';
