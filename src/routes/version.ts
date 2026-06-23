import type { Request, Response } from 'express';
import { version } from '../version.js';

/** Reports the running build's version info. Useful for confirming what is deployed. */
export function getVersion(_req: Request, res: Response): void {
  res.json(version);
}
