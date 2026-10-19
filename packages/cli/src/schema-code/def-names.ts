import { camelCaseOf, pascalCaseOf } from '../source-text/index.ts';
import { type SchemaMode, schemaModes } from './needs.ts';

/**
 * The identifier of a recursive def's schema in a mode: the camelCase of its id's words, then
 * `Def`, or `ReaderDef` for the reader, so both modes of one def live side by side.
 */
export function defIdentifierOf(id: string, mode: SchemaMode): string {
  const words = camelCaseOf(id);
  switch (mode) {
    case 'declared':
      return `${words}Def`;
    case 'reader':
      return `${words}ReaderDef`;
  }
}

/** The name of the type a recursive def's schema is annotated with, since `z.lazy` needs one. */
export function defTypeNameOf(id: string, mode: SchemaMode): string {
  return pascalCaseOf(defIdentifierOf(id, mode));
}

/** Why the defs of a Snapshot cannot all be named in code. */
export type DefNamesProblem =
  | { readonly kind: 'no-name'; readonly id: string }
  | { readonly kind: 'colliding'; readonly ids: readonly [string, string] };

/**
 * The first id that gives no name in code, or the first two whose names in code are one, over
 * every identifier either mode gives; none when every def has names of its own.
 */
export function defNamesProblemOf(ids: readonly string[]): DefNamesProblem | undefined {
  const unnamed = ids.find((id) => !/^[A-Za-z]/.test(camelCaseOf(id)));
  if (unnamed !== undefined) {
    return { kind: 'no-name', id: unnamed };
  }
  const idByIdentifier = new Map<string, string>();
  for (const id of ids) {
    for (const identifier of schemaModes.map((mode) => defIdentifierOf(id, mode))) {
      const earlier = idByIdentifier.get(identifier);
      if (earlier !== undefined && earlier !== id) {
        return { kind: 'colliding', ids: [earlier, id] };
      }
      idByIdentifier.set(identifier, id);
    }
  }
  return undefined;
}
