import type { Definitions } from './definitions.ts';
import type { Dependency } from './dependency.ts';
import { freezeDeclaration } from './freeze-declaration.ts';
import type { Group } from './group.ts';
import type { DeclaredFieldsRule, JoinedNames } from './rules.ts';

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

/** What an Application's root lists: its Dependencies and nothing else; an absent list is empty. */
type ApplicationDeclaration = {
  readonly name: string;
  readonly dependencies?: readonly Dependency[];
};

/** The names of the Endpoints that are not Public out of the Dependencies an Application lists. */
type NonPublicNames<Dependencies> = Dependencies extends readonly (infer Listed)[]
  ? Listed extends { readonly endpoints?: readonly (infer Selected)[] }
    ? Selected extends {
        readonly visibility: infer Visibility;
        readonly name: infer Name extends string;
      }
      ? Visibility extends 'public'
        ? never
        : Name
      : never
    : never
  : never;

/** What an Application must also satisfy: it depends on Public Endpoints only, as it runs outside the network. */
type PublicOnlyRule<Declaration extends ApplicationDeclaration> = [
  NonPublicNames<Declaration['dependencies']>,
] extends [never]
  ? unknown
  : {
      readonly dependencies: `An Application depends on Public Endpoints only: ${JoinedNames<NonPublicNames<Declaration['dependencies']>>}`;
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
  declaration: Declaration &
    PublicOnlyRule<Declaration> &
    NoInfer<DeclaredFieldsRule<Declaration, ApplicationDeclaration>>,
): Application<Declaration> {
  return freezeDeclaration('application', declaration);
}
