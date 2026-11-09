import type { Joined } from '../lines/index.ts';
import { freezeDeclaration } from './freeze-declaration.ts';
import type { ProvidedEndpoint, ProviderNameOf } from './provided.ts';
import type { OneProviderSentence } from './refusals.ts';
import type {
  DeclaredFieldsRule,
  IsOneLiteral,
  ListedOnce,
  LiteralNames,
  Refusal,
} from './rules.ts';

/** What an author writes to declare a Dependency: the Endpoints its owner calls, one or more, all one Provider's. */
type DependencyDeclaration = {
  readonly endpoints: readonly [ProvidedEndpoint, ...ProvidedEndpoint[]];
};

/** What a Contract calls of one Provider: the Provided Endpoints it lists, each carrying its Provider. */
export type Dependency<
  Endpoints extends readonly ProvidedEndpoint[] = readonly ProvidedEndpoint[],
> = {
  readonly kind: 'dependency';
  readonly endpoints: Endpoints;
};

/** The Providers of the Endpoints listed, each once, in the order the Endpoints list them, its open part last. */
type ProviderList<Endpoints, Listed extends readonly string[] = []> = Endpoints extends readonly [
  infer First,
  ...infer Rest,
]
  ? ProviderList<Rest, ListedOnce<Listed, ProviderNameOf<First> & string>>
  : Endpoints extends readonly (infer Open)[]
    ? ListedOnce<Listed, ProviderNameOf<Open> & string>
    : Listed;

/** The names of the Providers whose Endpoints a declaration lists, as their types give them. */
type ListedProvidersOf<Declaration extends DependencyDeclaration> = LiteralNames<
  ProviderList<Declaration['endpoints']>[number]
>;

/** What a Dependency must also satisfy: its Endpoints are one Provider's, since one client calls one base URL. */
type OneProviderRule<Declaration extends DependencyDeclaration> = [
  ListedProvidersOf<Declaration>,
] extends [never]
  ? unknown
  : IsOneLiteral<ListedProvidersOf<Declaration>> extends true
    ? unknown
    : {
        readonly endpoints: Refusal<
          OneProviderSentence<Joined<ProviderList<Declaration['endpoints']>, 'and'>>
        >;
      };

/** Declares the Endpoints a Contract calls of one Provider, so its client reaches no more. */
export function defineDependency<const Declaration extends DependencyDeclaration>(
  declaration: Declaration &
    OneProviderRule<Declaration> &
    NoInfer<DeclaredFieldsRule<Declaration, DependencyDeclaration>>,
): Dependency<Declaration['endpoints']> {
  return freezeDeclaration('dependency', declaration);
}
