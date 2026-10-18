import type * as core from 'zod/v4/core';
import { freezeDeclaration } from './freeze-declaration.ts';
import type { HeaderNamesRule } from './http.ts';
import type { Rejection } from './rejection.ts';
import type { DeclaredFieldsRule } from './rules.ts';

type GuardDemandsRefusal = 'A Guard demands only headers and query';

/** What a Guard may demand from a request: headers and query params, never the body or the path. */
type Demands = {
  readonly headers?: core.$ZodObject;
  readonly query?: core.$ZodObject;
  readonly params?: GuardDemandsRefusal;
  readonly body?: GuardDemandsRefusal;
};

/** What an author writes to declare a Guard; an absent part demands, reads or provides nothing. */
type GuardDeclaration = {
  readonly name: string;
  readonly description: string;
  readonly demands?: Demands;
  readonly guards?: readonly Guard[];
  readonly context?: core.$ZodType;
  readonly qualifier?: core.$ZodType;
  readonly rejections?: readonly Rejection[];
};

/** A declared Guard, which Endpoints attach and each Service implements with a GuardHandler. */
export type Guard<Declaration extends GuardDeclaration = GuardDeclaration> =
  Readonly<Declaration> & { readonly kind: 'guard' };

/** A Guard that declares a `qualifier`, so every Endpoint lists it with a Qualifier. */
export type QualifiedGuard = Guard & { readonly qualifier: core.$ZodType };

type DemandedHeadersRule<Declaration extends GuardDeclaration> = {
  readonly demands?: {
    readonly headers?: HeaderNamesRule<NonNullable<Declaration['demands']>['headers']>;
  };
};

type DemandsFieldsRule<Declaration extends GuardDeclaration> = {
  readonly demands?: DeclaredFieldsRule<NonNullable<Declaration['demands']>, Demands>;
};

/** Declares a reusable requirement that Endpoints attach explicitly. */
export function defineGuard<const Declaration extends GuardDeclaration>(
  declaration: Declaration &
    DemandedHeadersRule<Declaration> &
    NoInfer<DeclaredFieldsRule<Declaration, GuardDeclaration> & DemandsFieldsRule<Declaration>>,
): Guard<Declaration> {
  return freezeDeclaration('guard', declaration);
}
