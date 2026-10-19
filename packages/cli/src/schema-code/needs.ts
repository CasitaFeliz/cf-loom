/** The modes a generated schema is written in, each def in each it is referenced in. */
export const schemaModes = ['declared', 'reader'] as const;

/**
 * How a generated schema reads a value: `declared`, as the author wrote it, which writers and
 * the Service reading its Input use; or `reader`, every object open and every Open Enum and Open
 * Union with its Unknown case, which whoever reads a Success, a Rejection body or a Message uses.
 */
export type SchemaMode = (typeof schemaModes)[number];

/** A module generated code imports: `zod` as `z`, or `@casitafeliz/loom-contract` as `loom`. */
export type ImportedModule = 'zod' | 'loom';

/** A recursive def as generated code references it: by its id, in one mode. */
export type DefUse = { readonly id: string; readonly mode: SchemaMode };

/** Def uses, each once, by mode and id. */
export type DefUses = Map<string, DefUse>;

/**
 * What generated code needs imported, gathered while it is written: the modules it calls, and the
 * recursive defs whose schemas and types it references.
 */
export type Needs = {
  readonly modules: Set<ImportedModule>;
  readonly defs: DefUses;
  readonly defTypes: DefUses;
};

/** Nothing needed yet. */
export function noNeeds(): Needs {
  return { modules: new Set(), defs: new Map(), defTypes: new Map() };
}

/** Records a def use once. */
export function addDefUse(uses: DefUses, use: DefUse): void {
  uses.set(defUseKeyOf(use), use);
}

/** The one key of a def use, whatever its id spells. */
export function defUseKeyOf(use: DefUse): string {
  return JSON.stringify([use.mode, use.id]);
}
