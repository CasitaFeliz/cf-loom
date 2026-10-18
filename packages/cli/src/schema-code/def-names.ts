import { camelCaseOf, pascalCaseOf } from '../source-text/index.ts';
import type { SchemaMode } from './needs.ts';

/**
 * The identifier of a recursive def's schema in a mode: the camelCase of its id's words, with
 * `Reader` after it for the reader, so both modes of one def live side by side.
 */
export function defIdentifierOf(id: string, mode: SchemaMode): string {
  const declared = camelCaseOf(id);
  switch (mode) {
    case 'declared':
      return declared;
    case 'reader':
      return `${declared}Reader`;
  }
}

/** The name of the type a recursive def's schema is annotated with, since `z.lazy` needs one. */
export function defTypeNameOf(id: string, mode: SchemaMode): string {
  return pascalCaseOf(defIdentifierOf(id, mode));
}
