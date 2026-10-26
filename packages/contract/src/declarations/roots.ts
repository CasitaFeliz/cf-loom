import type { Definitions } from './definitions.ts';
import type { Dependency } from './dependency.ts';
import { freezeDeclaration } from './freeze-declaration.ts';
import type { Group } from './group.ts';
import type { DeclaredFieldsRule, JoinedNames } from './rules.ts';

/**
 * What a Service's Root lists: its Groups, which list its Elements and Subscriptions, and its
 * Dependencies, and the Definitions Package whose Standard Rejections it takes, if any; without one
 * it takes cf-loom's defaults. The Definitions Packages it uses are the ones whose Guards,
 * Rejections and schemas it reaches. An absent list is empty.
 */
type ServiceContractDeclaration = {
  readonly name: string;
  readonly standardRejections?: Definitions;
  readonly groups?: readonly Group[];
  readonly dependencies?: readonly Dependency[];
};

/** A Service's declared Contract, the Root `generate`, `serve` and `messaging` read. */
export type ServiceContract<
  Declaration extends ServiceContractDeclaration = ServiceContractDeclaration,
> = Readonly<Declaration> & { readonly kind: 'service' };

/** What an Application's Root lists: its Dependencies and nothing else; an absent list is empty. */
type ApplicationContractDeclaration = {
  readonly name: string;
  readonly dependencies?: readonly Dependency[];
};

/** Each Endpoint that is not Public out of the Dependencies an Application lists, as `getThing is internal`. */
type NonPublicOf<Dependencies> = Dependencies extends readonly (infer Listed)[]
  ? Listed extends { readonly endpoints?: readonly (infer Selected)[] }
    ? Selected extends {
        readonly visibility: infer Visibility extends string;
        readonly name: infer Name extends string;
      }
      ? Visibility extends 'public'
        ? never
        : `${Name} is ${Visibility}`
      : never
    : never
  : never;

/** What an Application must also satisfy: it depends on Public Endpoints only, as it runs outside the network. */
type PublicOnlyRule<Declaration extends ApplicationContractDeclaration> = [
  NonPublicOf<Declaration['dependencies']>,
] extends [never]
  ? unknown
  : {
      readonly dependencies: `An Application depends on Public Endpoints only: ${JoinedNames<NonPublicOf<Declaration['dependencies']>>}`;
    };

/** An Application's declared Contract, published so the registry records every use of a Service's Elements, an Application's included. */
export type ApplicationContract<
  Declaration extends ApplicationContractDeclaration = ApplicationContractDeclaration,
> = Readonly<Declaration> & { readonly kind: 'application' };

/** A Contract as the glossary defines it: a Service's or an Application's. */
export type Contract = ServiceContract | ApplicationContract;

/** What `generate` runs on: a Service's Contract, an Application's Contract or a Definitions Package. */
export type Root = Contract | Definitions;

/** The kind of a Root, which its Snapshot's `kind` repeats and `cf-loom init` takes. */
export type RootKind = Root['kind'];

/** Declares a Service's Contract from everything it offers, keeps and requires. */
export function defineService<const Declaration extends ServiceContractDeclaration>(
  declaration: Declaration & NoInfer<DeclaredFieldsRule<Declaration, ServiceContractDeclaration>>,
): ServiceContract<Declaration> {
  return freezeDeclaration('service', declaration);
}

/** Declares an Application's Contract, which holds only Dependencies. */
export function defineApplication<const Declaration extends ApplicationContractDeclaration>(
  declaration: Declaration &
    PublicOnlyRule<Declaration> &
    NoInfer<DeclaredFieldsRule<Declaration, ApplicationContractDeclaration>>,
): ApplicationContract<Declaration> {
  return freezeDeclaration('application', declaration);
}
