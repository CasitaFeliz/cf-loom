import type * as core from 'zod/v4/core';
import type { Guard, IsWidenedGuard, QualifiedGuard } from './guard.ts';
import type { DeclaredFieldsRule } from './rules.ts';

/** A Guard as an Endpoint lists it with its Qualifier, for a Guard that declares a `qualifier`. */
export type QualifiedAttachment = {
  readonly guard: Guard;
  readonly qualifier: unknown;
};

/** An entry of an Endpoint's `guards`: a Guard, or a QualifiedAttachment when it declares a `qualifier`. */
export type Attachment = Guard | QualifiedAttachment;

/** The Guard an Attachment names, so every Guard rule reads bare and qualified Attachments alike. */
export type AttachedGuardOf<Listed> = Listed extends {
  readonly guard: infer Attached extends Guard;
}
  ? Attached
  : Listed;

/** What an author may write for a Qualifier: a `const` declaration infers its arrays read-only. */
type ConstInferred<Value> = Value extends object
  ? { readonly [Key in keyof Value]: ConstInferred<Value[Key]> }
  : Value;

type ItemOf<Accepted> = Accepted extends readonly (infer Item)[] ? Item : never;

type FieldsOfEach<Written, Accepted> = Accepted extends unknown
  ? DeclaredFieldsRule<Written, Accepted> & {
      readonly [Key in keyof Written & keyof Accepted]: QualifierFieldsRule<
        Written[Key],
        Accepted[Key]
      >;
    }
  : never;

/** What a written Qualifier must also satisfy: each object in it holds only the keys its schema declares. */
type QualifierFieldsRule<Written, Accepted> = Written extends readonly unknown[]
  ? { readonly [Index in keyof Written]: QualifierFieldsRule<Written[Index], ItemOf<Accepted>> }
  : Written extends object
    ? [Extract<Accepted, object>] extends [never]
      ? unknown
      : FieldsOfEach<Written, Extract<Accepted, object>>
    : unknown;

type BareRule<Listed extends Guard> = Listed extends QualifiedGuard
  ? `${Listed['name']} needs a qualifier: { guard, qualifier }`
  : unknown;

type QualifierRule<Listed extends QualifiedAttachment, Qualified extends QualifiedGuard> = {
  readonly guard: Qualified;
  readonly qualifier: ConstInferred<core.input<Qualified['qualifier']>> &
    QualifierFieldsRule<Listed['qualifier'], core.input<Qualified['qualifier']>>;
} & DeclaredFieldsRule<Listed, QualifiedAttachment>;

type QualifiedRule<Listed extends QualifiedAttachment> = Listed['guard'] extends QualifiedGuard
  ? QualifierRule<Listed, Listed['guard']>
  : `${Listed['guard']['name']} takes no qualifier`;

type ListedRule<Listed> = Listed extends QualifiedAttachment
  ? QualifiedRule<Listed>
  : Listed extends Guard
    ? BareRule<Listed>
    : unknown;

type JudgedRule<Listed> =
  AttachedGuardOf<Listed> extends infer Attached extends Guard
    ? IsWidenedGuard<Attached> extends true
      ? unknown
      : ListedRule<Listed>
    : unknown;

/** What an Endpoint's `guards` must also satisfy: each Guard listed bare or qualified as it declares. */
export type AttachmentsRule<Guards> = {
  readonly [Index in keyof Guards]: JudgedRule<Guards[Index]>;
};
