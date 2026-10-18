import type * as core from 'zod/v4/core';
import { frozenDeclaration } from './frozen-declaration.ts';
import type { HeaderNamesRule } from './http.ts';
import type { Rejection } from './rejection.ts';
import type { DeclaredFieldsRule } from './rules.ts';

/** What a Guard may demand from a request: headers and query params, never the body or the path. */
type Demands = {
  readonly headers?: core.$ZodObject;
  readonly query?: core.$ZodObject;
  readonly params?: 'A Guard demands only headers and query';
  readonly body?: 'A Guard demands only headers and query';
};

/** What an author writes to declare a Guard; an absent part demands, reads or provides nothing. */
type GuardDeclaration = {
  readonly name: string;
  readonly description: string;
  readonly demands?: Demands;
  readonly guards?: readonly Guard[];
  readonly context?: core.$ZodType;
  readonly rejections?: readonly Rejection[];
};

/** A declared Guard, which Endpoints attach and each Service implements with a GuardHandler. */
export type Guard<Declaration extends GuardDeclaration = GuardDeclaration> =
  Readonly<Declaration> & { readonly kind: 'guard' };

type DemandedHeadersRule<Declaration extends GuardDeclaration> = {
  readonly demands?: {
    readonly headers?: HeaderNamesRule<NonNullable<Declaration['demands']>['headers']>;
  };
};

/** Declares a reusable requirement that Endpoints attach explicitly. */
export function defineGuard<const Declaration extends GuardDeclaration>(
  declaration: Declaration &
    DemandedHeadersRule<Declaration> &
    NoInfer<DeclaredFieldsRule<Declaration, GuardDeclaration>>,
): Guard<Declaration> {
  return frozenDeclaration('guard', declaration);
}
