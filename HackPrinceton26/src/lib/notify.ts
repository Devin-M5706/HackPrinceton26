/**
 * Outbreak notification dispatcher.
 *
 * Channels:
 *   1. WhatsApp Business — Meta Cloud API (proactive, no user-initiation required)
 *   2. iMessage — Photon Spectrum (subscription-based: health authority texts the
 *      Photon bot number once to subscribe; alerts are then pushed automatically)
 *
 * Required env vars:
 *   WhatsApp:
 *     WHATSAPP_PHONE_NUMBER_ID   — sender phone number ID from Meta Business dashboard
 *     WHATSAPP_ACCESS_TOKEN      — permanent system-user access token
 *     WHATSAPP_ALERT_TO_NUMBER   — recipient phone number with country code (e.g. +12345678901)
 *
 *   iMessage (Photon Spectrum):
 *     PHOTON_PROJECT_ID          — project ID from app.photon.codes
 *     PHOTON_PROJECT_SECRET      — project secret from app.photon.codes
 *
 * iMessage subscription flow:
 *   1. Health authority texts any message to your Photon iMessage bot number.
 *   2. The listener below catches it, registers their space, and confirms subscription.
 *   3. All subsequent outbreak alerts are pushed into that space automatically.
 *   4. Spaces survive for the lifetime of the Node.js process (VM 4 stays alive indefinitely).
 */

import { Spectrum } from 'spectrum-ts';
import { imessage } from 'spectrum-ts/providers/imessage';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AlertPayload {
  region: string;
  case_count: number;
  radius_km: number;
  center_lat: number;
  center_lng: number;
}

// Minimal structural type for a Spectrum Space — avoids relying on exported types
// that may shift between preview releases of spectrum-ts.
type SpectrumSpace = { send: (msg: string) => Promise<void> };

// ── iMessage subscriber registry ──────────────────────────────────────────────
// Keyed by sender ID so each subscriber gets exactly one entry.
// Map survives for the lifetime of the process (VM 4 / long-lived server).

const _subscribers = new Map<string, SpectrumSpace>();
let _spectrumApp: Awaited<ReturnType<typeof Spectrum>> | null = null;
let _spectrumStarted = false;

/**
 * Start the Photon Spectrum iMessage listener.
 * Safe to call multiple times — only initialises once.
 *
 * When a health authority texts any message to the bot number,
 * their space is registered and they receive a confirmation reply.
 */
export async function startPhotonListener(): Promise<void> {
  if (_spectrumStarted) return;
  _spectrumStarted = true;

  const projectId = process.env.PHOTON_PROJECT_ID;
  const projectSecret = process.env.PHOTON_PROJECT_SECRET;

  if (!projectId || !projectSecret) {
    console.log('[notify] PHOTON_PROJECT_ID / PHOTON_PROJECT_SECRET not set — iMessage alerts disabled');
    return;
  }

  try {
    _spectrumApp = await Spectrum({
      projectId,
      projectSecret,
      providers: [imessage.config()],
    });

    console.log('[notify] Photon Spectrum iMessage listener started');

    // Process incoming messages in the background — never blocks the server.
    (async () => {
      if (!_spectrumApp) return;
      for await (const [space, message] of _spectrumApp.messages) {
        const senderId: string = (message.sender as { id: string }).id ?? 'unknown';
        const key = `imessage:${senderId}`;

        if (!_subscribers.has(key)) {
          _subscribers.set(key, space as unknown as SpectrumSpace);
          console.log(`[notify] iMessage subscriber registered: ${senderId}`);
          await space.send(
            '✅ You are now subscribed to NomaAlert outbreak alerts. ' +
            'You will automatically receive a message whenever a Noma cluster ' +
            'is detected in your region. Reply STOP at any time to unsubscribe.',
          );
        } else if (
          typeof message.content === 'object' &&
          (message.content as { text?: string }).text?.trim().toUpperCase() === 'STOP'
        ) {
          _subscribers.delete(key);
          await space.send('You have been unsubscribed from NomaAlert alerts.');
          console.log(`[notify] iMessage subscriber removed: ${senderId}`);
        }
      }
    })().catch((err: Error) =>
      console.error('[notify] Photon Spectrum listener error:', err.message),
    );
  } catch (err) {
    console.error('[notify] Failed to start Photon Spectrum:', err);
  }
}

export function iMessageSubscriberCount(): number {
  return _subscribers.size;
}

// ── WhatsApp Cloud API (Meta) ─────────────────────────────────────────────────

/**
 * Send an outbreak alert via the Meta WhatsApp Cloud API.
 *
 * This is a proactive (outbound) send — no prior user message needed.
 * Uses a plain text message; upgrade to a pre-approved template if Meta
 * enforces template-only sending on your number tier.
 */
export async function sendWhatsAppAlert(payload: AlertPayload): Promise<void> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const toNumber = process.env.WHATSAPP_ALERT_TO_NUMBER;

  if (!phoneNumberId || !accessToken || !toNumber) {
    console.warn('[notify] WhatsApp not configured (missing env vars) — skipping');
    return;
  }

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toNumber,
        type: 'text',
        text: {
          body: buildAlertMessage(payload),
          preview_url: false,
        },
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WhatsApp Cloud API ${res.status}: ${body}`);
  }

  console.log('[notify] WhatsApp alert sent successfully');
}

// ── iMessage via Photon Spectrum ──────────────────────────────────────────────

/**
 * Push an outbreak alert to all registered iMessage subscribers.
 * No-op (with a warning) if no subscribers are registered yet.
 */
export async function sendIMessageAlert(payload: AlertPayload): Promise<void> {
  if (_subscribers.size === 0) {
    console.warn('[notify] No iMessage subscribers registered — skipping iMessage alert');
    return;
  }

  const msg = buildAlertMessage(payload);

  const sends = Array.from(_subscribers.entries()).map(async ([key, space]) => {
    try {
      await space.send(msg);
    } catch (err) {
      console.error(`[notify] iMessage send failed for ${key}:`, (err as Error).message);
    }
  });

  await Promise.all(sends);
  console.log(`[notify] iMessage alert pushed to ${_subscribers.size} subscriber(s)`);
}

// ── Dispatch all configured channels ─────────────────────────────────────────

/**
 * Fire outbreak alerts on every configured notification channel.
 * Failures on one channel never block the other.
 */
export async function dispatchAlertNotifications(payload: AlertPayload): Promise<void> {
  const results = await Promise.allSettled([
    sendWhatsAppAlert(payload),
    sendIMessageAlert(payload),
  ]);

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[notify] Notification channel error:', (result.reason as Error).message);
    }
  }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

export function buildAlertMessage(payload: AlertPayload): string {
  return (
    `🚨 NOMA ALERT: ${payload.case_count} confirmed cases detected within ` +
    `${payload.radius_km}km in ${payload.region}.\n` +
    `Cluster center: ${payload.center_lat.toFixed(4)}°N, ${payload.center_lng.toFixed(4)}°E.\n` +
    `Immediate public health response required. — NomaAlert surveillance system`
  );
}
