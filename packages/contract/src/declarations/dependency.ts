import type { ExportedSnapshot } from '../snapshot/index.ts';
import type { Visibility } from './element.ts';
import type { Endpoint } from './endpoint.ts';
import type { Event } from './event.ts';
import { freezeDeclaration } from './freeze-declaration.ts';
import { isEndpoint } from './predicates.ts';
import type { DeclaredFieldsRule } from './rules.ts';
import type { StandardRejections } from './standard-rejections.ts';

type ExportedVisibility = Exclude<Visibility, 'private'>;

/** An Event as a Contract Package exports it: the declaration itself, which Subscriptions reference. */
export type ProvidedEvent = Event & { readonly visibility: ExportedVisibility };

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

type ElementOf<Elements> = Elements[keyof Elements];

/** What an author writes to declare a Dependency: the Provider's Contract Package, as imported, and the Endpoints it calls. */
type DependencyDeclaration<Provider extends ContractPackage> = {
  readonly provider: Provider;
  readonly endpoints?: readonly ElementOf<Provider['endpoints']>[];
};

type SelectedEndpoints<Declaration> = Declaration extends {
  readonly endpoints: readonly (infer Selected)[];
}
  ? Selected
  : never;

type EndpointsByName<Endpoints> = {
  readonly [Selected in Endpoints as Selected extends Endpoint
    ? Selected['name']
    : never]: Selected;
};

/**
 * What a Contract uses of one Provider: its Contract Package, as imported, with the version it
 * relied on, its Standard Rejections and the Elements it exports, and the Endpoints it calls, by
 * name. The Events it receives are its Subscriptions'.
 */
export type Dependency<
  Provider extends ContractPackage = ContractPackage,
  Endpoints = Readonly<Record<string, Endpoint>>,
> = {
  readonly kind: 'dependency';
  readonly provider: Provider;
  readonly endpoints: Endpoints;
};

/**
 * Declares what a Contract uses of one Provider, so its client reaches no more. It keeps what was
 * written and never throws: an item that is no Endpoint is kept by its position, and a selection
 * that is no list as written, for `generate` to report.
 */
export function defineDependency<
  const Provider extends ContractPackage,
  const Declaration extends Omit<DependencyDeclaration<Provider>, 'provider'>,
>(
  declaration: Declaration & { readonly provider: Provider } & NoInfer<
      DeclaredFieldsRule<Declaration, DependencyDeclaration<Provider>>
    >,
): Dependency<Provider, EndpointsByName<SelectedEndpoints<Declaration>>> {
  const endpoints = byNameOf(declaration.endpoints);
  const dependency = freezeDeclaration('dependency', { ...declaration, endpoints });
  return dependency as Dependency<Provider, EndpointsByName<SelectedEndpoints<Declaration>>>;
}

/** The selected Endpoints by name, none when left out; a selection that is no list, as written. */
function byNameOf(endpoints: unknown): unknown {
  if (endpoints === undefined) {
    return {};
  }
  return Array.isArray(endpoints) ? Object.fromEntries(endpoints.map(byName)) : endpoints;
}

/** A selected Endpoint keyed by its name; anything else by its position, which no name can be. */
function byName(selected: unknown, index: number): readonly [string, unknown] {
  return [isEndpoint(selected) ? selected.name : String(index), selected];
}

/** A Message Version's name in code, `orderCreatedV2`, which a Contract Package keys it by. */
export function codeNameOf(message: { readonly name: string; readonly version: number }): string {
  return `${message.name.charAt(0).toLowerCase()}${message.name.slice(1)}V${message.version}`;
}
