import express, { type Express } from 'express';
import { resolve } from 'node:path';
import { registerRoutes } from './routes/index.js';
import { errorHandler } from './core/errors.js';

// The built frontend always lives in dist/ at the app root, regardless of whether
// this file runs from source (dev) or compiled (prod), so resolve it from the
// working directory rather than this file's location.
const distDir = resolve(process.cwd(), 'dist');

/**
 * Builds the Express app: API routes (health, readiness, version, inbound webhooks),
 * the built frontend, and the central error handler. Process startup (listen) and the
 * bot login live in the bootstrap (main.ts), so createApp() stays mountable by tests
 * without a network port or a live gateway.
 */
export function createApp(): Express {
  const app = express();

  // Staging is publicly reachable (it serves exactly like production) but must not be indexed
  // by search engines — otherwise the staging host competes with production as duplicate
  // content. Keyed on APP_ENV, which is set only on the staging deploy, so production emits no
  // header and stays indexable. Registered before any route/static so it covers every response.
  app.use((_req, res, next) => {
    if (process.env.APP_ENV === 'staging') res.set('X-Robots-Tag', 'noindex');
    next();
  });

  registerRoutes(app);

  app.use(express.static(distDir));

  // SPA fallback: serve index.html for any unmatched GET so client routing works.
  // Express 5 requires a named wildcard rather than a bare "*".
  app.get('/*splat', (_req, res) => {
    res.sendFile('index.html', { root: distDir });
  });

  // Central error handler — registered last so it catches errors from every route above.
  app.use(errorHandler);

  return app;
}
