import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { configFile } from '../config/index.ts';
import {
  oneLineOf,
  type PackageName,
  projectPackageOf,
  type RootKind,
  rootFiles,
  rootPlaces,
} from '../loading/index.ts';
import { done, type Exit, type Run, toolingError } from './exit.ts';
import { configTemplateOf, rootTemplateOf } from './templates.ts';

/** The files `init` writes, each path relative to the project with its text. */
type Written = readonly { readonly path: string; readonly text: string }[];

/**
 * Creates a root that declares nothing yet, and `cf-loom.config.ts` when the project has none. It
 * checks every target before writing and never overwrites, so it writes everything or nothing.
 */
export function init({ cwd }: Run, kind: RootKind): Exit {
  const projectPackage = projectPackageOf(cwd);
  if (projectPackage.kind === 'failed') {
    return toolingError(projectPackage.message);
  }
  const planned = plannedOf(cwd, kind, projectPackage.packageName);
  if (planned.kind === 'refused') {
    return toolingError(planned.message);
  }
  const failure = writeAll(cwd, planned.written);
  if (failure !== undefined) {
    return toolingError(`init cannot write: ${failure}`);
  }
  return done([`Created ${rootPlaces[kind].file}`]);
}

/** What `init` would write, or the first target that stops it. */
function plannedOf(
  cwd: string,
  kind: RootKind,
  packageName: PackageName,
):
  | { readonly kind: 'planned'; readonly written: Written }
  | { readonly kind: 'refused'; readonly message: string } {
  const existing = rootFiles.find((file) => existsSync(join(cwd, file)));
  if (existing !== undefined) {
    return { kind: 'refused', message: `${existing} already exists` };
  }
  const { file } = rootPlaces[kind];
  const blocking = foldersOf(file).find((folder) => isNoFolder(join(cwd, folder)));
  if (blocking !== undefined) {
    return { kind: 'refused', message: `${blocking} is no folder: init cannot write ${file}` };
  }
  const root = { path: file, text: rootTemplateOf(kind, packageName.name) };
  if (existsSync(join(cwd, configFile))) {
    const refused = { kind: 'refused', message: `${configFile} is no file` } as const;
    return statSync(join(cwd, configFile)).isFile()
      ? { kind: 'planned', written: [root] }
      : refused;
  }
  if (packageName.scope === undefined) {
    return { kind: 'refused', message: `package.json names no scope to write ${configFile} with` };
  }
  const config = { path: configFile, text: configTemplateOf(packageName.scope) };
  return { kind: 'planned', written: [root, config] };
}

/** The folders a file sits in under the project, outermost first. */
function foldersOf(file: string): readonly string[] {
  const parent = dirname(file);
  return parent === '.' ? [] : [...foldersOf(parent), parent];
}

function isNoFolder(path: string): boolean {
  return existsSync(path) && !statSync(path).isDirectory();
}

/**
 * Writes every file in order; on a failure removes the files it wrote and the folders it created,
 * innermost first, and says why.
 */
function writeAll(cwd: string, written: Written): string | undefined {
  const writtenPaths: string[] = [];
  try {
    for (const { path, text } of written) {
      const created = foldersOf(path).filter((folder) => !existsSync(join(cwd, folder)));
      writtenPaths.push(...created);
      mkdirSync(dirname(join(cwd, path)), { recursive: true });
      writeFileSync(join(cwd, path), text, { flag: 'wx' });
      writtenPaths.push(path);
    }
    return undefined;
  } catch (e) {
    for (const path of writtenPaths.reverse()) {
      rmSync(join(cwd, path), { force: true, recursive: true });
    }
    return oneLineOf(e, cwd);
  }
}
