import type * as core from 'zod/v4/core';
import { frozenDeclaration } from './frozen-declaration.ts';
import type { Guard } from './guard.ts';
import type { Rejection } from './rejection.ts';
import type { DeclaredFieldsRule } from './rules.ts';
import type { StandardRejectionDeclarations } from './standard-rejections.ts';

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

/** Declares the Guards, schemas, Rejections and Standard Rejections several Contracts share. */
export function defineDefinitions<const Declaration extends DefinitionsDeclaration>(
  declaration: Declaration & NoInfer<DeclaredFieldsRule<Declaration, DefinitionsDeclaration>>,
): Definitions<Declaration> {
  return frozenDeclaration('definitions', declaration);
}
