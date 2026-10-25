import { pascalCaseOf } from '../source-text/index.ts';
import type { SchemaMode } from './needs.ts';

/**
 * The identifier of a recursive def's schema in a mode: its id, then `Def`, or `DefReader` for the
 * reader. An id is camelCase, so both modes of one def are names of their own, side by side.
 */
export function defIdentifierOf(id: string, mode: SchemaMode): string {
  switch (mode) {
    case 'declared':
      return `${id}Def`;
    case 'reader':
      return `${id}DefReader`;
  }
}

/** The name of the type a recursive def's schema is annotated with, since `z.lazy` needs one. */
export function defTypeNameOf(id: string, mode: SchemaMode): string {
  return pascalCaseOf(defIdentifierOf(id, mode));
}
