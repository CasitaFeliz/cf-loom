type Refusal<Message extends string> = { readonly [Text in Message]: never };

/** What a declaration must also satisfy: each field it holds is one its kind declares. */
export type DeclaredFieldsRule<Declaration, Shape> = {
  readonly [Field in Exclude<
    keyof Declaration,
    keyof Shape
  >]: Refusal<`${Field & string} is not a declared field`>;
};

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
