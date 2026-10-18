import type * as core from 'zod/v4/core';
import { freezeDeclaration } from './freeze-declaration.ts';
import type { Guard } from './guard.ts';
import type { Rejection } from './rejection.ts';
import type { DeclaredFieldsRule } from './rules.ts';
import type {
  StandardRejectionDeclaration,
  StandardRejectionDeclarations,
} from './standard-rejections.ts';

/** What an author writes to declare a Definitions Package; an absent list is empty. */
type DefinitionsDeclaration = {
  readonly name: string;
  readonly guards?: readonly Guard[];
  readonly schemas?: Readonly<Record<string, core.$ZodType>>;
  readonly rejections?: readonly Rejection[];
  readonly standardRejections?: StandardRejectionDeclarations;
};

/** A declared Definitions Package, listed on a root to resolve what the Contract imports. */
export type Definitions<Declaration extends DefinitionsDeclaration = DefinitionsDeclaration> =
  Readonly<Declaration> & { readonly kind: 'definitions' };

type StandardRejectionsFieldsRule<Declared> = DeclaredFieldsRule<
  Declared,
  StandardRejectionDeclarations
> & {
  readonly [Name in keyof Declared]?: DeclaredFieldsRule<
    Declared[Name],
    StandardRejectionDeclaration
  >;
};

type NestedFieldsRule<Declaration extends DefinitionsDeclaration> = {
  readonly standardRejections?: StandardRejectionsFieldsRule<
    NonNullable<Declaration['standardRejections']>
  >;
};

/** Declares the Guards, schemas, Rejections and Standard Rejections several Contracts share. */
export function defineDefinitions<const Declaration extends DefinitionsDeclaration>(
  declaration: Declaration &
    NoInfer<
      DeclaredFieldsRule<Declaration, DefinitionsDeclaration> & NestedFieldsRule<Declaration>
    >,
): Definitions<Declaration> {
  return freezeDeclaration('definitions', declaration);
}
