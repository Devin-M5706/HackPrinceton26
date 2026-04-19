/**
 * POST /api/auth/firebase
 *
 * Frontend completes Firebase Phone Auth (OTP send + verify) entirely client-side,
 * then sends the resulting Firebase ID token here.
 * We verify it with firebase-admin, extract the phone number, look up the CHW,
 * and return the existing bearer token used by all other routes.
 */

import { Router, Request, Response } from 'express';
import { App, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { supabase } from '../lib/supabase';

export const authRouter = Router();

function getFirebaseApp(): App {
  if (getApps().length > 0) return getApps()[0];
  return initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

// ── POST /api/auth/firebase ───────────────────────────────────────────────────

authRouter.post('/firebase', async (req: Request, res: Response) => {
  const { idToken } = req.body as { idToken?: string };

  if (!idToken) {
    res.status(400).json({ error: 'idToken is required' });
    return;
  }

  // Verify the Firebase ID token
  let phone: string;
  try {
    const app = getFirebaseApp();
    const decoded = await getAuth(app).verifyIdToken(idToken);
    if (!decoded.phone_number) {
      res.status(401).json({ error: 'Token does not contain a phone number' });
      return;
    }
    phone = decoded.phone_number;
  } catch (err) {
    console.error('[auth] Firebase token verification failed:', err);
    res.status(401).json({ error: 'Invalid or expired Firebase token' });
    return;
  }

  // In mock mode skip Supabase and return a demo CHW
  if (process.env.MOCK_MODE === 'true') {
    res.json({ token: 'demo', name: 'Demo CHW', region: 'zinder', language: 'english' });
    return;
  }

  // Look up CHW by phone
  let { data: chw, error } = await supabase()
    .from('chws')
    .select('id, name, region, language, auth_token')
    .eq('phone', phone)
    .single();

  // Auto-register on first login
  if (!chw) {
    const token = `chw_${Buffer.from(phone).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24)}`;
    const { data: newChw, error: insertError } = await supabase()
      .from('chws')
      .insert({
        phone,
        name:       `CHW ${phone.slice(-4)}`,
        region:     'unknown',
        language:   'english',
        auth_token: token,
      })
      .select('id, name, region, language, auth_token')
      .single();

    if (insertError || !newChw) {
      console.error('[auth] Auto-register failed:', insertError);
      res.status(500).json({ error: 'Failed to create account' });
      return;
    }
    chw = newChw;
  }

  res.json({
    token:    chw.auth_token,
    name:     chw.name,
    region:   chw.region,
    language: chw.language,
  });
});
