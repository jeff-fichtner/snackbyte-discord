/**
 * Readiness endpoint. Reflects whether dependencies (routing store reachable, bot
 * connected) are currently usable. Kept separate from liveness: this MAY go 503 during a
 * transient outage, but liveness stays 200 so the platform does not cycle the instance.
 */
import type { Request, Response } from 'express';
import { getReadiness } from '../core/lifecycle.js';

export function ready(_req: Request, res: Response): void {
  const state = getReadiness();
  const ok = state.dbReachable && state.gatewayConnected;
  res.status(ok ? 200 : 503).json({
    ready: ok,
    checks: {
      db: state.dbReachable ? 'ok' : 'down',
      gateway: state.gatewayConnected ? 'ok' : 'down',
    },
  });
}
