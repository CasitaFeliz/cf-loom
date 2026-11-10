import { join } from 'node:path';
import type { BrokerPlan } from '@cf-loom/messaging/jetstream';
import { runProcess } from '../../../packages/messaging/test/test-process.ts';

/** The plan `cf-loom broker-plan --json --prefix <prefix>` prints for the Service in `serviceDir`. */
export async function planOf(serviceDir: string, prefix: string): Promise<BrokerPlan> {
  const bin = join(serviceDir, 'node_modules/@cf-loom/cli/dist/bin.js');
  const ran = await runProcess(
    process.execPath,
    [bin, 'broker-plan', '--json', '--prefix', prefix],
    {
      cwd: serviceDir,
      env: {},
    },
  );
  if (ran.status !== 0) {
    throw new Error(`cf-loom broker-plan failed in ${serviceDir}: ${ran.stderr}`);
  }
  return JSON.parse(ran.stdout).plan;
}
