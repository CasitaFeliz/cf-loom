import { byCodePoint } from '@casitafeliz/loom-contract/internal';
import {
  type DefUse,
  defIdentifierOf,
  defTypeNameOf,
  type Needs,
  noNeeds,
} from '../schema-code/index.ts';
import {
  headerOf,
  moduleTextOf,
  namedImportOf,
  relativeSpecifierOf,
  stringLiteralOf,
} from '../source-text/index.ts';

/** Where the Contract Package's recursive defs live, when a schema reaches one. */
export const defsFile = 'src/defs.ts';

/** A file of the Contract Package, by its path in the package. */
export type PackageFile = { readonly path: string; readonly text: string };

/** A file of the package that writes schemas, with the recursive defs they reference. */
export type SchemaFile = { readonly file: PackageFile; readonly defUses: readonly DefUse[] };

/** A value or a type another file of the package exports, by its name and that file. */
export type Sibling = {
  readonly name: string;
  readonly path: string;
  readonly kind: 'value' | 'type';
};

/** What a generated module of the package declares, the siblings it imports and its needs. */
export type PackageModule = {
  readonly path: string;
  readonly body: readonly string[];
  readonly siblings?: readonly Sibling[];
  readonly needs?: Needs;
};

/**
 * A module of the package with its header line and its imports in code point order of their
 * specifiers: its siblings, `@casitafeliz/loom-contract` as `loom`, and `zod` as `z`.
 */
export function packageModuleOf(module: PackageModule): PackageFile {
  const { path, body } = module;
  const needs = module.needs ?? noNeeds();
  const siblings = [
    ...(module.siblings ?? []),
    ...[...needs.defs.values()].map(
      ({ id, mode }): Sibling => ({
        name: defIdentifierOf(id, mode),
        path: defsFile,
        kind: 'value',
      }),
    ),
    ...[...needs.defTypes.values()].map(
      ({ id, mode }): Sibling => ({ name: defTypeNameOf(id, mode), path: defsFile, kind: 'type' }),
    ),
  ];
  const imports = [...siblingImportsOf(path, siblings), ...moduleImportsOf(needs)];
  const sorted = imports.sort((left, right) => byCodePoint(left.specifier, right.specifier));
  const lines = sorted.map(({ line }) => line);
  return { path, text: moduleTextOf({ first: [headerOf('package')], imports: lines, body }) };
}

type ImportLine = { readonly specifier: string; readonly line: string };

function siblingImportsOf(path: string, siblings: readonly Sibling[]): readonly ImportLine[] {
  const byPath = new Map<string, Map<string, Sibling>>();
  for (const sibling of siblings) {
    const named = byPath.get(sibling.path) ?? new Map<string, Sibling>();
    named.set(sibling.name, sibling);
    byPath.set(sibling.path, named);
  }
  return [...byPath].map(([siblingPath, named]) => {
    const specifier = relativeSpecifierOf(path, siblingPath);
    const sorted = [...named.values()].sort((left, right) => byCodePoint(left.name, right.name));
    return { specifier, line: namedImportOf(sorted.map(importedNameOf), specifier) };
  });
}

/** A name as an import list writes it: a type's after `type`. */
function importedNameOf({ name, kind }: Sibling): string {
  switch (kind) {
    case 'value':
      return name;
    case 'type':
      return `type ${name}`;
  }
}

/**
 * `@casitafeliz/loom-contract` imported whole as `loom`, so nothing it exports can meet a
 * generated name, and `z` by name, which no generated name can be.
 */
function moduleImportsOf(needs: Needs): readonly ImportLine[] {
  const loom = '@casitafeliz/loom-contract';
  const loomImport = { specifier: loom, line: `import * as loom from ${stringLiteralOf(loom)};` };
  const zodImport = { specifier: 'zod', line: namedImportOf(['z'], 'zod') };
  return [
    ...(needs.modules.has('loom') ? [loomImport] : []),
    ...(needs.modules.has('zod') ? [zodImport] : []),
  ];
}

/** What a module needs that writes `loom.` itself, beside the schemas it writes. */
export function loomNeeds(): Needs {
  const needs = noNeeds();
  needs.modules.add('loom');
  return needs;
}
