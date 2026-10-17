import type { Endpoint } from './endpoint.ts';

/** What an author writes to declare a Group: a name, what it is for, and at least one Endpoint. */
export type GroupDeclaration = {
  readonly name: string;
  readonly description: string;
  readonly endpoints: readonly [Endpoint, ...Endpoint[]];
};

/** A declared Group, which organizes Endpoints for code and documentation and adds nothing to them. */
export type Group<Declaration extends GroupDeclaration = GroupDeclaration> =
  Readonly<Declaration> & { readonly kind: 'group' };

/** Declares a named set of Endpoints; every Endpoint belongs to exactly one Group. */
export function defineGroup<const Declaration extends GroupDeclaration>(
  declaration: Declaration,
): Group<Declaration> {
  return Object.freeze({ ...declaration, kind: 'group' });
}
