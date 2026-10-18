import type * as core from 'zod/v4/core';
import type { Lifecycle, Visibility } from './element.ts';
import type { Guard } from './guard.ts';
import type { LowerCaseHeaderNames, Method, SuccessStatus } from './http.ts';
import type { PathParams } from './path-params.ts';
import type { Rejection } from './rejection.ts';
import type { StandardRejection } from './standard-rejections.ts';

/** What a Caller sends, part by part; an absent part is not accepted. */
type InputDeclaration = {
  readonly params?: core.$ZodObject;
  readonly query?: core.$ZodObject;
  readonly headers?: core.$ZodObject;
  readonly body?: core.$ZodType;
};

/** What an Endpoint promises when it does what was asked: only a 204 has no body. */
type SuccessDeclaration =
  | { readonly status: 204; readonly headers?: core.$ZodObject; readonly body?: never }
  | {
      readonly status: Exclude<SuccessStatus, 204>;
      readonly headers?: core.$ZodObject;
      readonly body: core.$ZodType;
    };

/** What an author writes to declare an Endpoint; `lifecycle` defaults to Active and the lists to empty. */
type EndpointDeclaration = {
  readonly name: string;
  readonly method: Method;
  readonly path: string;
  readonly visibility: Visibility;
  readonly description: string;
  readonly input?: InputDeclaration;
  readonly success: SuccessDeclaration;
  readonly guards?: readonly Guard[];
  readonly rejections?: readonly (Rejection | StandardRejection<'notFound'>)[];
  readonly lifecycle?: Lifecycle;
};

/** A declared Endpoint, kept as written so its Handlers, its client and the walker read the same schemas. */
export type Endpoint<Declaration extends EndpointDeclaration = EndpointDeclaration> =
  Readonly<Declaration> & { readonly kind: 'endpoint' };

type InputOfDeclaration<Declaration extends EndpointDeclaration> = NonNullable<
  Declaration['input']
>;

type ParamsRule<Declaration extends EndpointDeclaration> = [
  PathParams<Declaration['path']>,
] extends [never]
  ? { readonly input?: { readonly params?: 'A path without :names takes no params' } }
  : {
      readonly input: {
        readonly params: ExactParams<
          InputOfDeclaration<Declaration>['params'],
          PathParams<Declaration['path']>
        >;
      };
    };

type ExactParams<Params, Names extends string> =
  Params extends core.$ZodObject<infer Shape>
    ? [Exclude<keyof Shape, Names>, Exclude<Names, keyof Shape>] extends [never, never]
      ? unknown
      : `params declares exactly the path's :names: ${Names}`
    : `params declares exactly the path's :names: ${Names}`;

type BodyRule<Declaration extends EndpointDeclaration> = Declaration['method'] extends
  | 'GET'
  | 'HEAD'
  ? { readonly input?: { readonly body?: 'A GET or HEAD Endpoint takes no body' } }
  : unknown;

type HeadersRule<Declaration extends EndpointDeclaration> = {
  readonly input?: {
    readonly headers?: LowerCaseHeaderNames<InputOfDeclaration<Declaration>['headers']>;
  };
  readonly success?: {
    readonly headers?: LowerCaseHeaderNames<Declaration['success']['headers']>;
  };
};

type RequiredGuardNames<Listed extends Guard> = Listed extends {
  readonly guards: readonly (infer Required extends Guard)[];
}
  ? Required['name']
  : never;

type GuardOrder<Guards, Earlier extends string = never> = Guards extends readonly [
  infer First extends Guard,
  ...infer Rest,
]
  ? First['name'] extends Earlier
    ? `${First['name']} is listed twice`
    : [Exclude<RequiredGuardNames<First>, Earlier>] extends [never]
      ? GuardOrder<Rest, Earlier | First['name']>
      : `${First['name']} requires ${Exclude<RequiredGuardNames<First>, Earlier>} earlier in guards`
  : unknown;

type GuardsRule<Declaration extends EndpointDeclaration> = {
  readonly guards?: GuardOrder<Declaration['guards']>;
};

type EndpointRules<Declaration extends EndpointDeclaration> = ParamsRule<Declaration> &
  BodyRule<Declaration> &
  HeadersRule<Declaration> &
  GuardsRule<Declaration>;

/** Declares one HTTP method on one literal path, refusing in its type what TypeScript can state exactly. */
export function defineEndpoint<const Declaration extends EndpointDeclaration>(
  declaration: Declaration & EndpointRules<Declaration>,
): Endpoint<Declaration> {
  return Object.freeze({ ...declaration, kind: 'endpoint' });
}
