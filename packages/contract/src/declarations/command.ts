import type { EventDeclaration } from './event.ts';
import { freezeDeclaration } from './freeze-declaration.ts';
import type { DeclaredFieldsRule, VersionRule } from './rules.ts';

/** What an author writes to declare one Message Version of a Command; it takes no Visibility, being always Private. */
type CommandDeclaration = Omit<EventDeclaration, 'visibility'>;

/** A declared Command's Message Version, which only its own Service sends and handles. */
export type Command<Declaration extends CommandDeclaration = CommandDeclaration> =
  Readonly<Declaration> & { readonly kind: 'command' };

/** Declares one Message Version of a Command, refusing what TypeScript can state exactly. */
export function defineCommand<const Declaration extends CommandDeclaration>(
  declaration: Declaration &
    VersionRule<Declaration> &
    NoInfer<DeclaredFieldsRule<Declaration, CommandDeclaration>>,
): Command<Declaration> {
  return freezeDeclaration('command', declaration);
}
