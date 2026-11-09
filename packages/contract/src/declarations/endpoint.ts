import type * as core from 'zod/v4/core';
import type { SchemaRule } from '../walker/index.ts';
import type { AttachedGuardOf, Attachment, AttachmentsRule } from './attachment.ts';
import type { Visibility } from './element.ts';
import { freezeDeclaration } from './freeze-declaration.ts';
import type { Guard } from './guard.ts';
import type { HeaderNamesRule, Method, SuccessStatus } from './http.ts';
import type { PathParamList, PathParams } from './path-params.ts';
import type {
  ExactParamsSentence,
  getBodySentence,
  ListedTwiceSentence,
  noContentBodySentence,
  noParamsSentence,
  RequiresEarlierSentence,
  SuccessBodySentence,
} from './refusals.ts';
import type { Rejection } from './rejection.ts';
import type {
  DeclaredFieldsRule,
  IsOneLiteral,
  LiteralNames,
  Refusal,
  RejectionsOnceRule,
  ReservedNameRule,
} from './rules.ts';
import type { AddedStandardRejectionName, StandardRejection } from './standard-rejections.ts';

/** What a Caller sends, part by part; an absent part is not accepted. */
type InputDeclaration = {
  readonly params?: core.$ZodObject;
  readonly query?: core.$ZodObject;
  readonly headers?: core.$ZodObject;
  readonly body?: core.$ZodType;
};

/** What an Endpoint promises when it does what was asked; a rule says which carry a body. */
type SuccessDeclaration = {
  readonly status: SuccessStatus;
  readonly headers?: core.$ZodObject;
  readonly body?: core.$ZodType;
};

/** When an Endpoint is Deprecated: the instant its `Deprecation` header names, in UTC to the second. */
type DeprecationDeclaration =
  | { readonly lifecycle?: 'active' | 'retired'; readonly deprecatedAt?: never }
  | { readonly lifecycle: 'deprecated'; readonly deprecatedAt: string };

/** What an author writes to declare an Endpoint; a `lifecycle` left out is Active, a list empty. */
export type EndpointDeclaration = {
  readonly name: string;
  readonly method: Method;
  readonly path: string;
  readonly visibility: Visibility;
  readonly description: string;
  readonly input?: InputDeclaration;
  readonly success: SuccessDeclaration;
  readonly guards?: readonly Attachment[];
  readonly rejections?: readonly (
    | Rejection
    | StandardRejection<Exclude<StandardRejection['name'], AddedStandardRejectionName>>
  )[];
} & DeprecationDeclaration;

/** A declared Endpoint, kept as written so its Handlers, client and the walker read one schema. */
export type Endpoint<Declaration extends EndpointDeclaration = EndpointDeclaration> =
  Readonly<Declaration> & { readonly kind: 'endpoint' };

type InputOfDeclaration<Declaration extends EndpointDeclaration> = NonNullable<
  Declaration['input']
>;

type ParamsRule<Declaration extends EndpointDeclaration> = string extends Declaration['path']
  ? unknown
  : [PathParams<Declaration['path']>] extends [never]
    ? { readonly input?: { readonly params?: Refusal<typeof noParamsSentence> } }
    : {
        readonly input: {
          readonly params: ExactParamsRule<
            InputOfDeclaration<Declaration>['params'],
            Declaration['path']
          >;
        };
      };

type ExactParamsMessage<Path extends string> = Refusal<ExactParamsSentence<PathParamList<Path>>>;

type ExactParamsRule<Params, Path extends string> =
  Params extends core.$ZodObject<infer Shape>
    ? [Exclude<keyof Shape, PathParams<Path>>, Exclude<PathParams<Path>, keyof Shape>] extends [
        never,
        never,
      ]
      ? unknown
      : ExactParamsMessage<Path>
    : ExactParamsMessage<Path>;

type InputBodyRule<Declaration extends EndpointDeclaration> = Declaration['method'] extends 'GET'
  ? { readonly input?: { readonly body?: Refusal<typeof getBodySentence> } }
  : unknown;

type SuccessBodyRule<Declaration extends EndpointDeclaration> =
  IsOneLiteral<Declaration['success']['status']> extends true
    ? SuccessBodyOf<Declaration>
    : unknown;

type SuccessBodyOf<Declaration extends EndpointDeclaration> =
  Declaration['success']['status'] extends 204
    ? { readonly success?: { readonly body?: Refusal<typeof noContentBodySentence> } }
    : Declaration['success'] extends { readonly body: core.$ZodType }
      ? unknown
      : {
          readonly success: {
            readonly body: Refusal<SuccessBodySentence<Declaration['success']['status']>>;
          };
        };

type HeadersRule<Declaration extends EndpointDeclaration> = {
  readonly input?: {
    readonly headers?: HeaderNamesRule<InputOfDeclaration<Declaration>['headers']>;
  };
  readonly success?: {
    readonly headers?: HeaderNamesRule<Declaration['success']['headers']>;
  };
};

/** The names of the Guards a `guards` list holds that are not earlier, in its order, its open part once. */
type MissingGuardList<
  Required,
  Earlier extends string,
  Missing extends readonly string[] = [],
> = Required extends readonly [infer First, ...infer Rest]
  ? MissingGuardList<Rest, Earlier, MissingAppended<Missing, First, Earlier>>
  : Required extends readonly (infer Open)[]
    ? MissingAppended<Missing, Open, Earlier>
    : Missing;

type MissingAppended<Missing extends readonly string[], Listed, Earlier extends string> = [
  Exclude<GuardNameOf<Listed>, Earlier>,
] extends [never]
  ? Missing
  : [...Missing, Exclude<GuardNameOf<Listed>, Earlier>];

type GuardNameOf<Listed> = Listed extends Guard ? Listed['name'] : never;

type MissingGuardNames<Listed extends Guard, Earlier extends string> = Listed extends {
  readonly guards: infer Required;
}
  ? LiteralNames<MissingGuardList<Required, Earlier>[number]>
  : never;

/** One sentence naming the Guards `guards` lists that are not earlier, in its order. */
type RequiresEarlierMessage<Listed extends Guard, Earlier extends string> = Listed extends {
  readonly guards: infer Required;
}
  ? Refusal<RequiresEarlierSentence<Listed['name'], MissingGuardList<Required, Earlier>>>
  : never;

type GuardOrderRule<Guards, Earlier extends string = never> = Guards extends readonly [
  infer First,
  ...infer Rest,
]
  ? ListedOrderRule<AttachedGuardOf<First>, Rest, Earlier>
  : unknown;

type ListedOrderRule<Listed, Rest, Earlier extends string> = Listed extends Guard
  ? string extends Listed['name']
    ? GuardOrderRule<Rest, Earlier>
    : Listed['name'] extends Earlier
      ? Refusal<ListedTwiceSentence<Listed['name']>>
      : [MissingGuardNames<Listed, Earlier>] extends [never]
        ? GuardOrderRule<Rest, Earlier | Listed['name']>
        : RequiresEarlierMessage<Listed, Earlier>
  : unknown;

type GuardsRule<Declaration extends EndpointDeclaration> = {
  readonly guards?: GuardOrderRule<Declaration['guards']> &
    AttachmentsRule<NonNullable<Declaration['guards']>>;
};

type RejectionsRule<Declaration extends EndpointDeclaration> = {
  readonly rejections?: RejectionsOnceRule<Declaration['rejections']>;
};

type NestedFieldsRule<Declaration extends EndpointDeclaration> = {
  readonly input?: DeclaredFieldsRule<InputOfDeclaration<Declaration>, InputDeclaration>;
  readonly success?: DeclaredFieldsRule<Declaration['success'], SuccessDeclaration>;
};

type SchemasRule<Declaration extends EndpointDeclaration> = {
  readonly input?: {
    readonly [Part in keyof InputDeclaration]?: SchemaRule<InputOfDeclaration<Declaration>[Part]>;
  };
  readonly success?: {
    readonly headers?: SchemaRule<Declaration['success']['headers']>;
    readonly body?: SchemaRule<Declaration['success']['body']>;
  };
};

type EndpointRules<Declaration extends EndpointDeclaration> = ParamsRule<Declaration> &
  SchemasRule<Declaration> &
  InputBodyRule<Declaration> &
  SuccessBodyRule<Declaration> &
  HeadersRule<Declaration> &
  GuardsRule<Declaration> &
  RejectionsRule<Declaration> &
  NoInfer<
    ReservedNameRule<Declaration, 'endpoint'> &
      DeclaredFieldsRule<Declaration, EndpointDeclaration> &
      NestedFieldsRule<Declaration>
  >;

/** Declares one HTTP method on one literal path, refusing what TypeScript can state exactly. */
export function defineEndpoint<const Declaration extends EndpointDeclaration>(
  declaration: Declaration & EndpointRules<Declaration>,
): Endpoint<Declaration> {
  return freezeDeclaration('endpoint', declaration);
}
