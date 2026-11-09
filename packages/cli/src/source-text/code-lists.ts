/** The items of a list in code, an array's, an object's or an import's, each after a comma but the first: `a, b`. */
export function codeListOf(items: readonly string[]): string {
  return items.join(', ');
}
