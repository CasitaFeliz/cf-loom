import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import { aDeadAddress } from './dead-address.ts';

/**
 * Every test of this package runs the CLI with the environment it inherits from here: an npm whose
 * registry is an address nothing listens on, that is offline, and that reads no npmrc of its
 * user's. So no test can reach a real registry or use a login, whichever helper starts the CLI;
 * a test that needs a registry gives the CLI its own environment, as the lab does.
 */
const folder = mkdtempSync(join(tmpdir(), 'cf-loom-no-registry-'));
const userConfig = join(folder, 'user.npmrc');
const globalConfig = join(folder, 'global.npmrc');
writeFileSync(userConfig, '');
writeFileSync(globalConfig, '');
const dead = await aDeadAddress();

const npmSettings = /^npm_config_/i;
const proxySettings = /^(?:https?|all|no)_proxy$/i;
for (const name of Object.keys(process.env)) {
  if (npmSettings.test(name) || proxySettings.test(name)) {
    delete process.env[name];
  }
}
const settings = [
  ['registry', `${dead.url}/`],
  ['offline', 'true'],
  ['userconfig', userConfig],
  ['globalconfig', globalConfig],
  ['cache', join(folder, 'cache')],
  ['fetch_retries', '0'],
] as const;
for (const [name, value] of settings) {
  process.env[`npm_config_${name}`] = value;
}

afterAll(() => {
  dead.release();
  rmSync(folder, { recursive: true, force: true });
});
