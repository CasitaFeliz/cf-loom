import type { Definitions } from './definitions.ts';
import type { Dependencies } from './dependencies.ts';
import type { Endpoint } from './endpoint.ts';
import type { Group } from './group.ts';
import type { DeclaredFieldsRule } from './rules.ts';

/** What a Service's root lists: exactly what its Snapshot describes; an absent list is empty. */
type ContractDeclaration = {
  readonly name: string;
  readonly definitions?: readonly Definitions[];
  readonly groups?: readonly Group[];
  readonly dependencies?: readonly Dependencies[];
};

/** A Service's declared Contract, the root `generate`, `serve` and `messaging` read. */
export type Contract<Declaration extends ContractDeclaration = ContractDeclaration> =
  Readonly<Declaration> & { readonly kind: 'contract' };

type PublicEndpoint = Endpoint & { readonly visibility: 'public' };

/** A Dependency an Application may declare: Public Endpoints only, since it runs outside the internal network. */
type ApplicationDependencies = Dependencies<
  Readonly<Record<string, PublicEndpoint>>,
  Readonly<Record<string, never>>
>;

/** What an Application's root lists: its Dependencies and nothing else. */
type ApplicationDeclaration = {
  readonly name: string;
  readonly dependencies: readonly ApplicationDependencies[];
};

/** An Application's declared Contract, published so every use of a Service's Elements is known. */
export type Application<Declaration extends ApplicationDeclaration = ApplicationDeclaration> =
  Readonly<Declaration> & { readonly kind: 'application' };

/** Declares a Service's Contract from everything it offers, keeps and requires. */
export function defineContract<const Declaration extends ContractDeclaration>(
  declaration: Declaration & NoInfer<DeclaredFieldsRule<Declaration, ContractDeclaration>>,
): Contract<Declaration> {
  return Object.freeze({ ...declaration, kind: 'contract' });
}

/** Declares an Application's Contract, which holds only Dependencies. */
export function defineApplication<const Declaration extends ApplicationDeclaration>(
  declaration: Declaration & NoInfer<DeclaredFieldsRule<Declaration, ApplicationDeclaration>>,
): Application<Declaration> {
  return Object.freeze({ ...declaration, kind: 'application' });
}
