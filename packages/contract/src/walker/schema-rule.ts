import type * as core from 'zod/v4/core';
import type { IsOneLiteral, JoinedNames, Refusal } from '../declarations/index.ts';
import type { refused } from './not-allowed.ts';

type Table = typeof refused;

/** The level below each one, so a schema is read ten levels deep and no deeper. */
type Remaining = [0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

type DefOf<Schema> = Schema extends { readonly _zod: { readonly def: infer Def } } ? Def : never;

type DefTypeIn<Part> = Part extends {
  readonly _zod: { readonly def: { readonly type: infer Type } };
}
  ? Type
  : never;

/** The Not allowed entry a pipe or codec is refused as, split as the walker splits it. */
type PipeRefusal<Def> = Def extends { readonly reverseTransform: unknown }
  ? Def extends { readonly in: infer In; readonly out: infer Out }
    ? [DefTypeIn<In>, DefTypeIn<Out>] extends ['string', 'boolean']
      ? 'stringbool'
      : 'codec'
    : 'codec'
  : Def extends { readonly in: infer In }
    ? DefTypeIn<In> extends 'transform'
      ? 'preprocess'
      : PipeOutRefusal<Def>
    : 'pipe';

type PipeOutRefusal<Def> = Def extends { readonly out: infer Out }
  ? DefTypeIn<Out> extends 'transform'
    ? 'transform'
    : 'pipe'
  : 'pipe';

/** Whether a schema reads more than it writes, as `z.coerce.*` does: its input type is `unknown`. */
type IsCoerced<Schema> = unknown extends core.input<Schema & core.$ZodType> ? true : false;

/** Whether a type is `any`, which no other type is as `0` is assignable to its intersection with `1`. */
type IsAny<Value> = 0 extends 1 & Value ? true : false;

/**
 * Whether an object takes keys beyond its fields, as `.catchall()` does: its config's output is
 * indexed by a typed schema or `any`. A catchall of `unknown` is a loose object's output, which
 * TypeScript cannot tell from it.
 */
type HasCatchall<Schema> = Schema extends {
  readonly _zod: { readonly config: { readonly out: infer Out } };
}
  ? string extends keyof Out
    ? unknown extends Out[string]
      ? IsAny<Out[string]>
      : true
    : false
  : false;

/** Whether a union is `z.json()`, which holds `z.null()` and is no union of its own options. */
type IsJson<Schema> = [core.output<Schema & core.$ZodType>] extends [core.util.JSONType]
  ? [core.util.JSONType] extends [core.output<Schema & core.$ZodType>]
    ? true
    : false
  : false;

/** How the Not allowed list words an entry: the construct and what to write instead. */
type TextOf<Key> = Key extends keyof Table
  ? Table[Key] extends { readonly instead: infer Instead extends string }
    ? `${Table[Key]['construct']} (use ${Instead})`
    : Table[Key]['construct']
  : never;

/** How the Not allowed list words what a schema is refused as by its own type, if it is. */
type OwnRefusal<Schema, Type extends string> = Type extends 'pipe'
  ? TextOf<PipeRefusal<DefOf<Schema>>>
  : Type extends 'template_literal'
    ? TextOf<'templateLiteral'>
    : Type extends 'optional' | 'nonoptional'
      ? never
      : Type extends keyof Table
        ? TextOf<Type>
        : Type extends 'string' | 'number' | 'boolean'
          ? IsCoerced<Schema> extends true
            ? TextOf<'coerce'>
            : never
          : Type extends 'object'
            ? HasCatchall<Schema> extends true
              ? TextOf<'catchall'>
              : never
            : never;

/** The schemas a schema holds, which the walker reads next; none inside a refused construct. */
type ChildrenOf<Schema, Def> = Def extends { readonly type: 'object'; readonly shape: infer Shape }
  ? Shape[keyof Shape]
  : Def extends { readonly type: 'array'; readonly element: infer Element }
    ? Element
    : Def extends { readonly type: 'union'; readonly options: readonly (infer Option)[] }
      ? IsJson<Schema> extends true
        ? never
        : Option
      : Def extends {
            readonly type: 'record';
            readonly keyType: infer Key;
            readonly valueType: infer Value;
          }
        ? Key | Value
        : Def extends {
              readonly type: 'tuple';
              readonly items: readonly (infer Item)[];
              readonly rest: infer Rest;
            }
          ? Item | Exclude<Rest, null>
          : Def extends {
                readonly type: 'intersection';
                readonly left: infer Left;
                readonly right: infer Right;
              }
            ? Left | Right
            : Def extends { readonly type: 'lazy'; readonly getter: () => infer Got }
              ? Got
              : Def extends {
                    readonly type: 'nullable' | 'optional' | 'nonoptional';
                    readonly innerType: infer Inner;
                  }
                ? Inner
                : never;

/** How the Not allowed list words each refusal in a schema, or in one it holds. */
type RefusedIn<Schema, Depth extends number = 10> = Depth extends 0
  ? never
  : Schema extends unknown
    ? DefOf<Schema> extends { readonly type: infer Type extends string }
      ? IsOneLiteral<Type> extends false
        ? never
        : [OwnRefusal<Schema, Type>] extends [never]
          ? RefusedIn<ChildrenOf<Schema, DefOf<Schema>>, Remaining[Depth]>
          : OwnRefusal<Schema, Type>
      : never
    : never;

/**
 * What every schema a declaration holds must also satisfy: a zod type the Not allowed list refuses
 * by name, a pipe or codec, coercion or a catchall is a type error that words the construct as
 * `generate` does. A schema whose type says nothing, `z.json()` and what lies past ten schemas are
 * left to `generate`.
 */
export type SchemaRule<Schema> = [RefusedIn<Schema>] extends [never]
  ? unknown
  : Refusal<`not allowed: ${JoinedNames<RefusedIn<Schema>>}`>;
