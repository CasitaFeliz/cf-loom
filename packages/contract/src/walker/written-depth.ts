/** The most schemas a path may enter below its root, as the author wrote them, the root the first. */
export const writtenNestingLimit = 256;

/**
 * How deep a schema entered below a path of schemas sits, as the author wrote it: 1 when it has a
 * recursion id, which starts a count of its own as its def is a node of its own, else one more than
 * the schemas of the path since the last one that has an id, the path's first being 1.
 */
export function writtenDepthOf(
  path: readonly { readonly id: string | undefined }[],
  id: string | undefined,
): number {
  if (id !== undefined) {
    return 1;
  }
  const counted = path.findLastIndex((schema) => schema.id !== undefined);
  return path.length - Math.max(counted, 0) + 1;
}
