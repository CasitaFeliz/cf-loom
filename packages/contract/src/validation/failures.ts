import type { NotAllowed, Path } from '../walker/index.ts';

/** The rules `generate` enforces on declarations, one id per documented rule, so a caller decides by rule. */
export type Rule =
  | 'not-a-root'
  | 'not-a-list'
  | 'not-a-declaration'
  | 'not-a-schema'
  | 'undeclared-field'
  | 'required-field'
  | 'not-a-string'
  | 'name-grammar'
  | 'duplicate-group-name'
  | 'duplicate-definitions-name'
  | 'duplicate-endpoint-name'
  | 'duplicate-endpoint-identity'
  | 'duplicate-guard-name'
  | 'duplicate-dependency'
  | 'group-membership'
  | 'empty-group'
  | 'canonical-path'
  | 'duplicate-path-param'
  | 'exact-params'
  | 'optional-path-param'
  | 'method'
  | 'visibility'
  | 'lifecycle'
  | 'success-status'
  | 'success-body'
  | 'input-body'
  | 'not-an-object'
  | 'not-an-object-schema'
  | 'nullable-text'
  | 'not-text'
  | 'header-names'
  | 'input-conflict'
  | 'guard-demands'
  | 'guard-order'
  | 'guard-once'
  | 'not-an-attachment'
  | 'attachment-needs-qualifier'
  | 'attachment-takes-no-qualifier'
  | 'qualifier-value'
  | 'qualifier-keys'
  | 'rejection-status'
  | 'code-status-conflict'
  | 'code-body-conflict'
  | 'reserved-code'
  | 'standard-rejection-listed'
  | 'standard-rejection-on-guard'
  | 'standard-code-redefined'
  | 'standard-codes-distinct'
  | 'standard-rejections-once'
  | 'dependency-selection'
  | 'application-dependency'
  | 'definitions-unlisted';

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
