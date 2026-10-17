import type * as core from 'zod/v4/core';
import type { LowerCaseHeaderNames } from './http.ts';
import type { Rejection } from './rejection.ts';

/** What a Guard may demand from a request: headers and query params, never the body or the path. */
type Demands = {
  readonly headers?: core.$ZodObject;
  readonly query?: core.$ZodObject;
  readonly params?: never;
  readonly body?: never;
};

/** What an author writes to declare a Guard; an absent part demands or provides nothing. */
type GuardDeclaration = {
  readonly name: string;
  readonly description: string;
  readonly demands?: Demands;
  readonly context?: core.$ZodType;
  readonly rejections?: readonly Rejection[];
};

/** A declared Guard, which an Endpoint attaches and each Service implements with its GuardHandler. */
export type Guard<Declaration extends GuardDeclaration = GuardDeclaration> =
  Readonly<Declaration> & { readonly kind: 'guard' };

type DemandedHeadersRule<Declaration extends GuardDeclaration> = {
  readonly demands?: {
    readonly headers?: LowerCaseHeaderNames<NonNullable<Declaration['demands']>['headers']>;
  };
};

/** Declares a reusable requirement that Endpoints attach explicitly. */
export function defineGuard<const Declaration extends GuardDeclaration>(
  declaration: Declaration & DemandedHeadersRule<Declaration>,
): Guard<Declaration> {
  return Object.freeze({ ...declaration, kind: 'guard' });
}
