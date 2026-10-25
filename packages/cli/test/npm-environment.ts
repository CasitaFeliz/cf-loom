import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NpmPlace } from '../src/internal/index.ts';
import type { Address } from './fake-registry.ts';

export const token = 'tok-3f9c1a';

/** The environment npm runs with. */
export type NpmEnvironment = NpmPlace['env'];

export type EnvironmentOptions = {
  readonly userConfig?: string;
  readonly path?: string;
  readonly fetchTimeout?: number;
};

export type PlaceOptions = EnvironmentOptions & { readonly projectConfig?: string };

export const { PATH: inheritedPath = '' } = process.env;
const npmSettings = /^npm_config_/i;
const proxySettings = /^(?:https?|all|no)_proxy$/i;

/** Everything of the process environment but npm's own settings and proxies, so no developer configuration reaches a test. */
const inheritedEnvironment = Object.entries(process.env).filter(
  ([name, value]) => value !== undefined && !npmSettings.test(name) && !proxySettings.test(name),
);

/** The user config that scopes `@org` to a registry and logs in there with the lab's token. */
export function loginTo(registry: Address): string {
  return `@org:registry=${registry.url}/\n//${registry.host}/:_authToken=${token}\n`;
}

/** The user config that makes a registry npm's default for every package and logs in there with the lab's token. */
export function defaultLoginTo(registry: Address): string {
  return `registry=${registry.url}/\n//${registry.host}/:_authToken=${token}\n`;
}

/** The environment of an npm whose user config, global config and cache sit in `folder`. */
export function anNpmEnvironment(folder: string, options: EnvironmentOptions): NpmEnvironment {
  writeFileSync(join(folder, 'user.npmrc'), options.userConfig ?? '');
  writeFileSync(join(folder, 'global.npmrc'), '');
  const settings = [
    ['userconfig', join(folder, 'user.npmrc')],
    ['globalconfig', join(folder, 'global.npmrc')],
    ['cache', join(folder, 'cache')],
    ['logs_max', '0'],
    ['update_notifier', 'false'],
    ['fetch_retries', '0'],
    ['fetch_timeout', String(options.fetchTimeout ?? 60_000)],
  ] as const;
  return Object.fromEntries([
    ...inheritedEnvironment,
    ['PATH', options.path ?? inheritedPath],
    ...settings.map(([name, value]) => [`npm_config_${name}`, value]),
  ]);
}

/** A project directory in `folder` that npm runs in, with its environment. */
export function aPlaceIn(folder: string, options: PlaceOptions): NpmPlace {
  const directory = join(folder, 'project');
  mkdirSync(directory);
  writeFileSync(join(directory, 'package.json'), '{"name":"project","version":"0.0.0"}');
  if (options.projectConfig !== undefined) {
    writeFileSync(join(directory, '.npmrc'), options.projectConfig);
  }
  return { directory, env: anNpmEnvironment(folder, options) };
}
