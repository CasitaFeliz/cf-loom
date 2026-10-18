import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { configFile } from '../config/index.ts';
import { done, type Exit, type Run, toolingError } from './exit.ts';
import {
  configTemplateOf,
  type RootKind,
  rootFileOf,
  rootKinds,
  rootTemplateOf,
} from './templates.ts';

/** A project's package as its package.json names it: the scope, when it has one, and the name. */
type Named =
  | { readonly kind: 'named'; readonly scope: string | undefined; readonly name: string }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * Creates a root that declares nothing yet, and `cf-loom.config.ts` when the project has none; it
 * never overwrites, so a root that exists stops it before anything is written.
 */
export function init({ cwd }: Run, kind = 'service'): Exit {
  if (!isRootKind(kind)) {
    return toolingError(`init takes service, application or definitions: ${kind}`);
  }
  const named = namedOf(cwd);
  if (named.kind === 'failed') {
    return toolingError(named.message);
  }
  const rootFile = rootFileOf(kind);
  if (existsSync(join(cwd, rootFile))) {
    return toolingError(`${rootFile} already exists`);
  }
  const writesConfig = !existsSync(join(cwd, configFile));
  if (writesConfig && named.scope === undefined) {
    return toolingError(`package.json names no scope to write ${configFile} with`);
  }
  writeFile(join(cwd, rootFile), rootTemplateOf(kind, named.name));
  if (writesConfig && named.scope !== undefined) {
    writeFile(join(cwd, configFile), configTemplateOf(named.scope));
  }
  return done(`Created ${rootFile}`);
}

function isRootKind(kind: string): kind is RootKind {
  const kinds: readonly string[] = rootKinds;
  return kinds.includes(kind);
}

/** The package's scope and name from package.json, or why they cannot be read. */
function namedOf(cwd: string): Named {
  const path = join(cwd, 'package.json');
  if (!existsSync(path)) {
    const message = 'package.json not found: init runs next to the package.json of the project';
    return { kind: 'failed', message };
  }
  const name: unknown = parsedOf(readFileSync(path, 'utf8'))?.name;
  if (typeof name !== 'string' || name === '') {
    return { kind: 'failed', message: 'package.json names no package' };
  }
  const [scope, unscoped] = name.startsWith('@') ? name.split('/') : [undefined, name];
  return { kind: 'named', scope, name: unscoped ?? name };
}

function parsedOf(text: string): { readonly name?: unknown } | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function writeFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
