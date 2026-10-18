import { existsSync, globSync } from 'node:fs';
import { join } from 'node:path';
import type { ValidContract } from '@casitafeliz/loom-contract/internal';
import { byCodePoint } from '@casitafeliz/loom-contract/internal';
import { type ExportedAt, exportedOf } from '../loading/index.ts';
import {
  type Handled,
  handledOf,
  handlerFolders,
  handlerMapFile,
  handlerMapTextOf,
  handlerPathOf,
  namedHandlerPathsOf,
  readersFile,
  readersTextOf,
  stubTextOf,
} from '../service-code/index.ts';
import { type Built, type Stopped, snapshotFile, stopped } from './built.ts';
import { toolingError } from './exit.ts';

/**
 * A file a command generates, relative to the project: one regenerated `always`, or a stub
 * written `once`, never over a Handler that exists.
 */
export type GeneratedFile = {
  readonly path: string;
  readonly text: string | Uint8Array;
  readonly written: 'always' | 'once';
};

/** A project as built, valid. */
export type BuiltProject = Extract<Built, { readonly kind: 'built' }>;

/**
 * The files a project regenerates, compared by `verify`: `contract.snapshot.json`, and for a
 * Service its Handler map and readers.
 */
export function regeneratedFilesOf(built: BuiltProject): readonly GeneratedFile[] {
  const snapshotWritten: GeneratedFile = {
    path: snapshotFile,
    text: built.bytes,
    written: 'always',
  };
  if (built.snapshot.kind !== 'service') {
    return [snapshotWritten];
  }
  const handled = handledOf(built.snapshot);
  return [
    snapshotWritten,
    { path: handlerMapFile, text: handlerMapTextOf(handled), written: 'always' },
    { path: readersFile, text: readersTextOf(), written: 'always' },
  ];
}

/** The Handler files the Handler map imports, which must exist. */
export function handlerFilesOf(built: BuiltProject): readonly string[] {
  return built.snapshot.kind === 'service' ? handledOf(built.snapshot).map(handlerPathOf) : [];
}

/**
 * Every Handler file under the Handlers' folders that no declared Endpoint or Guard names, a
 * Retired one still declared included: after a rename, the map would point at a fresh stub.
 */
export function orphanLinesOf(built: BuiltProject): readonly string[] {
  if (built.snapshot.kind !== 'service') {
    return [];
  }
  const named = namedHandlerPathsOf(built.snapshot);
  const present = handlerFolders.flatMap((folder) =>
    globSync(`${folder}**/*.handler.ts`, { cwd: built.project.directory }),
  );
  const orphans = present
    .map((path) => path.split('\\').join('/'))
    .filter((path) => !named.has(path));
  return orphans
    .sort(byCodePoint)
    .map((path) => `${path} names no declared Endpoint or Guard: delete it`);
}

/**
 * The stubs `generate` writes, and a line for every handled Element exported nowhere, which a
 * stub could not import.
 */
export type Stubs = {
  readonly kind: 'stubs';
  readonly stubs: readonly GeneratedFile[];
  readonly unexportedLines: readonly string[];
};

/**
 * The stub of every Handler that does not exist yet, importing its Element from where it is
 * exported, and every handled Element exported nowhere, one line each.
 */
export async function stubsOf(built: BuiltProject): Promise<Stubs | Stopped> {
  if (built.snapshot.kind !== 'service') {
    return { kind: 'stubs', stubs: [], unexportedLines: [] };
  }
  const { directory, packages } = built.project;
  const exported = await exportedOf(directory, packages);
  if (exported.kind === 'failed') {
    return stopped(toolingError(exported.message));
  }
  const located = handledOf(built.snapshot).map(
    (handled): Located => ({
      handled,
      at: exported.exportedAt(declarationOf(built.validated, handled)),
    }),
  );
  const unexported = located.filter((element) => !isExported(element));
  const unexportedLines = unexported.map(({ handled }) => unexportedLineOf(built, handled));
  const missing = located
    .filter(isExported)
    .filter(({ handled }) => !existsSync(join(directory, handlerPathOf(handled))));
  const stubs = missing.map(({ handled, at }) => stubOf(handled, at));
  const sorted = stubs.sort((left, right) => byCodePoint(left.path, right.path));
  return { kind: 'stubs', stubs: sorted, unexportedLines };
}

/** A handled Element and where it is exported, if anywhere. */
type Located = { readonly handled: Handled; readonly at: ExportedAt | undefined };

function isExported(located: Located): located is Located & { readonly at: ExportedAt } {
  return located.at !== undefined;
}

function stubOf(handled: Handled, at: ExportedAt): GeneratedFile {
  return { path: handlerPathOf(handled), text: stubTextOf(handled, at), written: 'once' };
}

/** The declaration a handled Element is, as the root holds it: a Retired Endpoint is never one. */
function declarationOf({ declarations }: ValidContract, handled: Handled): unknown {
  switch (handled.kind) {
    case 'endpoint':
      return declarations.endpoints.find(
        ({ endpoint }) => endpoint.name === handled.name && endpoint.lifecycle !== 'retired',
      )?.endpoint;
    case 'guard':
      return declarations.guards.find(({ guard }) => guard.name === handled.name)?.guard;
  }
}

function unexportedLineOf(built: BuiltProject, handled: Handled): string {
  const where = `${handled.kind}s.${handled.name}`;
  const packageName = handled.kind === 'guard' ? packageOf(built, handled.name) : undefined;
  return packageName === undefined
    ? `${where} is exported by no file under src/contract/`
    : `${where} is not exported by ${packageName}`;
}

/** The listed Definitions Package a Guard comes from, by name; none for the Service's own. */
function packageOf(built: BuiltProject, guardName: string): string | undefined {
  const located = built.validated.declarations.guards.find(({ guard }) => guard.name === guardName);
  const listedIn = located?.listedIn?.definitions;
  return built.project.packages.find(({ definitions }) => definitions === listedIn)?.packageName;
}
