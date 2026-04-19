import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env') });

import Dedalus from 'dedalus-labs';

const client = new Dedalus({ apiKey: process.env.DEDALUS_API_KEY });

async function main() {
  try {
    const res = await client.chat.completions.create({
      model: 'anthropic/claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: 'Say hello in one word.' }],
      max_tokens: 10,
    });
    console.log('SUCCESS:', res.choices[0].message.content);
  } catch (err: any) {
    console.error('FAILED:', err.status, err.message);
  }
}

main();
