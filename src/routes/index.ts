import express, { type Express } from 'express';
import { health } from './health.js';
import { ready } from './ready.js';
import { getVersion } from './version.js';
import { receiveWebhook } from './webhooks.js';

/**
 * Mounts the app's API routes.
 *
 * Inbound webhooks need the EXACT received bytes for signature verification, so the raw
 * body is captured only on /webhooks/* (other routes keep normal JSON handling). The
 * async route handler is wrapped so thrown/rejected errors reach the central error
 * handler (registered last, in server.ts), which maps typed errors (401/404/400/503).
 */
export function registerRoutes(app: Express): void {
  app.get('/api/health', health);
  app.get('/api/ready', ready);
  app.get('/api/version', getVersion);

  app.post('/webhooks/:source', express.raw({ type: '*/*', limit: '1mb' }), (req, res, next) => {
    Promise.resolve(receiveWebhook(req, res)).catch(next);
  });
}
