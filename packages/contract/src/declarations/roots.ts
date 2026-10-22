import type { Command } from './command.ts';
import type { Definitions } from './definitions.ts';
import type { Dependencies } from './dependencies.ts';
import type { Endpoint } from './endpoint.ts';
import type { Event } from './event.ts';
import { freezeDeclaration } from './freeze-declaration.ts';
import type { Group } from './group.ts';
import type { DeclaredFieldsRule } from './rules.ts';
import type { Subscription } from './subscription.ts';

/** What a Service's root lists: exactly what its Snapshot describes; an absent list is empty. */
type ContractDeclaration = {
  readonly name: string;
  readonly definitions?: readonly Definitions[];
  readonly groups?: readonly Group[];
  readonly events?: readonly Event[];
  readonly commands?: readonly Command[];
  readonly subscriptions?: readonly Subscription[];
  readonly dependencies?: readonly Dependencies[];
};

/** A Service's declared Contract, the root `generate`, `serve` and `messaging` read. */
export type Contract<Declaration extends ContractDeclaration = ContractDeclaration> =
  Readonly<Declaration> & { readonly kind: 'contract' };

type PublicEndpoint = Endpoint & { readonly visibility: 'public' };

/** What an Application may depend on: Public Endpoints only, as it runs outside the network. */
type ApplicationDependencies = Dependencies<
  Readonly<Record<string, PublicEndpoint>>,
  Readonly<Record<string, never>>
>;

/** What an Application's root lists: its Dependencies and nothing else. */
type ApplicationDeclaration = {
  readonly name: string;
  readonly dependencies: readonly ApplicationDependencies[];
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
