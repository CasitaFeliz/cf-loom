/** Every name, each after a comma but the first. */
type CommaJoined<
  Names extends readonly string[],
  Written extends string = never,
> = Names extends readonly [infer First extends string, ...infer Rest extends readonly string[]]
  ? CommaJoined<Rest, [Written] extends [never] ? First : `${Written}, ${First}`>
  : Written;

/**
 * Several names in one sentence, closed by a word, as `joinedOf` writes them: a tuple's names in
 * its order, `a`, `a and b`, `a, b and c`; plain `string` for a list whose length its type leaves open.
 */
export type Joined<
  Names extends readonly string[],
  Closing extends 'and' | 'or',
> = number extends Names['length']
  ? string
  : Names extends readonly []
    ? ''
    : Names extends readonly [infer Only extends string]
      ? Only
      : Names extends readonly [
            ...infer Before extends readonly string[],
            infer Last extends string,
          ]
        ? `${CommaJoined<Before>} ${Closing} ${Last}`
        : string;

/** Several names in one sentence, closed by a word: `200, 201 or 204`, `"a", "b" and "c"`. */
export function joinedOf<const Names extends readonly string[], Closing extends 'and' | 'or'>(
  names: Names,
  closing: Closing,
): Joined<Names, Closing> {
  const last = names.at(-1);
  const text =
    names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} ${closing} ${last}`;
  return text as Joined<Names, Closing>;
}
