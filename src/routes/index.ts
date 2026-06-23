import type { Express } from 'express';
import { health } from './health.js';
import { getVersion } from './version.js';

/** Mounts the app's API routes. Add new routes here alongside the liveness check. */
export function registerRoutes(app: Express): void {
  app.get('/api/health', health);
  app.get('/api/version', getVersion);
}
