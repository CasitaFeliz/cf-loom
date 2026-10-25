import type { GroupedField } from './grouped.ts';
import type { ReservedName } from './reserved-names.ts';

type Refusal<Message extends string> = { readonly [Text in Message]: never };

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

type VersionRefusal = 'A Message version is one literal whole number from 1';

/** Whether a literal number's text is not a whole number from 1 written without an exponent. */
type IsNotWholeFromOne<Version extends number> = `${Version}` extends
  | '0'
  | `-${string}`
  | `${string}.${string}`
  | `${string}e${string}`
  ? true
  : false;

/** What every Message Version must also satisfy: one literal version, a whole number from 1 written without an exponent. */
export type VersionRule<Declaration extends { readonly version: number }> =
  number extends Declaration['version']
    ? unknown
    : IsOneLiteral<Declaration['version']> extends true
      ? IsNotWholeFromOne<Declaration['version']> extends true
        ? { readonly version: Refusal<VersionRefusal> }
        : unknown
      : { readonly version: Refusal<VersionRefusal> };
