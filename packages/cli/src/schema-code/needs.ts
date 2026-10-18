/**
 * How a generated schema reads a value: `declared`, as the author wrote it, which writers and
 * the Service reading its Input use; or `reader`, every object open and every Open Enum and Open
 * Union with its Unknown case, which whoever reads a Success, a Rejection body or a Message uses.
 */
export type SchemaMode = 'declared' | 'reader';

/** A helper of `@casitafeliz/loom-contract` a generated schema calls. */
export type Helper = 'openEnum' | 'openUnion';

/**
 * What generated schemas need imported besides `z`, gathered while they are written: the
 * helpers they call and the recursive defs they reference, by identifier.
 */
export type Needs = { readonly helpers: Set<Helper>; readonly defs: Set<string> };

/** Nothing needed yet. */
export function noNeeds(): Needs {
  return { helpers: new Set(), defs: new Set() };
}
