import { byCodePoint } from '@cf-loom/contract/internal';
import {
  type DefUse,
  defIdentifierOf,
  defTypeNameOf,
  type ImportLine,
  type Needs,
  noNeeds,
  schemaImportsOf,
  sortedImportLinesOf,
} from '../schema-code/index.ts';
import {
  headerOf,
  moduleTextOf,
  namedImportOf,
  relativeSpecifierOf,
} from '../source-text/index.ts';
import { packagePaths } from './paths.ts';

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
 * specifiers: its siblings, `@cf-loom/contract` as `loom`, and `zod` as `z`.
 */
export function packageModuleOf(module: PackageModule): PackageFile {
  const { path, body } = module;
  const needs = module.needs ?? noNeeds();
  const siblings = [
    ...(module.siblings ?? []),
    ...[...needs.defs.values()].map(
      ({ id, mode }): Sibling => ({
        name: defIdentifierOf(id, mode),
        path: packagePaths.defs,
        kind: 'value',
      }),
    ),
    ...[...needs.defTypes.values()].map(
      ({ id, mode }): Sibling => ({
        name: defTypeNameOf(id, mode),
        path: packagePaths.defs,
        kind: 'type',
      }),
    ),
  ];
  const lines = sortedImportLinesOf([
    ...siblingImportsOf(path, siblings),
    ...schemaImportsOf(needs),
  ]);
  return { path, text: moduleTextOf({ first: [headerOf('package')], imports: lines, body }) };
}

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
