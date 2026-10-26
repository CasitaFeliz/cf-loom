import type * as core from 'zod/v4/core';
import type { SchemaRule } from '../walker/index.ts';
import type { GroupedField } from './grouped.ts';
import type { ReservedName } from './reserved-names.ts';

/** A type no value has, whose only key is the sentence a type error reads. */
export type Refusal<Message extends string> = { readonly [Text in Message]: never };

/** What a declaration must also satisfy: each field it holds is one its kind declares. */
export type DeclaredFieldsRule<Declaration, Shape> = {
  readonly [Field in Exclude<
    keyof Declaration,
    keyof Shape
  >]: Refusal<`${Field & string} is not a declared field`>;
};

/** What an Endpoint, Guard or Subscription must also satisfy: its name is no reserved name. */
export type ReservedNameRule<Declaration extends { readonly name: string }> =
  Declaration['name'] extends ReservedName
    ? { readonly name: Refusal<`A name is no reserved word: ${Declaration['name']}`> }
    : unknown;

/** What a Group must also satisfy: it lists at least one Endpoint, Event, Command or Subscription. */
export type ListsSomethingRule<Declaration> = [Extract<keyof Declaration, GroupedField>] extends [
  never,
]
  ? {
      readonly [Field in GroupedField]: Refusal<'A Group lists at least one Endpoint, Event, Command or Subscription'>;
    }
  : unknown;

type IntersectionOf<Members> = (
  Members extends unknown
    ? (member: Members) => void
    : never
) extends (member: infer Intersection) => void
  ? Intersection
  : never;

type LastOf<Names> =
  IntersectionOf<Names extends unknown ? () => Names : never> extends () => infer Last
    ? Last
    : never;

/** Several names in one message, comma-separated, so a refusal reads as one sentence. */
export type JoinedNames<Names extends string> = [Exclude<Names, LastOf<Names>>] extends [never]
  ? Names
  : `${JoinedNames<Exclude<Names, LastOf<Names>>>}, ${LastOf<Names> & string}`;

/** The names a rule may judge: a name typed as plain `string` says nothing about itself. */
export type LiteralNames<Names> = Names extends string
  ? string extends Names
    ? never
    : Names
  : never;

/** Whether a type is one value, not a union: a rule judges only what the author wrote exactly. */
export type IsOneLiteral<Value> = [Value] extends [never]
  ? false
  : [Value] extends [LastOf<Value>]
    ? true
    : false;

type ListedKeyOf<Listed> = Listed extends {
  readonly kind: 'standard-rejection';
  readonly name: infer Name extends string;
}
  ? Name
  : Listed extends { readonly kind: 'rejection'; readonly code: infer Code extends string }
    ? Code
    : never;

/** The one literal key a listed Rejection is judged by; none where its type leaves the key open. */
type OnceKeyOf<Listed> =
  IsOneLiteral<LiteralNames<ListedKeyOf<Listed>>> extends true
    ? LiteralNames<ListedKeyOf<Listed>>
    : never;

type ListedOnceRule<Key extends string, Rest, Earlier extends string> = [Key] extends [never]
  ? RejectionsOnceRule<Rest, Earlier>
  : Key extends Earlier
    ? `${Key} is listed twice`
    : RejectionsOnceRule<Rest, Earlier | Key>;

/** What a list of Rejections must also satisfy: each code once, a Standard Rejection by its name. */
export type RejectionsOnceRule<
  Rejections,
  Earlier extends string = never,
> = Rejections extends readonly [infer First, ...infer Rest]
  ? ListedOnceRule<OnceKeyOf<First>, Rest, Earlier>
  : unknown;

/** Why a Message body is refused, as the types and `generate` both say it. */
export const messageBodyRefusal = 'A Message body is an object of its fields';

/** A body schema a Message can grow with: an object, or a schema `generate` reads through to one. */
type GrowableBody = core.$ZodObject | core.$ZodIntersection | core.$ZodLazy;

/**
 * An object of its fields, so the Message can grow. It says nothing where the schema's kind is not
 * one literal, as for a `z.ZodType<T>` written for recursion: `generate` judges it.
 */
type ObjectBodyRule<Declaration extends { readonly body: core.$ZodType }> =
  IsOneLiteral<Declaration['body']['_zod']['def']['type']> extends true
    ? Declaration['body'] extends GrowableBody
      ? unknown
      : { readonly body: Refusal<typeof messageBodyRefusal> }
    : unknown;

/**
 * What a Message body must also satisfy: its schemas are allowed, and it is an object of its
 * fields. The second speaks only where the first says nothing, since `generate` reports a refused
 * body by its construct alone.
 */
export type MessageBodyRule<Declaration extends { readonly body: core.$ZodType }> =
  unknown extends SchemaRule<Declaration['body']>
    ? ObjectBodyRule<Declaration>
    : { readonly body: SchemaRule<Declaration['body']> };

/** Why a Message version is refused, as the types and `generate` both say it. */
export const messageVersionRefusal =
  'A Message version is one whole number from 1 to Number.MAX_SAFE_INTEGER';

/** Whether a literal number's text is not a whole number from 1 written without an exponent. */
type IsNotWholeFromOne<Version extends number> = `${Version}` extends
  | '0'
  | `-${string}`
  | `${string}.${string}`
  | `${string}e${string}`
  | 'Infinity'
  ? true
  : false;

/**
 * What every Message Version must also satisfy: a literal version is one whole number from 1
 * written without an exponent, never one of several. A version typed `number` says nothing about
 * itself: `publish` refuses to key bodies by it.
 */
export type VersionRule<Declaration extends { readonly version: number }> =
  number extends Declaration['version']
    ? unknown
    : IsOneLiteral<Declaration['version']> extends true
      ? IsNotWholeFromOne<Declaration['version']> extends true
        ? { readonly version: Refusal<typeof messageVersionRefusal> }
        : unknown
      : { readonly version: Refusal<typeof messageVersionRefusal> };
