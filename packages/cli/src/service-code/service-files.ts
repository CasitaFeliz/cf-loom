import { byCodePoint } from '@cf-loom/contract/internal';
import type { ExportedAt } from '../loading/index.ts';
import {
  defaultImportOf,
  headerOf,
  keyOf,
  moduleTextOf,
  namedImportOf,
  relativeSpecifierOf,
  stringLiteralOf,
} from '../source-text/index.ts';
import { type DeprecationStamp, type Handled, handlerPathOf } from './handled.ts';

/** The file of the Handler map, under the Service's `src/`. */
export const handlerMapFile = 'src/handlers.generated.ts';

/** The file of the Reader schemas of the Service's own Events. */
export const readersFile = 'src/readers.generated.ts';

/**
 * The Handler map: plain data importing each Handler, with the stamps of the Deprecated Endpoints,
 * which `serve` takes as it is.
 */
export function handlerMapTextOf(
  handled: readonly Handled[],
  stamps: readonly DeprecationStamp[],
): string {
  const imports = handled
    .map((element) => ({ local: localNameOf(element), path: handlerPathOf(element) }))
    .map(({ local, path }) => ({ local, specifier: relativeSpecifierOf(handlerMapFile, path) }))
    .sort((left, right) => byCodePoint(left.specifier, right.specifier))
    .map(({ local, specifier }) => defaultImportOf(local, specifier));
  const endpoints = handled.filter((element) => element.kind === 'endpoint');
  const guards = handled.filter((element) => element.kind === 'guard');
  const body = [
    'export default {',
    ...mapLinesOf('endpoints', endpoints),
    ...mapLinesOf('guards', guards),
    '  commands: {},',
    '  subscriptions: {},',
    ...stampLinesOf(stamps),
    '};',
  ];
  return moduleTextOf({ first: [headerOf('generate')], imports, body });
}

/** The Reader schemas of the Service's own Events: none until a Service declares Events. */
export function readersTextOf(): string {
  return moduleTextOf({ first: [headerOf('generate')], imports: [], body: ['export {};'] });
}

/** The stub of a Handler not written yet, importing its Element from where it is exported. */
export function stubTextOf(handled: Handled, exported: ExportedAt): string {
  const specifier = specifierOf(handlerPathOf(handled), exported);
  const imports = [
    namedImportOf(['handle'], '@cf-loom/handlers'),
    namedImportOf([exported.name], specifier),
  ];
  return moduleTextOf({
    first: [],
    imports,
    body: [`export default handle.stub(${exported.name});`],
  });
}

/** How a file imports an export: a file by its relative path, a package by its name. */
function specifierOf(importer: string, exported: ExportedAt): string {
  switch (exported.kind) {
    case 'file':
      return relativeSpecifierOf(importer, exported.path);
    case 'package':
      return exported.packageName;
  }
}

function mapLinesOf(key: string, handled: readonly Handled[]): readonly string[] {
  if (handled.length === 0) {
    return [`  ${key}: {},`];
  }
  const entries = handled.map((element) => `    ${keyOf(element.name)}: ${localNameOf(element)},`);
  return [`  ${key}: {`, ...entries, '  },'];
}

function stampLinesOf(stamps: readonly DeprecationStamp[]): readonly string[] {
  if (stamps.length === 0) {
    return ['  deprecatedAt: {},'];
  }
  const entries = stamps.map(
    ({ name, deprecatedAt }) => `    ${keyOf(name)}: ${stringLiteralOf(deprecatedAt)},`,
  );
  return ['  deprecatedAt: {', ...entries, '  },'];
}

/** The map's local name of a Handler, by its Element's name and kind. */
function localNameOf(handled: Handled): string {
  switch (handled.kind) {
    case 'endpoint':
      return `${handled.name}EndpointHandler`;
    case 'guard':
      return `${handled.name}GuardHandler`;
  }
}
