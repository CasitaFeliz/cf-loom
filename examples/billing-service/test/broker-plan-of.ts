import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { BrokerPlan } from '@cf-loom/messaging/jetstream';

/** The plan `cf-loom broker-plan --json --prefix <prefix>` prints for the Service in `serviceDir`. */
export function planOf(serviceDir: string, prefix: string): BrokerPlan {
  const bin = join(serviceDir, 'node_modules/@cf-loom/cli/dist/bin.js');
  const ran = spawnSync(process.execPath, [bin, 'broker-plan', '--json', '--prefix', prefix], {
    cwd: serviceDir,
    encoding: 'utf8',
    env: {},
  });
  if (ran.status !== 0) {
    throw new Error(`cf-loom broker-plan failed in ${serviceDir}: ${ran.stderr}`);
  }
  return JSON.parse(ran.stdout).plan;
}
