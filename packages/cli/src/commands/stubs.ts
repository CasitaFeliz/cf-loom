import { byCodePoint, exportNamesOf, isLive } from '@cf-loom/contract/internal';
import type { ExportsOf, ImportedPackage } from '../loading/index.ts';
import {
  type DeclarationHandled,
  exportedTargetOf,
  type Handled,
  type HandlerPath,
  handledLabelOf,
  pairingTargetOf,
  type StubTarget,
  stubTextOf,
} from '../service-code/index.ts';
import type { GeneratedFile } from '../writing/index.ts';
import { exportedAtOf } from './exported-declarations.ts';
import type { PlacedService } from './handler-files.ts';

/**
 * The Stubs `generate` writes, and a line for every Endpoint and Guard that nothing exports for a
 * Stub to import.
 */
export type Stubs = {
  readonly stubs: readonly GeneratedFile[];
  readonly failureLines: readonly string[];
};

/** What a Handler's Stub passes to `handle.stub`, or why it cannot be written. */
type StubLocated =
  | { readonly kind: 'exported'; readonly target: StubTarget }
  | { readonly kind: 'refused'; readonly line: string };

/** A declaration that has a Handler, located, with the path its Handler is written at. */
type LocatedHandler = StubLocated & { readonly path: string };

/** The Stub of every Handler that lacks a file, importing its declaration under its name. */
export function stubsOf(
  service: PlacedService,
  exportsOf: ExportsOf,
  lacking: readonly HandlerPath[],
): Stubs {
  const located = service.handlerPaths.map((placed) =>
    locatedHandlerOf(service, placed, exportsOf),
  );
  const lackingPaths = new Set(lacking.map(({ path }) => path));
  const missing = located.filter(hasExport).filter(({ path }) => lackingPaths.has(path));
  const stubs = missing.map(stubOf);
  const failureLines = located.filter(isRefused).map(({ line }) => line);
  const sorted = stubs.sort((left, right) => byCodePoint(left.path, right.path));
  return { stubs: sorted, failureLines };
}

function locatedHandlerOf(
  service: PlacedService,
  { handled, path }: HandlerPath,
  exportsOf: ExportsOf,
): LocatedHandler {
  return { ...locatedOf(service, handled, exportsOf), path };
}

/**
 * Where a Stub imports what its Handler is written for: an Endpoint or Guard where it is exported,
 * a Command's Message Version or Subscription from the readers, which pair it with its Reader.
 */
function locatedOf(service: PlacedService, handled: Handled, exportsOf: ExportsOf): StubLocated {
  switch (handled.kind) {
    case 'endpoint':
    case 'guard':
      return declarationLocatedOf(service, handled, exportsOf);
    case 'command':
    case 'subscription': {
      const target = pairingTargetOf(handled, service.project.layout.readers);
      return { kind: 'exported', target };
    }
  }
}

function declarationLocatedOf(
  service: PlacedService,
  handled: DeclarationHandled,
  exportsOf: ExportsOf,
): StubLocated {
  const packaged = packageOf(service, handled);
  if (packaged !== undefined) {
    return packageExportOf(handled, packaged);
  }
  const declaration = declarationOf(service, handled);
  const located = exportedAtOf(handledLabelOf(handled), exportsOf(declaration));
  if (located.kind === 'refused') {
    return located;
  }
  return { kind: 'exported', target: exportedTargetOf(located.at, handled.name) };
}

/**
 * A Definitions Package's Guard, imported as the project imports a module that exports it, under
 * its first such export: one of the package's own when the project imports one, else any.
 */
function packageExportOf(
  handled: DeclarationHandled,
  { packageName, modules, guard }: PackagedGuard,
): StubLocated {
  for (const { specifier, exports } of modules) {
    const [exportName] = exportNamesOf(exports, guard);
    if (exportName !== undefined) {
      const imported = { kind: 'package', specifier, name: exportName } as const;
      return { kind: 'exported', target: exportedTargetOf(imported, handled.name) };
    }
  }
  const nowhere = "is exported by no package the Contract's files import";
  return {
    kind: 'refused',
    line: `guards.${handled.name} ${nowhere}: import it from ${packageName}`,
  };
}

/** A Guard a Definitions Package declares, with the modules the project imports, its package's first. */
type PackagedGuard = {
  readonly packageName: string;
  readonly modules: readonly ImportedModule[];
  readonly guard: unknown;
};

/** A module of a package, with the specifier the project's own files import it by. */
type ImportedModule = ImportedPackage & { readonly specifier: string };

/** The Definitions Package a handled Guard belongs to; none for the Service's own. */
function packageOf(service: PlacedService, handled: DeclarationHandled): PackagedGuard | undefined {
  if (handled.kind !== 'guard') {
    return undefined;
  }
  const { project, validated } = service;
  const located = validated.declarations.guards.find(({ guard }) => guard.name === handled.name);
  const from = located?.from;
  if (located === undefined || from === undefined) {
    return undefined;
  }
  const origin = project.imported.find(({ exports }) => exports === from.exports)?.manifestPath;
  const byProject = project.imported
    .filter(isImportedByProject)
    .sort((left, right) => byCodePoint(left.specifier, right.specifier));
  const own = byProject.filter(({ manifestPath }) => manifestPath === origin);
  const others = byProject.filter(({ manifestPath }) => manifestPath !== origin);
  return { packageName: from.packageName, modules: [...own, ...others], guard: located.guard };
}

function isImportedByProject(module: ImportedPackage): module is ImportedModule {
  return module.specifier !== undefined;
}

/** The declaration a handled one is, as the Root holds it: a Retired Endpoint is never one. */
function declarationOf(service: PlacedService, handled: DeclarationHandled): unknown {
  const { declarations } = service.validated;
  switch (handled.kind) {
    case 'endpoint':
      return declarations.endpoints.find(
        ({ endpoint }) => endpoint.name === handled.name && isLive(endpoint),
      )?.endpoint;
    case 'guard':
      return declarations.guards.find(({ guard }) => guard.name === handled.name)?.guard;
  }
}

function stubOf({
  path,
  target,
}: Extract<LocatedHandler, { readonly kind: 'exported' }>): GeneratedFile {
  return { path, text: stubTextOf(path, target), written: 'once' };
}

function hasExport(
  located: LocatedHandler,
): located is Extract<LocatedHandler, { readonly kind: 'exported' }> {
  return located.kind === 'exported';
}

function isRefused(
  located: LocatedHandler,
): located is Extract<LocatedHandler, { readonly kind: 'refused' }> {
  return located.kind === 'refused';
}
