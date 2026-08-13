/**
 * Destroy every Dedalus machine on the account.
 *
 * Orphaned VMs bill by the hour, and a crashed process leaves them running.
 * Run with `npm run cleanup:vms`.
 *
 * Destructive: this deletes ALL machines the API key can see, not just ones
 * this project created. Requires --yes to proceed.
 */

import '../src/config';
import { destroyAllVms, listVms } from '../src/lib/dedalus';

async function main(): Promise<void> {
  const ids = await listVms();

  if (ids.length === 0) {
    console.log('No machines found.');
    return;
  }

  console.log(`Found ${ids.length} machine(s):`);
  for (const id of ids) console.log(`  ${id}`);

  if (!process.argv.includes('--yes')) {
    console.log('\nRe-run with --yes to destroy all of them.');
    return;
  }

  await destroyAllVms();
  console.log('Done.');
}

main().catch((err: unknown) => {
  console.error('Cleanup failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
