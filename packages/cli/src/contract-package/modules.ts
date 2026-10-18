import { byCodePoint } from '@casitafeliz/loom-contract/internal';
import { type Needs, noNeeds } from '../schema-code/index.ts';
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
export type SchemaFile = { readonly file: PackageFile; readonly defs: ReadonlySet<string> };

/** A declaration another file of the package exports, by its name, `type` before a type's, and that file. */
export type Sibling = { readonly name: string; readonly path: string };

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
    ...[...needs.defs].map((name): Sibling => ({ name, path: defsFile })),
    ...[...needs.defTypes].map((name): Sibling => ({ name: `type ${name}`, path: defsFile })),
  ];
  const imports = [...siblingImportsOf(path, siblings), ...moduleImportsOf(needs)];
  const sorted = imports.sort((left, right) => byCodePoint(left.specifier, right.specifier));
  const lines = sorted.map(({ line }) => line);
  return { path, text: moduleTextOf({ first: [headerOf('package')], imports: lines, body }) };
}

type ImportLine = { readonly specifier: string; readonly line: string };

function siblingImportsOf(path: string, siblings: readonly Sibling[]): readonly ImportLine[] {
  const namesByPath = new Map<string, Set<string>>();
  for (const sibling of siblings) {
    const names = namesByPath.get(sibling.path) ?? new Set<string>();
    names.add(sibling.name);
    namesByPath.set(sibling.path, names);
  }
  return [...namesByPath].map(([siblingPath, names]) => {
    const specifier = relativeSpecifierOf(path, siblingPath);
    const sorted = [...names].sort((left, right) => byCodePoint(bareOf(left), bareOf(right)));
    return { specifier, line: namedImportOf(sorted, specifier) };
  });
}

/** An imported name without the `type` it may be imported as. */
function bareOf(name: string): string {
  return name.replace(/^type /, '');
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
