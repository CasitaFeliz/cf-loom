/** `pattern` as a regular expression source that matches it literally. */
function literally(pattern: string): string {
  return pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The one form a README may use for a file of `repository` at `main`: a Markdown link target, anchor allowed. */
function linkAtMain(repository: string): RegExp {
  const target = `https://github\\.com/${literally(repository)}/blob/`;
  return new RegExp(`(\\]\\(${target})main(/[^)\\s]+\\))`, 'g');
}

/** What is wrong with a line once its links to a file at `main` are removed, or `undefined` when nothing is. */
function problemOf(restOfLine: string, repository: string): string | undefined {
  const reference = new RegExp(`(?<![\\w.-])${literally(repository)}(?![\\w-])`, 'i');
  if (reference.test(restOfLine)) {
    return `a reference to ${repository} that is not a link target https://github.com/${repository}/blob/main/<path>`;
  }
  const relative = /\]\((?![a-z][a-z0-9+.-]*:|#)[^)\s]*\)/i.exec(restOfLine);
  if (relative !== null) {
    return `${relative[0]} is a link target with no scheme that is not an anchor`;
  }
  return undefined;
}

/**
 * The README with each link to a file of `repository` at `main` pointing at the same file at `commit`.
 *
 * The one form it pins is a Markdown link target `https://github.com/<repository>/blob/main/<path>`, anchor allowed.
 * It throws, one `line <n>: …` for each README line, on any other reference to `repository` (compared ignoring
 * case) and on a link target with no scheme that is not an anchor `#…`, so a pinned README holds nothing at `main`.
 *
 * @param readme - The README's text.
 * @param repository - The repository as `<owner>/<name>`.
 * @param commit - The full SHA of the commit the release packs.
 */
export function pinnedReadme(readme: string, repository: string, commit: string): string {
  const link = linkAtMain(repository);
  const pinToCommit = (_link: string, before: string, after: string) =>
    `${before}${commit}${after}`;
  const problems: string[] = [];
  const pinned: string[] = [];
  for (const [index, line] of readme.split('\n').entries()) {
    const problem = problemOf(line.replace(link, ''), repository);
    if (problem !== undefined) {
      problems.push(`line ${index + 1}: ${problem}`);
    }
    pinned.push(line.replace(link, pinToCommit));
  }
  if (problems.length > 0) {
    throw new Error(problems.join('\n'));
  }
  return pinned.join('\n');
}
