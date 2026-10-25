import { readFileSync } from 'node:fs';

/** The CLI running, as its package.json names and versions it. */
export type RunningCli = { readonly name: string; readonly version: string };

/** The CLI running: the one place its package.json is read. */
export function runningCliOf(): RunningCli {
  const manifest: unknown = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  );
  const isObject = typeof manifest === 'object' && manifest !== null;
  const name = isObject ? Reflect.get(manifest, 'name') : undefined;
  const version = isObject ? Reflect.get(manifest, 'version') : undefined;
  return { name: String(name), version: String(version) };
}

/** The CLI running, by its package's name and version, as a Snapshot's `generator` names it. */
export function runningGeneratorOf(): string {
  const { name, version } = runningCliOf();
  return `${name}@${version}`;
}
