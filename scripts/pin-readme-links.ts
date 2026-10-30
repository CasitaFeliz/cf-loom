/** The pattern of the one form a README may use for a file of `repository` at `main`, which is escaped to match literally. */
function atMainPattern(repository: string): RegExp {
  const literal = repository.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<=\\]\\(https://github\\.com/${literal}/blob/)main(?=/[^)\\s]+\\))`, 'g');
}

/**
 * The README with each link to a file of `repository` at `main` pointing at the same file at `commit`.
 *
 * @param readme - The README's text.
 * @param repository - The repository as `<owner>/<name>`.
 * @param commit - The full SHA of the commit the release packs.
 */
export function pinnedReadme(readme: string, repository: string, commit: string): string {
  return readme.replace(atMainPattern(repository), () => commit);
}
