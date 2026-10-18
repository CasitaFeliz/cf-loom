import { byCodePoint } from '@casitafeliz/loom-contract/internal';
import {
  defaultImportOf,
  headerOf,
  keyOf,
  moduleTextOf,
  namedImportOf,
  relativeSpecifierOf,
} from '../source-text/index.ts';
import { type Handled, handlerPathOf } from './handled.ts';

/** The file of the Handler map, under the Service's `src/`. */
export const handlerMapFile = 'src/handlers.generated.ts';

/** The file of the Reader schemas of the Service's own Events. */
export const readersFile = 'src/readers.generated.ts';

/**
 * Where an Element is exported: a package by its name, or a file by its path relative to the
 * project, starting with `./`, and the name it is exported under.
 */
export type ElementExport = { readonly specifier: string; readonly name: string };

/** The Handler map: plain data importing each Handler, which `serve` takes as it is. */
export function handlerMapTextOf(handled: readonly Handled[]): string {
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
    '};',
  ];
  return moduleTextOf({ first: [headerOf('generate')], imports, body });
}

/** The reader schemas of the Service's own Events: none until a Service declares Events. */
export function readersTextOf(): string {
  return moduleTextOf({ first: [headerOf('generate')], imports: [], body: ['export {};'] });
}

/** The stub of a Handler not written yet, importing its Element from where it is exported. */
export function stubTextOf(handled: Handled, exported: ElementExport): string {
  const path = handlerPathOf(handled);
  const specifier = exported.specifier.startsWith('.')
    ? relativeSpecifierOf(path, exported.specifier)
    : exported.specifier;
  const imports = [
    namedImportOf(['handle'], '@casitafeliz/loom-handlers'),
    namedImportOf([exported.name], specifier),
  ];
  return moduleTextOf({
    first: [],
    imports,
    body: [`export default handle.stub(${exported.name});`],
  });
}

function mapLinesOf(key: string, handled: readonly Handled[]): readonly string[] {
  if (handled.length === 0) {
    return [`  ${key}: {},`];
  }
  const entries = handled.map((element) => `    ${keyOf(element.name)}: ${localNameOf(element)},`);
  return [`  ${key}: {`, ...entries, '  },'];
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
