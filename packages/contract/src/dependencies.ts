import type { Visibility } from './element.ts';
import type { Endpoint } from './endpoint.ts';
import type { StandardRejections } from './standard-rejections.ts';

/** An Event as a Contract Package exports it: enough to key it by name and version and to subscribe to it. */
type ProvidedEvent = {
  readonly kind: 'event';
  readonly name: string;
  readonly version: number;
  readonly visibility: Visibility;
};

/** The `contract` a Contract Package exports: its Public and Internal Elements, stamped with its version by `publish`. */
export type ContractPackage = {
  readonly name: string;
  readonly version: string;
  readonly endpoints: Readonly<Record<string, Endpoint>>;
  readonly events: Readonly<Record<string, ProvidedEvent>>;
  readonly standardRejections: StandardRejections;
};

type ElementOf<Elements> = Elements[keyof Elements];

/** What a Dependency may select: only Elements its Provider's Contract Package exports. */
type Selection<Provider extends ContractPackage> = {
  readonly endpoints?: readonly ElementOf<Provider['endpoints']>[];
  readonly events?: readonly ElementOf<Provider['events']>[];
};

type Selected<Chosen, Part extends keyof Selection<ContractPackage>> = Chosen extends {
  readonly [Key in Part]: readonly (infer Element)[];
}
  ? Element
  : never;

type EventName<Event extends ProvidedEvent> = `${Uncapitalize<Event['name']>}V${Event['version']}`;

type EndpointsByName<Endpoints> = {
  readonly [Selected in Endpoints as Selected extends Endpoint
    ? Selected['name']
    : never]: Selected;
};

type EventsByName<Events> = {
  readonly [Selected in Events as Selected extends ProvidedEvent
    ? EventName<Selected>
    : never]: Selected;
};

/** The Elements of one Provider that a Contract uses, keyed by their names in code, with the version it was declared against. */
export type Dependencies<
  Endpoints = Readonly<Record<string, Endpoint>>,
  Events = Readonly<Record<string, ProvidedEvent>>,
> = {
  readonly kind: 'dependencies';
  readonly provider: string;
  readonly against: string;
  readonly standardRejections: StandardRejections;
  readonly endpoints: Endpoints;
  readonly events: Events;
};

/** Declares what a Contract uses of one Provider, so its client and Subscriptions reach nothing else. */
export function defineDependencies<
  const Provider extends ContractPackage,
  const Chosen extends Selection<Provider>,
>(
  provider: Provider,
  selection: Chosen,
): Dependencies<
  EndpointsByName<Selected<Chosen, 'endpoints'>>,
  EventsByName<Selected<Chosen, 'events'>>
> {
  const endpoints = (selection.endpoints ?? []).map((endpoint) => [endpoint.name, endpoint]);
  const events = (selection.events ?? []).map((event) => [eventName(event), event]);
  return Object.freeze({
    kind: 'dependencies',
    provider: provider.name,
    against: provider.version,
    standardRejections: provider.standardRejections,
    endpoints: Object.freeze(Object.fromEntries(endpoints)),
    events: Object.freeze(Object.fromEntries(events)),
  });
}

function eventName(event: ProvidedEvent): string {
  return `${event.name.charAt(0).toLowerCase()}${event.name.slice(1)}V${event.version}`;
}
