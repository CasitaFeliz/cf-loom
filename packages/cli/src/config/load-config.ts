import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { importedModuleOf, thrownLineOf } from '../loading/index.ts';
import type { Config } from './config.ts';

/** The file the tools are configured in, next to the project's package.json. */
export const configFile = 'cf-loom.config.ts';

/** An npm scope, as a Contract Package's and a Definitions Package's names start with. */
const scopePattern = /^@[a-z0-9][a-z0-9._~-]*$/;

/** The configuration of the project in a directory, or why it is missing or wrong. */
export type LoadedConfig =
  | { readonly kind: 'loaded'; readonly config: Config }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * Loads `cf-loom.config.ts` from `directory` and checks what every command needs, since a cast or
 * a plain object skips `defineConfig`'s types.
 */
export async function loadConfig(directory: string): Promise<LoadedConfig> {
  const path = join(directory, configFile);
  if (!existsSync(path)) {
    return failed(`${configFile} not found: run cf-loom init`);
  }
  const imported = await importedModuleOf(path, directory);
  if (imported.kind === 'failed') {
    return failed(`${configFile} cannot be loaded: ${imported.message}`);
  }
  const config = imported.exports['config'];
  if (typeof config !== 'object' || config === null) {
    return failed(`${configFile} exports no config: export const config = defineConfig({ … })`);
  }
  try {
    return scopedConfigOf(Reflect.get(config, 'scope'));
  } catch (e) {
    return failed(`${configFile} threw while it was read: ${thrownLineOf(e, directory)}`);
  }
}

function scopedConfigOf(scope: unknown): LoadedConfig {
  if (typeof scope !== 'string' || !scopePattern.test(scope)) {
    return failed(`${configFile}: scope is required, an npm scope such as '@org'`);
  }
  return { kind: 'loaded', config: { scope } };
}

function failed(message: string): LoadedConfig {
  return { kind: 'failed', message };
}
