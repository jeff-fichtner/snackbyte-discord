/**
 * Structured logging. One root logger; callers derive child loggers scoped to a
 * subsystem (source, route, command) so every line carries useful context.
 *
 * Secrets, tokens, and full inbound payloads must never appear in logs at normal
 * levels — redaction is configured here, at the logger, rather than relying on every
 * call site to remember. Add new sensitive paths to the redact list as fields appear.
 */
import { pino } from 'pino';
import { LOG_LEVEL } from '../config.js';

export const logger = pino({
  level: LOG_LEVEL,
  redact: {
    paths: [
      'token',
      '*.token',
      'secret',
      '*.secret',
      'signature',
      '*.signature',
      'authorization',
      'req.headers.authorization',
      'headers["x-signature"]',
      'rawBody',
      'payload',
      'raw',
    ],
    censor: '[redacted]',
  },
});

/** A child logger tagged with a subsystem (and optional fields) for traceable lines. */
export function childLogger(subsystem: string, fields: Record<string, unknown> = {}) {
  return logger.child({ subsystem, ...fields });
}
