import type * as core from 'zod/v4/core';
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

/** A declared Definitions Package, which a Contract lists on its root to resolve what it imports. */
export type Definitions<Declaration extends DefinitionsDeclaration = DefinitionsDeclaration> =
  Readonly<Declaration> & { readonly kind: 'definitions' };

/** Declares the Guards, schemas and Rejections several Contracts share, and their Standard Rejections. */
export function defineDefinitions<const Declaration extends DefinitionsDeclaration>(
  declaration: Declaration & NoInfer<DeclaredFieldsRule<Declaration, DefinitionsDeclaration>>,
): Definitions<Declaration> {
  return Object.freeze({ ...declaration, kind: 'definitions' });
}
