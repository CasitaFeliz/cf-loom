import type { NotAllowed, Path } from '../walker/index.ts';

/** The rules `generate` enforces on declarations, one id per documented rule, so a caller decides by rule. */
export type Rule =
  | 'not-a-list'
  | 'not-a-declaration'
  | 'not-a-schema'
  | 'undeclared-field'
  | 'required-field'
  | 'not-a-string'
  | 'blank-text'
  | 'name-grammar'
  | 'duplicate-group-name'
  | 'duplicate-endpoint-name'
  | 'duplicate-endpoint-identity'
  | 'duplicate-guard-name'
  | 'duplicate-dependency'
  | 'group-membership'
  | 'provided-element'
  | 'empty-group'
  | 'canonical-path'
  | 'duplicate-path-param'
  | 'exact-params'
  | 'optional-path-param'
  | 'method'
  | 'visibility'
  | 'lifecycle'
  | 'deprecated-at'
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
  | 'rejection-once'
  | 'reserved-code'
  | 'standard-rejection-listed'
  | 'standard-rejection-on-guard'
  | 'dependency-selection'
  | 'application-dependency'
  | 'dependency-provider'
  | 'unused-dependency'
  | 'message-version'
  | 'duplicate-message-identity'
  | 'message-kind'
  | 'command-active-versions'
  | 'subscription-event'
  | 'retired-event-subscribed'
  | 'duplicate-subscription-name'
  | 'definitions-export'
  | 'definitions-unexported'
  | 'definitions-ambiguous'
  | 'definitions-unidentified'
  | 'code-once'
  | 'package-name';

/** A declaration that breaks a rule: where it sits, which rule, and the sentence a developer reads. */
export type DeclarationFailure = {
  readonly kind: 'declaration';
  readonly at: Path;
  readonly rule: Rule;
  readonly message: string;
};

/** What makes a Root invalid: a declaration that breaks a rule, or a construct that is not allowed. */
export type Failure = DeclarationFailure | NotAllowed;

/** One declaration failure, as every rule returns it. */
export function failure(at: Path, rule: Rule, message: string): DeclarationFailure {
  return { kind: 'declaration', at, rule, message };
}

/** Where something sits in a Snapshot on one line, its segments joined by dots, `(root)` for none. */
export function locationOf(at: Path): string {
  return at.length === 0 ? '(root)' : at.join('.');
}

/** One failure on one line, where it sits first, as every tool that reports a Root's rules words it. */
export function failureLineOf(broken: Failure): string {
  const location = locationOf(broken.at);
  switch (broken.kind) {
    case 'declaration':
      return `${location} ${broken.rule}: ${broken.message}`;
    case 'not-allowed':
      return broken.instead === undefined
        ? `${location} not allowed: ${broken.construct}`
        : `${location} not allowed: ${broken.construct} (use ${broken.instead})`;
  }
}
