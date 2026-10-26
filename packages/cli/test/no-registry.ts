import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import { aDeadAddress } from './dead-address.ts';
import { isNpmConfiguration, npmSettingsIn } from './npm-environment.ts';

/**
 * Every test of this package runs the CLI with the environment it inherits from here: the npm
 * of `anNpmEnvironment`, with none of its developer's configuration, that is offline and whose
 * registry is an address nothing listens on. So no test can reach a real registry or use a
 * login, whichever helper starts the CLI; a test that needs a registry gives the CLI its own
 * environment, as the lab does.
 */
const folder = mkdtempSync(join(tmpdir(), 'cf-loom-no-registry-'));
const dead = await aDeadAddress();

for (const name of Object.keys(process.env)) {
  if (isNpmConfiguration(name)) {
    delete process.env[name];
  }
}
const settings = [
  ...npmSettingsIn(folder, {}),
  ['npm_config_registry', `${dead.url}/`],
  ['npm_config_offline', 'true'],
];
for (const [name, value] of settings) {
  process.env[name] = value;
}

afterAll(() => {
  dead.release();
  rmSync(folder, { recursive: true, force: true });
});
