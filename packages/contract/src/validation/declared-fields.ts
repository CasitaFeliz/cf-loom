/** The keys a shape requires: the ones an empty object lacks. */
type RequiredKeys<Shape> = {
  [Key in keyof Shape]-?: Record<never, never> extends Pick<Shape, Key> ? never : Key;
}[keyof Shape];

/** The keys a shape types as strings, literals included. */
type StringKeys<Shape> = {
  [Key in keyof Shape]-?: NonNullable<Shape[Key]> extends string ? Key : never;
}[keyof Shape];

/** What is no written object part: a list, a zod schema or a declaration. */
type NonPart = readonly unknown[] | Readonly<Record<'_zod', unknown>> | { readonly kind: string };

/** Whether a type is a map of values by name, as `schemas` or a Dependency's `endpoints` are. */
type IsMap<Value> = string extends keyof Value ? true : false;

/** The keys a shape types as objects an author writes part by part; a key typed `unknown` is none. */
type ObjectKeys<Shape> = {
  [Key in keyof Shape]-?: unknown extends Shape[Key]
    ? never
    : IsMap<NonNullable<Shape[Key]>> extends true
      ? Key
      : NonNullable<Shape[Key]> extends NonPart
        ? never
        : NonNullable<Shape[Key]> extends object
          ? Key
          : never;
}[keyof Shape];

/**
 * What a kind of object declares, as maps so `satisfies` demands exactly the type's fields, the
 * ones it requires, the strings among them, those among the strings that must say something,
 * and the parts written as objects.
 */
export type Fields<Shape> = {
  readonly declared: Readonly<Record<keyof Shape, true>>;
  readonly required: Readonly<Record<RequiredKeys<Shape>, true>>;
  readonly strings: Readonly<Record<StringKeys<Shape>, true>>;
  readonly texts: Readonly<Partial<Record<StringKeys<Shape>, true>>>;
  readonly objects: Readonly<Record<ObjectKeys<Shape>, true>>;
};

/** The fields of a kind as the rule reads them, whatever the kind. */
export type KnownFields = Fields<Record<string, unknown>>;
