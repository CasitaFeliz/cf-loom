/** Several names in one sentence, closed by a word: `200, 201 or 204`, `"a", "b" and "c"`. */
export function joinedOf(names: readonly string[], closing: 'and' | 'or'): string {
  const last = names.at(-1);
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} ${closing} ${last}`;
}
