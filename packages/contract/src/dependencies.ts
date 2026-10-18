import type { Visibility } from './element.ts';
import type { Endpoint } from './endpoint.ts';
import { frozenDeclaration } from './frozen-declaration.ts';
import type { DeclaredFieldsRule } from './rules.ts';
import type { StandardRejections } from './standard-rejections.ts';

type ExportedVisibility = Exclude<Visibility, 'private'>;

/** An Event as a Contract Package exports it: enough to key it and to subscribe to it. */
type ProvidedEvent = {
  readonly kind: 'event';
  readonly name: string;
  readonly version: number;
  readonly visibility: ExportedVisibility;
};

/** The `contract` a Contract Package exports: its Public and Internal Elements and its version. */
export type ContractPackage = {
  readonly name: string;
  readonly version: string;
  readonly endpoints: Readonly<
    Record<string, Endpoint & { readonly visibility: ExportedVisibility }>
  >;
  readonly events: Readonly<Record<string, ProvidedEvent>>;
  readonly standardRejections: StandardRejections;
};

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

type EventName<Event extends ProvidedEvent> = `${Uncapitalize<Event['name']>}V${Event['version']}`;

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

/** What a Contract uses of one Provider, keyed by name in code, and the version it relied on. */
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

/** Declares what a Contract uses of one Provider, so its client and Subscriptions reach no more. */
export function defineDependencies<
  const Provider extends ContractPackage,
  const Chosen extends Selection<Provider>,
>(
  provider: Provider,
  selection: Chosen & NoInfer<DeclaredFieldsRule<Chosen, Selection<Provider>>>,
): Dependencies<
  EndpointsByName<SelectedIn<Chosen, 'endpoints'>>,
  EventsByName<SelectedIn<Chosen, 'events'>>
> {
  const endpoints = (selection.endpoints ?? []).map((endpoint) => [endpoint.name, endpoint]);
  const events = (selection.events ?? []).map((event) => [eventName(event), event]);
  return frozenDeclaration('dependencies', {
    provider: provider.name,
    against: provider.version,
    standardRejections: provider.standardRejections,
    endpoints: Object.fromEntries(endpoints),
    events: Object.fromEntries(events),
  });
}

function eventName(event: ProvidedEvent): string {
  return `${event.name.charAt(0).toLowerCase()}${event.name.slice(1)}V${event.version}`;
}
