import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { rootNameProblemOf } from '@cf-loom/contract/internal';
import {
  oneLineOf,
  type PackageName,
  projectPackageOf,
  type RootKind,
  rootFiles,
  rootPlaces,
} from '../loading/index.ts';
import type { Run } from '../project/index.ts';
import { done, type Exit, toolingError } from './exit.ts';
import { attributesToAppendOf, gitAttributesFile } from './git-attributes.ts';
import { rootTemplateOf } from './templates.ts';

/** What `init` appends to `.gitattributes`, and the bytes the file held before, if it existed. */
type Appended = { readonly text: string; readonly original: Buffer | undefined };

/** What `init` writes: the root, and the lines it appends to `.gitattributes`, if it lacks any. */
type Planned = {
  readonly kind: 'planned';
  readonly root: { readonly path: string; readonly text: string };
  readonly attributes: Appended | undefined;
};

type Refused = { readonly kind: 'refused'; readonly message: string };

/**
 * Creates a root that declares nothing yet, and makes `.gitattributes` keep the line endings of
 * the files `generate` writes. It checks every target before writing and never overwrites, so it
 * writes everything or nothing; a `.gitattributes` it finds only gets the lines it lacks.
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
  const failure = writeAll(cwd, planned);
  if (failure !== undefined) {
    return toolingError(`init cannot write: ${failure}`);
  }
  return done(writtenLinesOf(planned));
}

function writtenLinesOf({ root, attributes }: Planned): readonly string[] {
  const created = [`Created ${root.path}`];
  if (attributes === undefined) {
    return created;
  }
  return [
    ...created,
    `${attributes.original === undefined ? 'Created' : 'Updated'} ${gitAttributesFile}`,
  ];
}

/** What `init` would write, or the first target that stops it. */
function plannedOf(cwd: string, kind: RootKind, packageName: PackageName): Planned | Refused {
  const existing = rootFiles.find((file) => existsSync(join(cwd, file)));
  if (existing !== undefined) {
    return refused(`${existing} already exists`);
  }
  const { file } = rootPlaces[kind];
  const blocking = foldersOf(file).find((folder) => isNoFolder(join(cwd, folder)));
  if (blocking !== undefined) {
    return refused(`${blocking} is no folder: init cannot write ${file}`);
  }
  const problem = rootNameProblemOf(kind, packageName.name);
  if (problem !== undefined) {
    return refused(`package.json names "${packageName.name}", but ${problem}: rename the package`);
  }
  const attributes = attributesOf(cwd);
  if (attributes.kind === 'refused') {
    return attributes;
  }
  const root = { path: file, text: rootTemplateOf(kind, packageName.name) };
  return { kind: 'planned', root, attributes: attributes.appended };
}

function refused(message: string): Refused {
  return { kind: 'refused', message };
}

/** The lines `.gitattributes` lacks, or why it cannot be read. */
function attributesOf(
  cwd: string,
): { readonly kind: 'read'; readonly appended: Appended | undefined } | Refused {
  let original: Buffer | undefined;
  try {
    original = readFileSync(join(cwd, gitAttributesFile));
  } catch (e) {
    if (!(e instanceof Error && 'code' in e && e.code === 'ENOENT')) {
      return refused(`${gitAttributesFile} cannot be read: ${oneLineOf(e, cwd)}`);
    }
  }
  const text = attributesToAppendOf(original?.toString('utf8'));
  return { kind: 'read', appended: text === undefined ? undefined : { text, original } };
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
 * Writes the root, then appends to `.gitattributes`; on a failure removes the root and the
 * folders it created, innermost first, puts back the bytes `.gitattributes` held, and says why.
 */
function writeAll(cwd: string, { root, attributes }: Planned): string | undefined {
  const created: string[] = [];
  try {
    const folders = foldersOf(root.path).filter((folder) => !existsSync(join(cwd, folder)));
    created.push(...folders);
    mkdirSync(dirname(join(cwd, root.path)), { recursive: true });
    writeFileSync(join(cwd, root.path), root.text, { flag: 'wx' });
    created.push(root.path);
    if (attributes !== undefined) {
      appendAttributes(cwd, attributes);
    }
    return undefined;
  } catch (e) {
    for (const path of created.reverse()) {
      rmSync(join(cwd, path), { force: true, recursive: true });
    }
    return oneLineOf(e, cwd);
  }
}

/** Appends to `.gitattributes`, the last write of `init`; a file that was there is written back as it was if the append fails. */
function appendAttributes(cwd: string, { text, original }: Appended): void {
  const path = join(cwd, gitAttributesFile);
  try {
    appendFileSync(path, text);
  } catch (e) {
    restoreFile(path, original);
    throw e;
  }
}

/** Puts back the bytes a file held, or removes a file `init` was creating; a file that cannot be written has not changed. */
function restoreFile(path: string, original: Buffer | undefined): void {
  try {
    if (original === undefined) {
      rmSync(path, { force: true });
    } else {
      writeFileSync(path, original);
    }
  } catch {
    return;
  }
}
