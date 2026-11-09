import type { Definitions } from './definitions.ts';
import type { Dependency } from './dependency.ts';
import { freezeDeclaration } from './freeze-declaration.ts';
import type { Group } from './group.ts';
import type { ProviderNameOf } from './provided.ts';
import type { NotPublicEndpoint, NotPublicSentence, OwnProviderSentence } from './refusals.ts';
import type { DeclaredFieldsRule, LiteralNames, Refusal } from './rules.ts';

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

/** The Endpoints the Dependencies of a declaration list. */
type ListedEndpointsOf<Dependencies> = Dependencies extends readonly (infer Listed)[]
  ? Listed extends { readonly endpoints?: readonly (infer Selected)[] }
    ? Selected
    : never
  : never;

/**
 * Each Endpoint that is not Public out of the Dependencies an Application lists, as
 * `payments-service's getPayment is internal`.
 */
type NonPublicOf<Dependencies> =
  ListedEndpointsOf<Dependencies> extends infer Selected
    ? Selected extends {
        readonly visibility: infer Visibility extends string;
        readonly name: infer Name extends string;
      }
      ? Visibility extends 'public'
        ? never
        : NotPublicEndpoint<ProviderNameOf<Selected> & string, Name, Visibility>
      : never
    : never;

/** What an Application must also satisfy: it depends on Public Endpoints only, as it runs outside the network. */
type PublicOnlyRule<Declaration extends ApplicationContractDeclaration> = [
  NonPublicOf<Declaration['dependencies']>,
] extends [never]
  ? unknown
  : {
      readonly dependencies: Refusal<NotPublicSentence<NonPublicOf<Declaration['dependencies']>>>;
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

/** The Providers of the Endpoints a Service's Dependencies list and of the Events its Subscriptions receive. */
type ProvidersOf<Declaration extends ServiceContractDeclaration> = LiteralNames<
  | ProviderNameOf<ListedEndpointsOf<Declaration['dependencies']>>
  | ProviderNameOf<SubscribedEventOf<Declaration['groups']>>
>;

/** The Events the Subscriptions of a declaration's Groups receive. */
type SubscribedEventOf<Groups> = Groups extends readonly (infer Listed)[]
  ? Listed extends { readonly subscriptions?: readonly (infer Subscribed)[] }
    ? Subscribed extends { readonly event: infer Received }
      ? Received
      : never
    : never
  : never;

/**
 * What a Service must also satisfy: a Provider is another Service, so it depends on and subscribes
 * through no Element of its own Contract Package.
 */
type OtherProvidersRule<Declaration extends ServiceContractDeclaration> =
  Declaration['name'] extends ProvidersOf<Declaration>
    ? { readonly name: Refusal<OwnProviderSentence<Declaration['name']>> }
    : unknown;

/** Declares a Service's Contract from everything it offers, keeps and requires. */
export function defineService<const Declaration extends ServiceContractDeclaration>(
  declaration: Declaration &
    OtherProvidersRule<Declaration> &
    NoInfer<DeclaredFieldsRule<Declaration, ServiceContractDeclaration>>,
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
