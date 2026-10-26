import type * as core from 'zod/v4/core';
import type { SchemaRule } from '../walker/index.ts';
import { freezeDeclaration } from './freeze-declaration.ts';
import type { RejectionStatus } from './http.ts';
import type { DeclaredFieldsRule } from './rules.ts';

/** What an author writes to declare a Rejection; a Rejection without `body` has none. */
export type RejectionDeclaration = {
  readonly code: string;
  readonly status: RejectionStatus;
  readonly message: string;
  readonly body?: core.$ZodType;
};

/** A declared Rejection, kept as written so a Handler can answer it by its declaration. */
export type Rejection<Declaration extends RejectionDeclaration = RejectionDeclaration> =
  Readonly<Declaration> & { readonly kind: 'rejection' };

type BodyRule<Declaration extends RejectionDeclaration> = {
  readonly body?: SchemaRule<Declaration['body']>;
};

/** Declares a Rejection once, to be referenced wherever it can be answered. */
export function defineRejection<const Declaration extends RejectionDeclaration>(
  declaration: Declaration &
    BodyRule<Declaration> &
    NoInfer<DeclaredFieldsRule<Declaration, RejectionDeclaration>>,
): Rejection<Declaration> {
  return freezeDeclaration('rejection', declaration);
}
