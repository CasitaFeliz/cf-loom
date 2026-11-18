import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { joinedOf, wordOf } from '@cf-loom/contract/internal';
import { importedModuleOf, oneLineOf } from '../loading/index.ts';
import { layoutOf, type ServiceLayout } from './layout.ts';

/** The file the tools are configured in, next to the project's package.json. */
export const configFile = 'cf-loom.config.ts';

/** The fields a configuration takes. */
const configFields: readonly string[] = ['layout'];

/**
 * What every command reads of the project's configuration, or why it is wrong. The layout is
 * there only when the configuration sets one.
 */
export type LoadedConfig =
  | {
      readonly kind: 'loaded';
      readonly config: { readonly layout: ServiceLayout | undefined };
    }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * Loads `cf-loom.config.ts` from `directory`, when there is one, and checks what every command
 * needs, since a cast or a plain object skips `defineConfig`'s types.
 */
export async function loadConfig(directory: string): Promise<LoadedConfig> {
  const path = join(directory, configFile);
  if (!existsSync(path)) {
    return { kind: 'loaded', config: { layout: undefined } };
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
    return loadedOf(config);
  } catch (e) {
    return failed(`${configFile} threw while it was read: ${oneLineOf(e, directory)}`);
  }
}

function loadedOf(config: object): LoadedConfig {
  const unknown = Object.keys(config).find((key) => !configFields.includes(key));
  if (unknown !== undefined) {
    const takes = `it takes ${joinedOf(configFields.map(wordOf), 'and')}`;
    return failed(`${configFile}: ${unknown} is no field of the configuration: ${takes}`);
  }
  const written = Reflect.get(config, 'layout');
  if (written === undefined) {
    return { kind: 'loaded', config: { layout: undefined } };
  }
  const layout = layoutOf(written);
  if (layout.kind === 'failed') {
    return failed(`${configFile}: ${layout.message}`);
  }
  return { kind: 'loaded', config: { layout: layout.layout } };
}

function failed(message: string): LoadedConfig {
  return { kind: 'failed', message };
}
