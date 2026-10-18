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

type QualifiedRule<Entry extends Attachment> = {
  readonly guard: Entry['guard'];
  readonly qualifier: Written<core.input<Entry['guard']['qualifier']>>;
} & DeclaredFieldsRule<Entry, Attachment>;

type AttachedRule<Entry extends Attachment> = Entry['guard'] extends QualifiedGuard
  ? QualifiedRule<Entry>
  : 'qualifier' extends keyof Entry['guard']
    ? unknown
    : `${Entry['guard']['name']} takes no qualifier`;

type EntryRule<Entry> = Entry extends Attachment
  ? AttachedRule<Entry>
  : Entry extends Guard
    ? BareRule<Entry>
    : unknown;

/** What an Endpoint's `guards` must also satisfy: each Guard listed bare or attached as it declares. */
export type AttachmentsRule<Guards> = {
  readonly [Index in keyof Guards]: EntryRule<Guards[Index]>;
};
