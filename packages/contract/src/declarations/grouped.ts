import type { AttachedGuardOf } from './attachment.ts';
import type { Guard } from './guard.ts';
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

/** The members of a union of declarations that are not Retired, as the runtime's `isLive` reads them. */
export type LiveOf<Declared> = Declared extends { readonly lifecycle: 'retired' }
  ? never
  : Declared;

/** Each Guard an Endpoint attaches, bare or qualified, as the runtime's `attachedGuardsOf` reads them; distributes over a union of Endpoints. */
export type AttachedGuardsOf<Attaching> = Attaching extends {
  readonly guards: readonly (infer Listed)[];
}
  ? Extract<AttachedGuardOf<Listed>, Guard>
  : never;
