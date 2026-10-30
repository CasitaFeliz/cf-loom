import {
  type Place,
  type Site,
  type Step,
  siteLocationOf,
  siteTextOf,
  stepListOf,
} from '../walker/index.ts';

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
  | 'shared-text'
  | 'unsendable-text'
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
  | 'dependency-package'
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
  readonly site: Site;
  readonly steps: readonly Step[];
  readonly rule: Rule;
  readonly message: string;
  /** The declaration the failure sits in, so a tool that knows its file can name it. */
  readonly declaration: unknown;
};

/** A construct the walker refuses, once for the one schema it sits in, however many sites reach it. */
export type NotAllowedFailure = {
  readonly kind: 'not-allowed';
  readonly site: Site;
  readonly steps: readonly Step[];
  readonly construct: string;
  readonly instead?: string;
  /** The declaration the failure sits in, none when the Snapshot, not a declaration, is judged. */
  readonly declaration: unknown;
  /** The other sites that reach the same schema, in code point order. */
  readonly alsoIn: readonly Site[];
  /** The origin as the Snapshot writes it, `<package>@<version>#<name>`, when a Definitions Package declares the schema. */
  readonly origin: string | undefined;
};

/** What makes a Root invalid: a declaration that breaks a rule, or a construct that is not allowed. */
export type Failure = DeclarationFailure | NotAllowedFailure;

/** One declaration failure, as every rule returns it. */
export function failure(at: Place, rule: Rule, message: string): DeclarationFailure {
  const { site, steps, declaration } = at;
  return { kind: 'declaration', site, steps: stepListOf(steps), rule, message, declaration };
}

/** One failure on one line, where it sits first, as every tool that reports a Root's rules words it. */
export function failureLineOf(broken: Failure): string {
  const location = siteLocationOf(broken.site, broken.steps);
  switch (broken.kind) {
    case 'declaration':
      return `${location} ${broken.rule}: ${broken.message}`;
    case 'not-allowed':
      return `${location} not allowed: ${notAllowedWordsOf(broken)}`;
  }
}

/** The construct, what to use instead, the other sites that reach it and the package that declares it. */
function notAllowedWordsOf({ construct, instead, alsoIn, origin }: NotAllowedFailure): string {
  const use = instead === undefined ? [] : [`(use ${instead})`];
  const also = alsoIn.length === 0 ? [] : [`(also in ${alsoIn.map(siteTextOf).join(', ')})`];
  const declared = origin === undefined ? [] : [`(declared in ${origin})`];
  return [construct, ...use, ...also, ...declared].join(' ');
}
