import { byCodePoint } from '@casitafeliz/loom-contract/internal';
import type { Needs } from '../schema-code/index.ts';
import {
  headerOf,
  moduleTextOf,
  namedImportOf,
  relativeSpecifierOf,
  typeImportOf,
} from '../source-text/index.ts';

/** Where the Contract Package's recursive defs live, when a schema reaches one. */
export const defsFile = 'src/defs.ts';

/** A file of the Contract Package, by its path in the package. */
export type PackageFile = { readonly path: string; readonly text: string };

/** A file of the package that writes schemas, with the recursive defs they reference. */
export type SchemaFile = { readonly file: PackageFile; readonly defs: ReadonlySet<string> };

/** A declaration another file of the package exports, by its name and that file. */
export type Sibling = { readonly name: string; readonly path: string };

/** What a generated module of the package imports and declares. */
export type PackageModule = {
  readonly path: string;
  readonly contractNames: readonly string[];
  readonly contractTypes?: readonly string[];
  readonly needs: Needs;
  /** Whether the body writes a zod schema, so the module imports `z`. */
  readonly writesSchemas: boolean;
  readonly siblings: readonly Sibling[];
  readonly body: readonly string[];
};

/**
 * A module of the package with its header line and every import it needs, sorted by specifier:
 * `@casitafeliz/loom-contract`, `zod` when a schema is written, and its siblings by relative path.
 */
export function packageModuleOf(module: PackageModule): PackageFile {
  const { path, needs, body } = module;
  const contractNames = [...new Set([...module.contractNames, ...needs.helpers])].sort(byCodePoint);
  const siblings = [
    ...module.siblings,
    ...[...needs.defs].map((name): Sibling => ({ name, path: defsFile })),
  ];
  const imports = [
    ...siblingImportsOf(path, siblings),
    ...contractImportsOf(contractNames, module.contractTypes ?? []),
    ...(module.writesSchemas ? [{ specifier: 'zod', line: namedImportOf(['z'], 'zod') }] : []),
  ];
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
    return { specifier, line: namedImportOf([...names].sort(byCodePoint), specifier) };
  });
}

function contractImportsOf(
  names: readonly string[],
  types: readonly string[],
): readonly ImportLine[] {
  const specifier = '@casitafeliz/loom-contract';
  const values = names.length === 0 ? [] : [{ specifier, line: namedImportOf(names, specifier) }];
  const typeLines = types.length === 0 ? [] : [{ specifier, line: typeImportOf(types, specifier) }];
  return [...values, ...typeLines];
}
