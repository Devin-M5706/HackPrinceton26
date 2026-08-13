/**
 * Minimal structured logger.
 *
 * Emits one JSON object per line in production so log aggregators can parse it,
 * and a compact human-readable line in development. Deliberately dependency-free.
 *
 * Never pass patient data (images, clinical notes, coordinates) to the logger —
 * see `redact` for the field names that are stripped defensively.
 */

import { config } from '../config';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type LogLevel = keyof typeof LEVELS;

const threshold = LEVELS[config.LOG_LEVEL];

/** Field names whose values are replaced before anything reaches the log sink. */
const SENSITIVE_KEYS = new Set([
  'image_b64',
  'imageB64',
  'authorization',
  'auth_token',
  'authToken',
  'token',
  'idToken',
  'apiKey',
  'api_key',
  'password',
  'secret',
  'privateKey',
  'clinical_note',
  'referral_note',
  'phone',
  'lat',
  'lng',
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEYS.has(key) ? '[redacted]' : redact(val, depth + 1);
  }
  return out;
}

function emit(level: LogLevel, scope: string, message: string, meta?: unknown): void {
  if (LEVELS[level] < threshold) return;

  const safeMeta = meta === undefined ? undefined : redact(meta);

  if (config.isProduction) {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      scope,
      message,
      ...(safeMeta !== undefined ? { meta: safeMeta } : {}),
    });
    (level === 'error' ? console.error : console.log)(line);
    return;
  }

  const suffix = safeMeta === undefined ? '' : ` ${JSON.stringify(safeMeta)}`;
  (level === 'error' ? console.error : console.log)(
    `[${level}] [${scope}] ${message}${suffix}`,
  );
}

export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

/** Create a logger bound to a scope, e.g. `createLogger('screen')`. */
export function createLogger(scope: string): Logger {
  return {
    debug: (m, meta) => emit('debug', scope, m, meta),
    info: (m, meta) => emit('info', scope, m, meta),
    warn: (m, meta) => emit('warn', scope, m, meta),
    error: (m, meta) => emit('error', scope, m, meta),
  };
}

/**
 * Normalise an unknown thrown value into something safe to log.
 * Stack traces are included outside production only.
 */
export function describeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      ...(config.isProduction ? {} : { stack: err.stack }),
    };
  }
  return { message: String(err) };
}
