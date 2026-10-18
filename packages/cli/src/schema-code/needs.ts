/**
 * How a generated schema reads a value: `declared`, as the author wrote it, which writers and
 * the Service reading its Input use; or `reader`, every object open and every Open Enum and Open
 * Union with its Unknown case, which whoever reads a Success, a Rejection body or a Message uses.
 */
export type SchemaMode = 'declared' | 'reader';

/** A module generated code imports: `zod` as `z`, or `@casitafeliz/loom-contract` as `loom`. */
export type ImportedModule = 'zod' | 'loom';

/**
 * What generated code needs imported, gathered while it is written: the modules it calls, and the
 * recursive defs and their types it references, by identifier.
 */
export type Needs = {
  readonly modules: Set<ImportedModule>;
  readonly defs: Set<string>;
  readonly defTypes: Set<string>;
};

/** Nothing needed yet. */
export function noNeeds(): Needs {
  return { modules: new Set(), defs: new Set(), defTypes: new Set() };
}
