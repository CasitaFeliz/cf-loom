import type { ExportedSnapshot } from '../snapshot/index.ts';
import type { Visibility } from './element.ts';
import type { Endpoint } from './endpoint.ts';
import type { Event } from './event.ts';
import { freezeDeclaration } from './freeze-declaration.ts';
import type { DeclaredFieldsRule } from './rules.ts';
import type { ProvidedStandardRejections } from './standard-rejections.ts';

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
  readonly standardRejections: ProvidedStandardRejections;
  readonly exportedSnapshot: ExportedSnapshot;
};

type ElementOf<Elements> = Elements[keyof Elements];

/** What an author writes to declare a Dependency: the Provider's Contract Package, as imported, and the Endpoints it calls. */
type DependencyDeclaration<Provider extends ContractPackage> = {
  readonly provider: Provider;
  readonly endpoints?: readonly ElementOf<Provider['endpoints']>[];
};

/**
 * What a Contract uses of one Provider: its Contract Package, as imported, with the version it
 * relied on, its Standard Rejections and the Elements it exports, and the Endpoints it calls, as
 * listed. The Events it receives are its Subscriptions'.
 */
export type Dependency<
  Provider extends ContractPackage = ContractPackage,
  Endpoints extends readonly Endpoint[] = readonly Endpoint[],
> = {
  readonly kind: 'dependency';
  readonly provider: Provider;
  readonly endpoints?: Endpoints;
};

/** The Contract Package a declaration holds as its `provider`, which bounds the Endpoints it lists. */
type ProviderOf<Declaration> = Declaration extends {
  readonly provider: infer Provider extends ContractPackage;
}
  ? Provider
  : ContractPackage;

/** Declares what a Contract uses of one Provider, so its client reaches no more. */
export function defineDependency<
  const Declaration extends DependencyDeclaration<ProviderOf<Declaration>>,
>(
  declaration: Declaration &
    NoInfer<DeclaredFieldsRule<Declaration, DependencyDeclaration<ProviderOf<Declaration>>>>,
): Readonly<Declaration> & { readonly kind: 'dependency' } {
  return freezeDeclaration('dependency', declaration);
}
