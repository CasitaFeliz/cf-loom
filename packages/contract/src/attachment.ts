import type * as core from 'zod/v4/core';
import type { Guard } from './guard.ts';
import type { DeclaredFieldsRule } from './rules.ts';

/** A Guard as an Endpoint lists it with its Qualifier, for a Guard that declares a `qualifier`. */
export type Attachment = {
  readonly guard: Guard;
  readonly qualifier: unknown;
};

/** The Guard an Endpoint's entry names, so every Guard rule reads bare Guards and Attachments alike. */
export type AttachedGuard<Entry> = Entry extends { readonly guard: infer Attached extends Guard }
  ? Attached
  : Entry;

type QualifiedGuard = Guard & { readonly qualifier: core.$ZodType };

type Written<Value> = Value extends object
  ? { readonly [Key in keyof Value]: Written<Value[Key]> }
  : Value;

type BareRule<Listed extends Guard> = Listed extends QualifiedGuard
  ? `${Listed['name']} needs a qualifier: { guard, qualifier }`
  : unknown;

type QualifierRule<Listed extends Guard> = Listed extends QualifiedGuard
  ? Written<core.input<Listed['qualifier']>>
  : 'qualifier' extends keyof Listed
    ? unknown
    : `${Listed['name']} takes no qualifier`;

type AttachedRule<Entry extends Attachment> = {
  readonly qualifier: QualifierRule<Entry['guard']>;
} & DeclaredFieldsRule<Entry, Attachment>;

type EntryRule<Entry> = Entry extends Attachment
  ? AttachedRule<Entry>
  : Entry extends Guard
    ? BareRule<Entry>
    : unknown;

/** What an Endpoint's `guards` must also satisfy: each Guard listed bare or attached as it declares. */
export type AttachmentsRule<Guards> = {
  readonly [Index in keyof Guards]: EntryRule<Guards[Index]>;
};
