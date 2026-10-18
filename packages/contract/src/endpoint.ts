import type * as core from 'zod/v4/core';
import type { Lifecycle, Visibility } from './element.ts';
import { freezeDeclaration } from './freeze-declaration.ts';
import type { Guard } from './guard.ts';
import type { HeaderNamesRule, Method, SuccessStatus } from './http.ts';
import type { PathParams } from './path-params.ts';
import type { Rejection } from './rejection.ts';
import type { DeclaredFieldsRule, IsOneLiteral, JoinedNames, LiteralNames } from './rules.ts';
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

/** What an author writes to declare an Endpoint; a `lifecycle` left out is Active, a list empty. */
type EndpointDeclaration = {
  readonly name: string;
  readonly method: Method;
  readonly path: string;
  readonly visibility: Visibility;
  readonly description: string;
  readonly input?: InputDeclaration;
  readonly success: SuccessDeclaration;
  readonly guards?: readonly Guard[];
  readonly rejections?: readonly (
    | Rejection
    | StandardRejection<Exclude<StandardRejection['name'], AddedStandardRejectionName>>
  )[];
  readonly lifecycle?: Lifecycle;
};

/** A declared Endpoint, kept as written so its Handlers, client and the walker read one schema. */
export type Endpoint<Declaration extends EndpointDeclaration = EndpointDeclaration> =
  Readonly<Declaration> & { readonly kind: 'endpoint' };

type InputOfDeclaration<Declaration extends EndpointDeclaration> = NonNullable<
  Declaration['input']
>;

type ParamsRule<Declaration extends EndpointDeclaration> = string extends Declaration['path']
  ? unknown
  : [PathParams<Declaration['path']>] extends [never]
    ? { readonly input?: { readonly params?: 'A path without :names takes no params' } }
    : {
        readonly input: {
          readonly params: ExactParamsRule<
            InputOfDeclaration<Declaration>['params'],
            PathParams<Declaration['path']>
          >;
        };
      };

type ExactParamsMessage<Names extends string> =
  `params declares exactly the path's :names: ${JoinedNames<Names>}`;

type ExactParamsRule<Params, Names extends string> =
  Params extends core.$ZodObject<infer Shape>
    ? [Exclude<keyof Shape, Names>, Exclude<Names, keyof Shape>] extends [never, never]
      ? unknown
      : ExactParamsMessage<Names>
    : ExactParamsMessage<Names>;

type InputBodyRule<Declaration extends EndpointDeclaration> = Declaration['method'] extends
  | 'GET'
  | 'HEAD'
  ? { readonly input?: { readonly body?: 'A GET or HEAD Endpoint takes no body' } }
  : unknown;

type SuccessBodyRule<Declaration extends EndpointDeclaration> =
  IsOneLiteral<Declaration['success']['status']> extends true
    ? SuccessBodyOf<Declaration>
    : unknown;

type SuccessBodyOf<Declaration extends EndpointDeclaration> = Declaration['method'] extends 'HEAD'
  ? { readonly success?: { readonly body?: 'A HEAD Endpoint answers no body' } }
  : Declaration['success']['status'] extends 204
    ? { readonly success?: { readonly body?: 'A 204 Success has no body' } }
    : Declaration['success'] extends { readonly body: core.$ZodType }
      ? unknown
      : {
          readonly success: {
            readonly body: `A ${Declaration['success']['status']} Success has a body`;
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

type MissingGuardNames<Listed extends Guard, Earlier extends string> = Listed extends {
  readonly guards: readonly (infer Required extends Guard)[];
}
  ? Exclude<LiteralNames<Required['name']>, Earlier>
  : never;

type RequiresEarlierMessage<
  Name extends string,
  Missing extends string,
> = `${Name} requires ${JoinedNames<Missing>} earlier in guards`;

type GuardOrderRule<Guards, Earlier extends string = never> = Guards extends readonly [
  infer First extends Guard,
  ...infer Rest,
]
  ? string extends First['name']
    ? GuardOrderRule<Rest, Earlier>
    : First['name'] extends Earlier
      ? `${First['name']} is listed twice`
      : [MissingGuardNames<First, Earlier>] extends [never]
        ? GuardOrderRule<Rest, Earlier | First['name']>
        : RequiresEarlierMessage<First['name'], MissingGuardNames<First, Earlier>>
  : unknown;

type GuardsRule<Declaration extends EndpointDeclaration> = {
  readonly guards?: GuardOrderRule<Declaration['guards']>;
};

type NestedFieldsRule<Declaration extends EndpointDeclaration> = {
  readonly input?: DeclaredFieldsRule<InputOfDeclaration<Declaration>, InputDeclaration>;
  readonly success?: DeclaredFieldsRule<Declaration['success'], SuccessDeclaration>;
};

type EndpointRules<Declaration extends EndpointDeclaration> = ParamsRule<Declaration> &
  InputBodyRule<Declaration> &
  SuccessBodyRule<Declaration> &
  HeadersRule<Declaration> &
  GuardsRule<Declaration> &
  NoInfer<DeclaredFieldsRule<Declaration, EndpointDeclaration> & NestedFieldsRule<Declaration>>;

/** Declares one HTTP method on one literal path, refusing what TypeScript can state exactly. */
export function defineEndpoint<const Declaration extends EndpointDeclaration>(
  declaration: Declaration & EndpointRules<Declaration>,
): Endpoint<Declaration> {
  return freezeDeclaration('endpoint', declaration);
}
