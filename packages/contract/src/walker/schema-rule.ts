import type * as core from 'zod/v4/core';
import type { IsOneLiteral, JoinedNames, Refusal } from '../declarations/index.ts';
import type { checkNames } from './check-names.ts';
import type {
  catchalls,
  DefOfType,
  DefType,
  defTypes,
  pipeRefusals,
  WalkedDefType,
} from './def-types.ts';
import type { refused } from './not-allowed.ts';

type Table = typeof refused;
type Treatments = typeof defTypes;

/** The level below each one, so a schema is read ten levels deep and no deeper. */
type Remaining = [0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

type DefOf<Schema> = Schema extends { readonly _zod: { readonly def: infer Def } } ? Def : never;

type DefTypeIn<Part> = Part extends {
  readonly _zod: { readonly def: { readonly type: infer Type } };
}
  ? Type
  : never;

/** The def types of a tuple of schemas, in their order. */
type DefTypesIn<Parts> = Parts extends readonly [infer First, ...infer Rest]
  ? [DefTypeIn<First>, ...DefTypesIn<Rest>]
  : [];

/** A pipe's shape, as the rules of `pipeRefusals` read it. */
type PipeShapeOf<Def> = {
  readonly reversed: Def extends { readonly reverseTransform: unknown } ? true : false;
  readonly in: Def extends { readonly in: infer In } ? DefTypeIn<In> : never;
  readonly out: Def extends { readonly out: infer Out } ? DefTypeIn<Out> : never;
};

/** What the first rule a pipe's shape satisfies refuses it as, else what `defTypes` refuses a pipe as. */
type PipeRefusalKey<Def, Rules = typeof pipeRefusals> = Rules extends readonly [
  infer First,
  ...infer Rest,
]
  ? PipeShapeOf<Def> extends Omit<First, 'refuses'>
    ? First extends { readonly refuses: infer Key }
      ? Key
      : never
    : PipeRefusalKey<Def, Rest>
  : Treatments['pipe']['refuses'];

/**
 * The walked def types whose def carries `coerce`, which zod types as a plain boolean: the type
 * reads coercion from the input instead, which `z.coerce.*` alone makes `unknown`.
 */
type CoercibleDefType = {
  [Type in WalkedDefType]: 'coerce' extends keyof DefOfType<Type> ? Type : never;
}[WalkedDefType];

type IsCoerced<Schema> = unknown extends core.input<Schema & core.$ZodType> ? true : false;

/** Whether a type is `any`, which no other type is as `0` is assignable to its intersection with `1`. */
type IsAny<Value> = 0 extends 1 & Value ? true : false;

/**
 * The def type of an object's catchall, read from its config's output, where zod keeps it: `never`
 * and `any` are those schemas' alone, and a typed index is some other schema. An index of
 * `unknown` is a loose object's and a wide `core.$ZodObject`'s too, so the type reads none there.
 */
type CatchallDefTypeOf<Schema> = Schema extends {
  readonly _zod: { readonly config: { readonly out: infer Out } };
}
  ? string extends keyof Out
    ? IsAny<Out[string]> extends true
      ? 'any'
      : [Out[string]] extends [never]
        ? 'never'
        : unknown extends Out[string]
          ? never
          : 'typed'
    : never
  : never;

/** What `catchalls` refuses an object's catchall as, by the catchall's def type. */
type CatchallKey<Schema> = [CatchallDefTypeOf<Schema>] extends [never]
  ? never
  : CatchallDefTypeOf<Schema> extends keyof typeof catchalls
    ? (typeof catchalls)[CatchallDefTypeOf<Schema>]
    : 'catchall';

/**
 * Whether a union is `z.json()`, read as the walk reads it: a string, a number, a boolean, null, an
 * array and a record as its options, and every JSON value as its output.
 */
type IsJson<Schema, Def> = Def extends { readonly options: infer Options }
  ? DefTypesIn<Options> extends ['string', 'number', 'boolean', 'null', 'array', 'record']
    ? [core.output<Schema & core.$ZodType>] extends [core.util.JSONType]
      ? [core.util.JSONType] extends [core.output<Schema & core.$ZodType>]
        ? true
        : false
      : false
    : false
  : false;

/** How the Not allowed list words an entry: the construct and what to write instead. */
type TextOf<Key> = Key extends keyof Table
  ? Table[Key] extends { readonly instead: infer Instead extends string }
    ? `${Table[Key]['construct']} (use ${Instead})`
    : Table[Key]['construct']
  : never;

/** What a walked def type is refused as beside its node: coercion, or an object's catchall. */
type BesideRefusalKey<Schema, Type extends DefType> = Type extends CoercibleDefType
  ? IsCoerced<Schema> extends true
    ? 'coerce'
    : never
  : Type extends 'object'
    ? CatchallKey<Schema>
    : never;

/** The Not allowed entry a schema is refused as, by `defTypes`: a pipe by its shape. */
type OwnRefusalKey<Schema, Type extends DefType> = Treatments[Type] extends {
  readonly refuses: infer Key;
}
  ? Type extends 'pipe'
    ? PipeRefusalKey<DefOf<Schema>>
    : Key
  : BesideRefusalKey<Schema, Type>;

/**
 * What `checkNames` names a refused def that is its own check, when its row names it alone: a
 * custom check, or a bigint format of one literal, by zod's ids when no row lists it. A format the
 * type does not tell apart is left to `defTypes`, so a schema is refused once.
 */
type OwnCheckName<Def> = Def extends { readonly check: 'custom' }
  ? (typeof checkNames)['custom']['refine']
  : Def extends { readonly check: 'bigint_format'; readonly format: infer Format }
    ? IsOneLiteral<Format> extends true
      ? Format extends keyof (typeof checkNames)['bigint_format']
        ? (typeof checkNames)['bigint_format'][Format]
        : `a zod check "bigint_format" of format "${Format & string}"`
      : never
    : never;

/** How the Not allowed list words a refused schema: by its own check if it is one, else by its type. */
type OwnRefusalText<Schema, Type extends DefType> = [OwnCheckName<DefOf<Schema>>] extends [never]
  ? TextOf<OwnRefusalKey<Schema, Type>>
  : OwnCheckName<DefOf<Schema>>;

/** The schemas under a def's key: one, a list of them or a getter of one. */
type SchemasUnder<Value> = Value extends core.$ZodType
  ? Value
  : Value extends readonly (infer Item)[]
    ? SchemasUnder<Item>
    : Value extends () => infer Got
      ? Got
      : never;

/**
 * The schema a field is judged by, as the walk reads a field: through its own `.optional()`, or
 * its `.nonoptional()` and the `.optional()` that undoes; a value typed with no `_zod`, such as a
 * zod/v3 schema, is judged as no zod 4 schema.
 */
type FieldSchemaOf<Field> = Field extends unknown
  ? Field extends WrapperOf<'optional', infer Inner>
    ? Inner
    : Field extends WrapperOf<'nonoptional', infer Inner>
      ? RequiredOf<Inner>
      : IsNoSchema<Field> extends true
        ? NoZod4Schema
        : Field
  : never;

/** A schema whose def wraps the schema inside as `.optional()` or `.nonoptional()` does. */
type WrapperOf<Kind extends string, Inner> = {
  readonly _zod: { readonly def: { readonly type: Kind; readonly innerType: Inner } };
};

/** What the types read a value that is no zod 4 schema as: a def type of its own, refused by name. */
type NoZod4Schema = { readonly _zod: { readonly def: { readonly type: 'notZod4' } } };

/**
 * Whether a type is of a value that has no `_zod`, as a zod/v3 schema: `any` and `unknown`, which a
 * wide type holds, and `undefined`, which an optional slot adds, say nothing of one.
 */
type IsNoSchema<Value> = unknown extends Value
  ? false
  : [Value] extends [undefined]
    ? false
    : Value extends { readonly _zod: unknown }
      ? false
      : true;

type RequiredOf<Inner> =
  DefOf<Inner> extends {
    readonly type: 'optional';
    readonly innerType: infer Required;
  }
    ? Required
    : Inner;

/** The schemas a walked schema holds, which the walk reads next, as `defTypes` lists their keys. */
type ChildrenOf<Schema, Def, Type extends DefType> =
  IsJson<Schema, Def> extends true
    ? never
    : Treatments[Type] extends { readonly fields: infer Key extends keyof Def }
      ? FieldSchemaOf<Def[Key][keyof Def[Key]]>
      : Treatments[Type] extends { readonly walks: readonly (infer Key extends keyof Def)[] }
        ? SchemasUnder<Def[Key]>
        : never;

/** How the Not allowed list words each refusal in a schema, or in one it holds. */
type RefusedIn<Schema, Depth extends number = 10> = Depth extends 0
  ? never
  : Schema extends unknown
    ? DefOf<Schema> extends { readonly type: infer Type extends string }
      ? IsOneLiteral<Type> extends false
        ? never
        : Type extends 'notZod4'
          ? TextOf<'notZod4'>
          : Type extends DefType
            ? [OwnRefusalKey<Schema, Type>] extends [never]
              ? RefusedIn<ChildrenOf<Schema, DefOf<Schema>, Type>, Remaining[Depth]>
              : OwnRefusalText<Schema, Type>
            : never
      : never
    : never;

/**
 * What every schema a declaration holds must also satisfy: a zod type the Not allowed list refuses
 * by name, a pipe or codec, coercion, a catchall or a field that is no zod 4 schema is a type error
 * that words the construct as `generate` does. A schema whose type says nothing, `z.json()` and
 * what lies past ten schemas are left to `generate`.
 */
export type SchemaRule<Schema> = [RefusedIn<Schema>] extends [never]
  ? unknown
  : Refusal<`not allowed: ${JoinedNames<RefusedIn<Schema>, '; '>}`>;
