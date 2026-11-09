import type { ListedOnce } from './rules.ts';

/** The `:names` of a path literal in path order, each once, as `generate` lists them. */
export type PathParamList<
  Path extends string,
  Listed extends readonly string[] = [],
> = Path extends `${string}/:${infer Name}/${infer Rest}`
  ? PathParamList<`/${Rest}`, ListedOnce<Listed, Name>>
  : Path extends `${string}/:${infer Name}`
    ? ListedOnce<Listed, Name>
    : Listed;

/** The `:names` of a path literal, so the types can demand exactly those params. */
export type PathParams<Path extends string> = PathParamList<Path>[number];
