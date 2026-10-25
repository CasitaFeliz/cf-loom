import type { Definitions } from './definitions.ts';
import type { ContractPackage, Dependency } from './dependency.ts';
import type { Endpoint } from './endpoint.ts';
import { freezeDeclaration } from './freeze-declaration.ts';
import type { Group } from './group.ts';
import type { DeclaredFieldsRule } from './rules.ts';

/** What a Service's root lists: its Definitions Packages, its Groups, which list its Elements and Subscriptions, and its Dependencies; an absent list is empty. */
type ContractDeclaration = {
  readonly name: string;
  readonly definitions?: readonly Definitions[];
  readonly groups?: readonly Group[];
  readonly dependencies?: readonly Dependency[];
};

/** A Service's declared Contract, the root `generate`, `serve` and `messaging` read. */
export type Contract<Declaration extends ContractDeclaration = ContractDeclaration> =
  Readonly<Declaration> & { readonly kind: 'contract' };

type PublicEndpoint = Endpoint & { readonly visibility: 'public' };

/** What an Application may depend on: Public Endpoints only, as it runs outside the network. */
type ApplicationDependency = Dependency<ContractPackage, readonly PublicEndpoint[]>;

/** What an Application's root lists: its Dependencies and nothing else. */
type ApplicationDeclaration = {
  readonly name: string;
  readonly dependencies: readonly ApplicationDependency[];
};

/** An Application's declared Contract, published so the registry records every use of a Service's Elements, an Application's included. */
export type Application<Declaration extends ApplicationDeclaration = ApplicationDeclaration> =
  Readonly<Declaration> & { readonly kind: 'application' };

/** Declares a Service's Contract from everything it offers, keeps and requires. */
export function defineContract<const Declaration extends ContractDeclaration>(
  declaration: Declaration & NoInfer<DeclaredFieldsRule<Declaration, ContractDeclaration>>,
): Contract<Declaration> {
  return freezeDeclaration('contract', declaration);
}

/** Declares an Application's Contract, which holds only Dependencies. */
export function defineApplication<const Declaration extends ApplicationDeclaration>(
  declaration: Declaration & NoInfer<DeclaredFieldsRule<Declaration, ApplicationDeclaration>>,
): Application<Declaration> {
  return freezeDeclaration('application', declaration);
}
