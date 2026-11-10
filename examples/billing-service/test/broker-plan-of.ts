import { join } from 'node:path';
import type { BrokerPlan } from '@cf-loom/messaging/jetstream';
import { runForOutput } from '../../../packages/messaging/test/test-process.ts';

/** The plan `cf-loom broker-plan --json --prefix <prefix>` prints for the Service in `serviceDir`. */
export async function planOf(serviceDir: string, prefix: string): Promise<BrokerPlan> {
  const bin = join(serviceDir, 'node_modules/@cf-loom/cli/dist/bin.js');
  const printed = await runForOutput(
    process.execPath,
    [bin, 'broker-plan', '--json', '--prefix', prefix],
    { cwd: serviceDir, env: {} },
  );
  return JSON.parse(printed).plan;
}
