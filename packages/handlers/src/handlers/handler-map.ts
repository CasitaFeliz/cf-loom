import type { Contract } from '@cf-loom/contract';
import type { AttachedGuardsOf, CodeNameOf, GroupedOf, LiveOf } from '@cf-loom/contract/internal';
import type { HandledBy } from './handler.ts';
import type { Readers } from './reader.ts';

/** The Endpoints of a Contract that are not Retired, which each need a Handler. */
type LiveEndpointsOf<C extends Contract> = LiveOf<GroupedOf<C, 'endpoints'>>;

/**
 * The Guards a Contract's map holds: required when an Endpoint that is not Retired attaches it,
 * optional when only Retired ones do, as `generate` writes every Guard of the Snapshot.
 */
type GuardsOf<C extends Contract> = {
  readonly [G in AttachedGuardsOf<LiveEndpointsOf<C>> as G['name']]: HandledBy<G>;
} & {
  readonly [G in AttachedGuardsOf<GroupedOf<C, 'endpoints'>> as G['name']]?: HandledBy<G>;
};

/**
 * The Handler map a Contract needs, which `generate` writes and `serve` and `consume` take: one
 * Handler for each Endpoint not Retired, each Guard those attach, each Command's Message Version
 * not Retired and each Subscription, keyed by name in code, with the `readers`.
 */
export type HandlerMapOf<C extends Contract> = {
  readonly endpoints: {
    readonly [E in LiveEndpointsOf<C> as E['name']]: HandledBy<E>;
  };
  readonly guards: GuardsOf<C>;
  readonly commands: {
    readonly [V in LiveOf<GroupedOf<C, 'commands'>> as CodeNameOf<V>]: HandledBy<V>;
  };
  readonly subscriptions: {
    readonly [S in GroupedOf<C, 'subscriptions'> as S['name']]: HandledBy<S>;
  };
  readonly readers: Readers;
  readonly deprecatedAt: Readonly<Record<string, string>>;
};
