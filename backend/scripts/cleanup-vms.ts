import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env') });

const DCS_BASE = 'https://dcs.dedaluslabs.ai';
const API_KEY = process.env.DEDALUS_API_KEY!;

const STALE_IDS = [
  'dm-019da301-b055-7a1a-b629-28d1d4834948',
  'dm-019da301-b08a-7e9d-8930-9b4de394391d',
  'dm-019da301-b070-7c23-96da-bc49e5e61567',
  'dm-019da301-b06c-7ddd-814a-f1746cac2f66',
  'dm-019da323-6c9f-7231-9901-f74115ba16b6',
];

async function main() {
  for (const id of STALE_IDS) {
    // GET the machine to retrieve its ETag
    const getRes = await fetch(`${DCS_BASE}/v1/machines/${id}`, {
      headers: { 'x-api-key': API_KEY },
    });
    if (!getRes.ok) {
      console.log(`GET ${id} → ${getRes.status} (skipping)`);
      continue;
    }
    const rawEtag = getRes.headers.get('etag') ?? getRes.headers.get('ETag') ?? '';
    const etag = rawEtag.replace(/^W\//, '');
    console.log(`GET ${id} → etag: ${etag}`);

    const delRes = await fetch(`${DCS_BASE}/v1/machines/${id}`, {
      method: 'DELETE',
      headers: {
        'x-api-key': API_KEY,
        'Idempotency-Key': crypto.randomUUID(),
        'If-Match': etag,
      },
    });
    const body = await delRes.text();
    console.log(`DELETE ${id} → ${delRes.status}: ${body}`);
  }
}

main();
