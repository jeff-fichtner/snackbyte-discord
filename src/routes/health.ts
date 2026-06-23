import type { Request, Response } from 'express';

/**
 * Liveness endpoint. Returns 200 while the server is running, which is what an uptime
 * check or a platform health probe (e.g. Cloud Run) expects. Extend the payload with
 * real readiness signals as the app grows — database connectivity, dependency checks,
 * a build/version string, etc.
 */
export function health(_req: Request, res: Response): void {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
}
