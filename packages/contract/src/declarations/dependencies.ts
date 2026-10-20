import type { ExportedSnapshot } from '../snapshot/index.ts';
import type { Visibility } from './element.ts';
import type { Endpoint } from './endpoint.ts';
import type { Event } from './event.ts';
import { freezeDeclaration } from './freeze-declaration.ts';
import type { DeclaredFieldsRule } from './rules.ts';
import type { StandardRejections } from './standard-rejections.ts';

type ExportedVisibility = Exclude<Visibility, 'private'>;

/** An Event as a Contract Package exports it: the declaration itself, which Subscriptions reference. */
type ProvidedEvent = Event & { readonly visibility: ExportedVisibility };

/**
 * The `contract` a Contract Package exports: its Public and Internal Elements, its version, and the
 * Snapshot cut to what it exports.
 */
export type ContractPackage = {
  readonly name: string;
  readonly version: string;
  readonly endpoints: Readonly<
    Record<string, Endpoint & { readonly visibility: ExportedVisibility }>
  >;
  readonly events: Readonly<Record<string, ProvidedEvent>>;
  readonly standardRejections: StandardRejections;
  readonly exportedSnapshot: ExportedSnapshot;
};

/** The Elements a Provider exports, kept by a Dependency so `generate` checks what it selected. */
export type ExportedElements = Pick<ContractPackage, 'endpoints' | 'events'>;

type ElementOf<Elements> = Elements[keyof Elements];

/** What a Dependency may select: only Elements its Provider's Contract Package exports. */
type Selection<Provider extends ContractPackage> = {
  readonly endpoints?: readonly ElementOf<Provider['endpoints']>[];
  readonly events?: readonly ElementOf<Provider['events']>[];
};

type SelectedIn<Chosen, Part extends keyof Selection<ContractPackage>> = Chosen extends {
  readonly [Key in Part]: readonly (infer Element)[];
}
  ? Element
  : never;

type EventName<Provided extends ProvidedEvent> =
  `${Uncapitalize<Provided['name']>}V${Provided['version']}`;

type EndpointsByName<Endpoints> = {
  readonly [Provided in Endpoints as Provided extends Endpoint
    ? Provided['name']
    : never]: Provided;
};

type EventsByName<Events> = {
  readonly [Provided in Events as Provided extends ProvidedEvent
    ? EventName<Provided>
    : never]: Provided;
};

/**
 * What a Contract uses of one Provider, keyed by name in code, the version it relied on, its
 * Standard Rejections with their codes as written, so a Caller narrows by them, the Elements the
 * Provider exports, so `generate` checks each selected Element is one of them, and its exported
 * Snapshot, which the client reads nodes from.
 */
export type Dependencies<
  Endpoints = Readonly<Record<string, Endpoint>>,
  Events = Readonly<Record<string, ProvidedEvent>>,
  Standards extends StandardRejections = StandardRejections,
> = {
  readonly kind: 'dependencies';
  readonly provider: string;
  readonly against: string;
  readonly standardRejections: Standards;
  readonly endpoints: Endpoints;
  readonly events: Events;
  readonly exported: ExportedElements;
  readonly exportedSnapshot: ExportedSnapshot;
};

/** Declares what a Contract uses of one Provider, so its client and Subscriptions reach no more. */
export function defineDependencies<
  const Provider extends ContractPackage,
  const Chosen extends Selection<Provider>,
>(
  provider: Provider,
  selection: Chosen & NoInfer<DeclaredFieldsRule<Chosen, Selection<Provider>>>,
): Dependencies<
  EndpointsByName<SelectedIn<Chosen, 'endpoints'>>,
  EventsByName<SelectedIn<Chosen, 'events'>>,
  Provider['standardRejections']
> {
  const endpoints = (selection.endpoints ?? []).map((endpoint) => [endpoint.name, endpoint]);
  const events = (selection.events ?? []).map((event) => [eventName(event), event]);
  return freezeDeclaration('dependencies', {
    provider: provider.name,
    against: provider.version,
    standardRejections: provider.standardRejections,
    endpoints: Object.fromEntries(endpoints),
    events: Object.fromEntries(events),
    exported: { endpoints: provider.endpoints, events: provider.events },
    exportedSnapshot: provider.exportedSnapshot,
  });
}

function eventName(event: ProvidedEvent): string {
  return `${event.name.charAt(0).toLowerCase()}${event.name.slice(1)}V${event.version}`;
}
