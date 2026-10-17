/** The `:names` of a path literal, so the types can demand exactly those params. */
export type PathParams<Path extends string> = Path extends `${string}/:${infer Name}/${infer Rest}`
  ? Name | PathParams<`/${Rest}`>
  : Path extends `${string}/:${infer Name}`
    ? Name
    : never;
