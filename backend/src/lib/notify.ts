/**
 * Outbreak alert delivery.
 *
 * One channel is implemented: WhatsApp via the Meta Cloud API, which allows
 * proactive outbound messages to a health authority without them messaging
 * first.
 *
 * An iMessage channel (Photon Spectrum) was scaffolded here previously but
 * never worked — the subscriber registry was never populated, so every send
 * was a no-op that still reported success to the caller. It has been removed
 * rather than left as a channel that silently drops outbreak alerts.
 */

import { config } from '../config';
import { createLogger, describeError } from './logger';
import type { AlertPayload } from './validation';

const log = createLogger('notify');

export type { AlertPayload };

const WHATSAPP_API_VERSION = 'v21.0';
const SEND_TIMEOUT_MS = 10_000;

/** Human-readable alert text shared by every channel. */
export function buildAlertMessage(payload: AlertPayload): string {
  return (
    `NOMA ALERT: ${payload.case_count} confirmed cases detected within ` +
    `${payload.radius_km}km in ${payload.region}.\n` +
    `Cluster centre: ${payload.center_lat.toFixed(4)}, ${payload.center_lng.toFixed(4)}.\n` +
    `Immediate public health response required. — lumos.health surveillance`
  );
}

/**
 * Send an outbreak alert over the WhatsApp Cloud API.
 *
 * Throws on failure so `dispatchAlertNotifications` can record it. A dropped
 * outbreak alert is an incident, not a warning.
 */
export async function sendWhatsAppAlert(payload: AlertPayload): Promise<void> {
  if (!config.whatsappConfigured) {
    log.warn('WhatsApp is not configured — alert not delivered', {
      region: payload.region,
      case_count: payload.case_count,
    });
    return;
  }

  const response = await fetch(
    `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: config.WHATSAPP_ALERT_TO_NUMBER,
        type: 'text',
        text: { body: buildAlertMessage(payload), preview_url: false },
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    // The body can echo the access token back in an error envelope, so only
    // the status is recorded.
    throw new Error(`WhatsApp Cloud API returned ${response.status}`);
  }

  log.info('WhatsApp alert delivered', {
    region: payload.region,
    case_count: payload.case_count,
  });
}

/**
 * Fire an alert on every configured channel.
 * One channel failing never prevents the others from being attempted.
 */
export async function dispatchAlertNotifications(payload: AlertPayload): Promise<void> {
  const channels: Array<{ name: string; send: Promise<void> }> = [
    { name: 'whatsapp', send: sendWhatsAppAlert(payload) },
  ];

  const results = await Promise.allSettled(channels.map((c) => c.send));

  let delivered = 0;
  results.forEach((result, i) => {
    const name = channels[i]?.name ?? 'unknown';
    if (result.status === 'rejected') {
      log.error(`Channel "${name}" failed`, describeError(result.reason));
    } else {
      delivered += 1;
    }
  });

  if (delivered === 0) {
    log.error('Outbreak alert was not delivered on any channel', {
      region: payload.region,
      case_count: payload.case_count,
    });
  }
}
