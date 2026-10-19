import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { byCodePoint } from '@casitafeliz/loom-contract/internal';
import { contractExportsOf, type ExportedAt, type FileExport } from '../loading/index.ts';
import type { BuiltService, Tooling } from '../project/index.ts';
import { type Handled, handledOf, handlerPathOf, stubTextOf } from '../service-code/index.ts';
import type { GeneratedFile } from '../writing/index.ts';

/**
 * The stubs `generate` writes, and a line for every handled Element a stub could not import as
 * it is named.
 */
export type Stubs = {
  readonly kind: 'stubs';
  readonly stubs: readonly GeneratedFile[];
  readonly failureLines: readonly string[];
};

/** Where a handled Element is exported under its own name, or why it is not. */
type Located =
  | { readonly kind: 'exported'; readonly handled: Handled; readonly at: ExportedAt }
  | { readonly kind: 'refused'; readonly line: string };

/** The stub of every Handler that does not exist yet, importing its Element as it is named. */
export async function stubsOf(service: BuiltService): Promise<Stubs | Tooling> {
  const { directory } = service.project;
  const exports = await contractExportsOf(directory);
  if (exports.kind === 'failed') {
    return { kind: 'tooling', message: exports.message };
  }
  const located = handledOf(service.snapshot).map((handled) =>
    locatedOf(service, handled, exports.exportsOf),
  );
  const missing = located
    .filter(hasExport)
    .filter(({ handled }) => !existsSync(join(directory, handlerPathOf(handled))));
  const stubs = missing.map(({ handled, at }) => stubOf(handled, at));
  const failureLines = located.filter(isRefused).map(({ line }) => line);
  const sorted = stubs.sort((left, right) => byCodePoint(left.path, right.path));
  return { kind: 'stubs', stubs: sorted, failureLines };
}

function locatedOf(
  service: BuiltService,
  handled: Handled,
  exportsOf: (declaration: unknown) => readonly FileExport[],
): Located {
  const where = `${handled.kind}s.${handled.name}`;
  const packaged = packageOf(service, handled);
  if (packaged !== undefined) {
    return packageExportOf(handled, packaged);
  }
  const exports = exportsOf(declarationOf(service, handled));
  const named = exports.find(({ name }) => name === handled.name);
  if (named !== undefined) {
    return { kind: 'exported', handled, at: named };
  }
  const line =
    exports.length === 0
      ? `${where} is exported by no file under src/contract/`
      : `${where} is not exported as ${handled.name}`;
  return { kind: 'refused', line };
}

/** A Definitions Package's Guard, imported from the package's `.` entry under its name. */
function packageExportOf(
  handled: Handled,
  { packageName, exports, guard }: PackagedGuard,
): Located {
  if (exports[handled.name] === guard) {
    return { kind: 'exported', handled, at: { kind: 'package', packageName, name: handled.name } };
  }
  const line = `guards.${handled.name} is not exported as ${handled.name} by ${packageName}`;
  return { kind: 'refused', line };
}

/** A Guard as a listed Definitions Package declares it, with what the package exports. */
type PackagedGuard = {
  readonly packageName: string;
  readonly exports: Readonly<Record<string, unknown>>;
  readonly guard: unknown;
};

/** The listed Definitions Package a handled Guard comes from; none for the Service's own. */
function packageOf(service: BuiltService, handled: Handled): PackagedGuard | undefined {
  if (handled.kind !== 'guard') {
    return undefined;
  }
  const guards = service.validated.declarations.guards;
  const located = guards.find(({ guard }) => guard.name === handled.name);
  const listedIn = located?.listedIn?.definitions;
  const installed = service.project.packages.find(({ definitions }) => definitions === listedIn);
  if (located === undefined || installed === undefined) {
    return undefined;
  }
  return { packageName: installed.packageName, exports: installed.exports, guard: located.guard };
}

/** The declaration a handled Element is, as the root holds it: a Retired Endpoint is never one. */
function declarationOf(service: BuiltService, handled: Handled): unknown {
  const { declarations } = service.validated;
  switch (handled.kind) {
    case 'endpoint':
      return declarations.endpoints.find(
        ({ endpoint }) => endpoint.name === handled.name && endpoint.lifecycle !== 'retired',
      )?.endpoint;
    case 'guard':
      return declarations.guards.find(({ guard }) => guard.name === handled.name)?.guard;
  }
}

function stubOf(handled: Handled, at: ExportedAt): GeneratedFile {
  return { path: handlerPathOf(handled), text: stubTextOf(handled, at), written: 'once' };
}

function hasExport(located: Located): located is Extract<Located, { readonly kind: 'exported' }> {
  return located.kind === 'exported';
}

function isRefused(located: Located): located is Extract<Located, { readonly kind: 'refused' }> {
  return located.kind === 'refused';
}
