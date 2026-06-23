/**
 * Typed errors and the central HTTP error handler.
 *
 * Each error carries the HTTP status the inbound endpoint should return. A bad
 * signature is a permanent failure (401, do not retry); an unknown source is 404; a
 * dependency being unavailable is transient (503, the sender should retry). The handler
 * maps these consistently and logs with context, never echoing secrets or payloads.
 */
import type { Request, Response, NextFunction } from 'express';
import { logger } from './logger.js';

/** Base class for errors that map to a specific HTTP status. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly publicMessage: string,
    options?: { cause?: unknown },
  ) {
    super(publicMessage, options);
    this.name = new.target.name;
  }
}

/** Request failed authenticity verification — permanent, sender should not retry. */
export class UnauthorizedError extends HttpError {
  constructor(message = 'unauthorized') {
    super(401, message);
  }
}

/** Request addressed a source the hub does not recognize. */
export class UnknownSourceError extends HttpError {
  constructor(message = 'unknown source') {
    super(404, message);
  }
}

/** Request was authentic but its body could not be parsed for this source. */
export class BadPayloadError extends HttpError {
  constructor(message = 'invalid payload') {
    super(400, message);
  }
}

/** A dependency (e.g. the routing store) is unavailable — transient, sender retries. */
export class DependencyUnavailableError extends HttpError {
  constructor(message = 'temporarily unavailable', options?: { cause?: unknown }) {
    super(503, message, options);
  }
}

/**
 * Central Express error middleware. Maps HttpError to its status; anything else is an
 * unexpected 500. Logs with the resolved status; the response body carries only the
 * public message (never internal details).
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express requires the 4-arg signature to recognize this as an error handler.
  _next: NextFunction,
): void {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof HttpError ? err.publicMessage : 'internal error';
  logger.error({ status, err: err instanceof Error ? err.message : String(err) }, 'request error');
  if (res.headersSent) return;
  res.status(status).json({ error: message });
}
