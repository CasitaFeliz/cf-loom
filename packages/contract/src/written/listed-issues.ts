/** The most Issues cf-loom lists in one place, the invalid-input body or a Fault's console lines, so what it writes stays small whatever it read. */
const listedIssueLimit = 100;

/** The most bytes those Issues take as written, in UTF-8, since a path holds the sender's keys. */
const listedIssueBytes = 65_536;

/**
 * The first Issues within `listedIssueLimit` and `listedIssueBytes`, each as `write` writes it with
 * the bytes it adds to the list, after the `takenBytes` the list takes besides its Issues: listing
 * stops at the first Issue that would pass either bound, and that one and every later one are
 * counted in `omittedIssues`, never written.
 */
export function listedIssuesOf<Read, Written>(
  issues: readonly Read[],
  write: (issue: Read) => { readonly written: Written; readonly bytes: number },
  takenBytes: number,
): { readonly listed: readonly Written[]; readonly omittedIssues: number } {
  const listed: Written[] = [];
  let bytes = takenBytes;
  for (const issue of issues) {
    if (listed.length === listedIssueLimit) break;
    const { written, bytes: added } = write(issue);
    if (bytes + added > listedIssueBytes) break;
    listed.push(written);
    bytes += added;
  }
  return { listed, omittedIssues: issues.length - listed.length };
}
