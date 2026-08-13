/**
 * Validated application configuration.
 *
 * Every environment variable the server reads is declared here and parsed once
 * at import time. Routes and libraries import `config` rather than touching
 * `process.env`, so a missing or malformed variable fails fast at boot with a
 * readable message instead of surfacing as `undefined` deep in a request.
 */

import { config as loadDotenv } from 'dotenv';
import { resolve } from 'path';
import { z } from 'zod';

// Load .env from the repository root, then from backend/ as an override.
loadDotenv({ path: resolve(__dirname, '../../.env') });
loadDotenv({ path: resolve(__dirname, '../.env'), override: true });

const boolish = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  /**
   * Serves canned triage results and accepts the demo token. Never enable in
   * production — the guard below rejects that combination outright.
   */
  MOCK_MODE: boolish,

  /**
   * Comma-separated list of allowed browser origins. Required in production;
   * we refuse to fall back to `*` because every route is credentialed.
   */
  CORS_ORIGINS: csv,

  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  DEDALUS_API_KEY: z.string().min(1).optional(),
  DEDALUS_DCS_URL: z.string().url().default('https://dcs.dedaluslabs.ai'),
  DEDALUS_MODEL: z.string().min(1).default('anthropic/claude-haiku-4-5-20251001'),

  FIREBASE_PROJECT_ID: z.string().min(1).optional(),
  FIREBASE_CLIENT_EMAIL: z.string().min(1).optional(),
  FIREBASE_PRIVATE_KEY: z.string().min(1).optional(),

  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1).optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1).optional(),
  WHATSAPP_ALERT_TO_NUMBER: z.string().min(1).optional(),

  /**
   * Shared secret for machine-to-machine calls: the surveillance VM uses it to
   * post alerts back, and operators use it to start the VM. Must be long enough
   * that guessing is impractical.
   */
  ORCHESTRATOR_URL: z.string().url().optional(),
  ORCHESTRATOR_INTERNAL_SECRET: z.string().min(32).optional(),

  /** Largest decoded screening image accepted, in bytes. */
  MAX_IMAGE_BYTES: z.coerce.number().int().positive().default(8 * 1024 * 1024),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const config = Object.freeze({
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',

  supabaseConfigured: Boolean(
    parsed.data.SUPABASE_URL && parsed.data.SUPABASE_SERVICE_ROLE_KEY,
  ),
  firebaseConfigured: Boolean(
    parsed.data.FIREBASE_PROJECT_ID &&
      parsed.data.FIREBASE_CLIENT_EMAIL &&
      parsed.data.FIREBASE_PRIVATE_KEY,
  ),
  whatsappConfigured: Boolean(
    parsed.data.WHATSAPP_PHONE_NUMBER_ID &&
      parsed.data.WHATSAPP_ACCESS_TOKEN &&
      parsed.data.WHATSAPP_ALERT_TO_NUMBER,
  ),
  dedalusConfigured: Boolean(parsed.data.DEDALUS_API_KEY),
});

export type Config = typeof config;

// ── Production guard rails ───────────────────────────────────────────────────
//
// These combinations are safe in local development but would be a live
// incident in production, so they are rejected at boot rather than logged.

if (config.isProduction) {
  const fatal: string[] = [];

  if (config.MOCK_MODE) {
    fatal.push('MOCK_MODE must be false in production (it bypasses real triage).');
  }
  if (!config.supabaseConfigured) {
    fatal.push('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production.');
  }
  if (config.CORS_ORIGINS.length === 0) {
    fatal.push('CORS_ORIGINS must list at least one origin in production.');
  }
  if (config.CORS_ORIGINS.includes('*')) {
    fatal.push('CORS_ORIGINS may not contain "*" — every route is credentialed.');
  }
  if (!config.dedalusConfigured) {
    fatal.push('DEDALUS_API_KEY is required in production.');
  }
  if (!config.firebaseConfigured) {
    fatal.push('Firebase service-account credentials are required in production.');
  }
  if (!config.ORCHESTRATOR_INTERNAL_SECRET) {
    fatal.push('ORCHESTRATOR_INTERNAL_SECRET is required in production.');
  }

  if (fatal.length > 0) {
    throw new Error(
      `Refusing to start in production:\n${fatal.map((m) => `  - ${m}`).join('\n')}`,
    );
  }
}
