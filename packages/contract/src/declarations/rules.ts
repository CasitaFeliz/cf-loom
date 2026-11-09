import type * as core from 'zod/v4/core';
import type { SchemaRule } from '../walker/index.ts';
import type { GroupedField } from './grouped.ts';
import type {
  groupListsSentence,
  ListedTwiceSentence,
  messageBodySentence,
  messageVersionSentence,
  nameNouns,
  ReservedNameSentence,
  UndeclaredFieldSentence,
} from './refusals.ts';
import type { ReservedName } from './reserved-names.ts';

/** A type no value has, whose only key is the sentence a type error reads. */
export type Refusal<Message extends string> = { readonly [Text in Message]: never };

/**
 * What a declaration must also satisfy: each field it holds is one its kind declares, in every
 * member when it is a union.
 */
export type DeclaredFieldsRule<Declaration, Shape> = {
  readonly [Field in Exclude<KeysOfEach<Declaration>, keyof Shape>]: Refusal<
    UndeclaredFieldSentence<Field & string>
  >;
};

/** Every key any member of a union holds, where `keyof` keeps only the keys all members share. */
type KeysOfEach<Union> = Union extends unknown ? keyof Union : never;

/**
 * A parameter whose shape cf-loom gives, an options object or what `fault()` is given: `Shape`, and
 * no field it does not declare, given as a literal or through a variable whose type is one object
 * type (see the Runtime section of ARCHITECTURE.md).
 */
export type Closed<Given, Shape> = Shape & Given & NoInfer<DeclaredFieldsRule<Given, Shape>>;

/** What an Endpoint, Guard or Subscription must also satisfy: its name is no reserved name. */
export type ReservedNameRule<
  Declaration extends { readonly name: string },
  Kind extends keyof typeof nameNouns,
> = Declaration['name'] extends ReservedName
  ? {
      readonly name: Refusal<ReservedNameSentence<(typeof nameNouns)[Kind], Declaration['name']>>;
    }
  : unknown;

/** What a Group must also satisfy: it lists at least one Endpoint, Event, Command or Subscription. */
export type ListsSomethingRule<Declaration> = [Extract<keyof Declaration, GroupedField>] extends [
  never,
]
  ? {
      readonly [Field in GroupedField]: Refusal<typeof groupListsSentence>;
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

/** A list with a name appended unless it holds it already, so a name listed twice is listed once, where it is first. */
export type ListedOnce<Listed extends readonly string[], Name extends string> = [Name] extends [
  never,
]
  ? Listed
  : Name extends Listed[number]
    ? Listed
    : [...Listed, Name];

/** A list with every name of a union appended once each, in the order the compiler gives the union. */
export type ListedAll<Listed extends readonly string[], Names extends string> = [Names] extends [
  never,
]
  ? Listed
  : ListedAll<Listed, Exclude<Names, LastOf<Names>>> extends infer Earlier extends readonly string[]
    ? ListedOnce<Earlier, LastOf<Names> & string>
    : never;

/** The names a rule may judge: a name typed as plain `string` says nothing about itself. */
export type LiteralNames<Names> = Names extends string
  ? string extends Names
    ? never
    : Names
  : never;

/**
 * Whether a type is one value, not a union: a rule on a name or a path judges only what the author
 * wrote exactly, and leaves a union to `generate`; a rule on a list of names judges the set of
 * names its type may hold, and its refusal lists that same set, in the order the declaration does.
 */
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
    ? Refusal<ListedTwiceSentence<Key>>
    : RejectionsOnceRule<Rest, Earlier | Key>;

/** What a list of Rejections must also satisfy: each code once, a Standard Rejection by its name. */
export type RejectionsOnceRule<
  Rejections,
  Earlier extends string = never,
> = Rejections extends readonly [infer First, ...infer Rest]
  ? ListedOnceRule<OnceKeyOf<First>, Rest, Earlier>
  : unknown;

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
      : { readonly body: Refusal<typeof messageBodySentence> }
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
        ? { readonly version: Refusal<typeof messageVersionSentence> }
        : unknown
      : { readonly version: Refusal<typeof messageVersionSentence> };
