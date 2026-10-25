import { freezeDeclaration } from './freeze-declaration.ts';
import type { DeclaredFieldsRule } from './rules.ts';
import type {
  StandardRejectionDeclaration,
  StandardRejectionDeclarations,
} from './standard-rejections.ts';

/**
 * What an author writes to declare a Definitions Package, which the package.json it is published
 * from names: the Standard Rejections it declares, if any.
 */
type DefinitionsDeclaration = {
  readonly standardRejections?: StandardRejectionDeclarations;
};

/**
 * A declared Definitions Package, which a Contract names as `standardRejections` to take its
 * Standard Rejections. What it holds is what its root file exports beside it: Guards, Rejections
 * and zod schemas, each under the name Services import it by.
 */
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

/**
 * Declares a Definitions Package; the Guards, Rejections and zod schemas its root file exports
 * beside it are what it shares.
 */
export function defineDefinitions<const Declaration extends DefinitionsDeclaration>(
  declaration: Declaration &
    NoInfer<
      DeclaredFieldsRule<Declaration, DefinitionsDeclaration> & NestedFieldsRule<Declaration>
    >,
): Definitions<Declaration> {
  return freezeDeclaration('definitions', declaration);
}
