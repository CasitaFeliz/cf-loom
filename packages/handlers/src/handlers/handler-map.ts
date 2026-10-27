import type { ServiceContract } from '@cf-loom/contract';
import type {
  AttachedGuardsOf,
  CodeNameOf,
  GroupedOf,
  LiveOf,
  Refusal,
} from '@cf-loom/contract/internal';
import type { HandledBy } from './handler.ts';
import type { Readers } from './reader.ts';

/** The Endpoints of a Service's Contract that are not Retired, which each need a Handler. */
type LiveEndpointsOf<C extends ServiceContract> = LiveOf<GroupedOf<C, 'endpoints'>>;

/**
 * The Guards a Service's Contract's map holds: required when an Endpoint that is not Retired attaches it,
 * optional when only Retired ones do, as `generate` writes every Guard of the Snapshot.
 */
type GuardsOf<C extends ServiceContract, Resources> = {
  readonly [G in AttachedGuardsOf<LiveEndpointsOf<C>> as G['name']]: HandledBy<G, Resources>;
} & {
  readonly [G in AttachedGuardsOf<GroupedOf<C, 'endpoints'>> as G['name']]?: HandledBy<
    G,
    Resources
  >;
};

/** A table of the map, or the cause, by name, for a Contract typed plain `ServiceContract`, which lists nothing the types can read. */
type OwnTypeOf<C extends ServiceContract, Table> = ServiceContract extends C
  ? Refusal<"HandlerMapOf takes the Contract's own type, typeof contract, not ServiceContract">
  : Table;

/**
 * The Handler map a Service's Contract needs, with the Service's Resources: one Handler for each Endpoint
 * not Retired, each Guard those attach, each Command's Message Version not Retired and each Subscription,
 * keyed by name in code, with the `readers`; each Handler takes some of `Resources`. `generate` writes
 * `satisfies HandlerMapOf<typeof contract>`; a map annotated without `Resources` hides what its Handlers
 * take, which `ResourcesOf`, `serve` and `consume` refuse.
 */
// biome-ignore lint/suspicious/noExplicitAny: Resources unspecified, the satisfies target generate writes
export type HandlerMapOf<C extends ServiceContract, Resources = any> = {
  readonly endpoints: OwnTypeOf<
    C,
    { readonly [E in LiveEndpointsOf<C> as E['name']]: HandledBy<E, Resources> }
  >;
  readonly guards: OwnTypeOf<C, GuardsOf<C, Resources>>;
  readonly commands: OwnTypeOf<
    C,
    { readonly [V in LiveOf<GroupedOf<C, 'commands'>> as CodeNameOf<V>]: HandledBy<V, Resources> }
  >;
  readonly subscriptions: OwnTypeOf<
    C,
    { readonly [S in GroupedOf<C, 'subscriptions'> as S['name']]: HandledBy<S, Resources> }
  >;
  readonly readers: Readers;
};
