import type { NotAllowed, Path } from '../walker/nodes.ts';

/** The rules `generate` enforces on declarations, by id, so a caller and a test decide by rule. */
export type Rule =
  | 'canonical-path'
  | 'duplicate-path-param'
  | 'params'
  | 'optional-path-param'
  | 'name-grammar'
  | 'duplicate-endpoint-name'
  | 'duplicate-endpoint-identity'
  | 'duplicate-guard-name'
  | 'group-membership'
  | 'empty-group'
  | 'method'
  | 'visibility'
  | 'lifecycle'
  | 'success-status'
  | 'success-body'
  | 'input-body'
  | 'header-names'
  | 'text-only'
  | 'input-conflict'
  | 'undeclared-field'
  | 'guard-demands'
  | 'guard-order'
  | 'guard-once'
  | 'attachment'
  | 'qualifier-value'
  | 'qualifier-keys'
  | 'rejection-status'
  | 'code-conflict'
  | 'reserved-code'
  | 'standard-rejection'
  | 'standard-rejections-once'
  | 'dependency-selection'
  | 'application-dependency'
  | 'schema';

/** A declaration that breaks a rule: where it sits, which rule, and the sentence a developer reads. */
export type DeclarationFailure = {
  readonly kind: 'declaration';
  readonly at: Path;
  readonly rule: Rule;
  readonly message: string;
};

/** What makes a root invalid: a declaration that breaks a rule, or a construct that is not allowed. */
export type Failure = DeclarationFailure | NotAllowed;

/** One declaration failure, as every rule returns it. */
export function failure(at: Path, rule: Rule, message: string): DeclarationFailure {
  return { kind: 'declaration', at, rule, message };
}
