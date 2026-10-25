import type { Contract } from './roots.ts';

/** A field a Group lists declarations in. */
export type GroupedField = 'endpoints' | 'events' | 'commands' | 'subscriptions';

/** Each declaration a Contract's Groups list in one field, with its exact type, so `publish` and `send` know every version whatever Group holds it. */
export type GroupedOf<C extends Contract, Field extends GroupedField> = C extends {
  readonly groups: readonly (infer Listed)[];
}
  ? ListedIn<Listed, Field>
  : never;

/** What one Group lists in a field; distributes over a union of Groups, and a Group typed plain `Group` gives none. */
type ListedIn<G, Field extends GroupedField> = G extends {
  readonly [Key in Field]: readonly (infer Item)[];
}
  ? Item
  : never;
