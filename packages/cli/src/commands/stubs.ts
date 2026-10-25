import { byCodePoint, isLive } from '@cf-loom/contract/internal';
import type { ExportsOf } from '../loading/index.ts';
import {
  type DeclarationHandled,
  elementLabelOf,
  exportedTargetOf,
  type Handled,
  type HandlerPath,
  pairingTargetOf,
  type StubTarget,
  stubTextOf,
} from '../service-code/index.ts';
import type { GeneratedFile } from '../writing/index.ts';
import { locatedUnderOf } from './exported-declarations.ts';
import type { PlacedService } from './handler-files.ts';

/**
 * The stubs `generate` writes, and a line for every Endpoint and Guard a stub could not import as
 * it is named.
 */
export type Stubs = {
  readonly stubs: readonly GeneratedFile[];
  readonly failureLines: readonly string[];
};

/** What a Handler's stub passes to `handle.stub`, or why it cannot be written. */
type StubLocated =
  | { readonly kind: 'exported'; readonly target: StubTarget }
  | { readonly kind: 'refused'; readonly line: string };

/** A handled Element located, with the path its Handler is written at. */
type LocatedHandler = StubLocated & { readonly path: string };

/** The stub of every Handler that lacks a file, importing its Element as it is named. */
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
 * Where a stub imports what its Handler is written for: an Endpoint or Guard where it is exported,
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
  const located = locatedUnderOf(elementLabelOf(handled), handled.name, exportsOf(declaration));
  if (located.kind === 'refused') {
    return located;
  }
  return { kind: 'exported', target: exportedTargetOf(located.at) };
}

/** A Definitions Package's Guard, imported from the package's `.` entry under its name. */
function packageExportOf(
  handled: DeclarationHandled,
  { packageName, exports, guard }: PackagedGuard,
): StubLocated {
  if (exports[handled.name] === guard) {
    const imported = { kind: 'package', packageName, name: handled.name } as const;
    return { kind: 'exported', target: exportedTargetOf(imported) };
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
function packageOf(service: PlacedService, handled: DeclarationHandled): PackagedGuard | undefined {
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
