/**
 * POST /api/auth/firebase — exchange a Firebase phone-auth ID token for a
 * CHW bearer token.
 *
 * The browser completes the OTP flow with Firebase directly; we only verify
 * the resulting ID token server-side, which is what proves control of the
 * phone number. The bearer token we return is generated here and stored only
 * as a SHA-256 digest, so it is shown to the caller exactly once.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { cert, getApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { config } from '../config';
import { generateToken, hashToken } from '../lib/auth';
import { asyncHandler, serviceUnavailable, unauthorized } from '../lib/errors';
import { createLogger, describeError } from '../lib/logger';
import { supabase } from '../lib/supabase';
import { parseOrThrow } from '../lib/validation';

const log = createLogger('auth');

export const authRouter = Router();

const FIREBASE_APP_NAME = 'lumos-auth';

function firebaseApp(): App {
  const existing = getApps().find((a) => a.name === FIREBASE_APP_NAME);
  if (existing) return getApp(FIREBASE_APP_NAME);

  if (!config.firebaseConfigured) {
    throw serviceUnavailable('Phone sign-in is not configured');
  }

  return initializeApp(
    {
      credential: cert({
        projectId: config.FIREBASE_PROJECT_ID,
        clientEmail: config.FIREBASE_CLIENT_EMAIL,
        // Private keys are stored with literal \n in most secret managers.
        privateKey: config.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    },
    FIREBASE_APP_NAME,
  );
}

const firebaseAuthSchema = z.object({
  idToken: z.string().min(1).max(8192),
});

/** E.164, as returned by Firebase phone auth. */
const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/);

authRouter.post(
  '/firebase',
  asyncHandler(async (req: Request, res: Response) => {
    const { idToken } = parseOrThrow(firebaseAuthSchema, req.body, 'request body');

    // ── Mock mode ────────────────────────────────────────────────────────────
    // No Firebase project is needed to demo the app, but the response is
    // labelled so a caller cannot mistake it for a real session.
    if (config.MOCK_MODE) {
      res.json({
        token: 'demo',
        name: 'Demo CHW',
        region: 'zinder',
        language: 'english',
        role: 'chw',
        mock: true,
      });
      return;
    }

    // ── Verify the Firebase ID token ─────────────────────────────────────────
    let phone: string;
    try {
      // checkRevoked rejects tokens for sessions an admin has since revoked.
      const decoded = await getAuth(firebaseApp()).verifyIdToken(idToken, true);
      if (!decoded.phone_number) {
        throw unauthorized('Token does not contain a phone number');
      }
      phone = parseOrThrow(phoneSchema, decoded.phone_number, 'phone number');
    } catch (err) {
      if (err && typeof err === 'object' && 'status' in err) throw err;
      log.warn('Firebase token verification failed', describeError(err));
      throw unauthorized('Invalid or expired sign-in token');
    }

    const db = supabase();

    // ── Look up or create the CHW ────────────────────────────────────────────
    const { data: existing, error: lookupError } = await db
      .from('chws')
      .select('id, name, region, language, role')
      .eq('phone', phone)
      .maybeSingle();

    if (lookupError) {
      throw new Error(`CHW lookup failed: ${lookupError.message}`);
    }

    // A fresh token is issued on every sign-in, which also means signing in
    // again invalidates a token left on a lost handset.
    const token = generateToken();
    const tokenHash = hashToken(token);

    if (existing) {
      const { error } = await db
        .from('chws')
        .update({ auth_token_hash: tokenHash })
        .eq('id', existing.id);

      if (error) throw new Error(`Token rotation failed: ${error.message}`);

      log.info('CHW signed in', { chw_id: existing.id });
      res.json({
        token,
        name: existing.name,
        region: existing.region,
        language: existing.language,
        role: existing.role,
      });
      return;
    }

    const { data: created, error: insertError } = await db
      .from('chws')
      .insert({
        phone,
        // Last four digits only — enough to recognise your own account without
        // printing a full phone number across every case list.
        name: `CHW ${phone.slice(-4)}`,
        region: 'unknown',
        language: 'english',
        role: 'chw',
        auth_token_hash: tokenHash,
      })
      .select('id, name, region, language, role')
      .single();

    if (insertError || !created) {
      log.error('CHW auto-registration failed', { code: insertError?.code });
      throw new Error('Failed to create account');
    }

    log.info('CHW registered', { chw_id: created.id });
    res.status(201).json({
      token,
      name: created.name,
      region: created.region,
      language: created.language,
      role: created.role,
    });
  }),
);
