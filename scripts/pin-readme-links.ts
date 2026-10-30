import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** `pattern` as a regular expression source that matches it literally. */
function literally(pattern: string): string {
  return pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The one form a README may use for a file of `repository` at `main`: a link target, anchor allowed. */
function linkAtMain(repository: string): RegExp {
  const target = `https://github\\.com/${literally(repository)}/blob/`;
  return new RegExp(`(\\]\\(${target})main(/[^)\\s]+\\))`, 'g');
}

/** What is wrong with a line once its links to a file at `main` are removed, or `undefined` when nothing is. */
function problemOf(restOfLine: string, repository: string): string | undefined {
  const reference = new RegExp(`(?<![\\w.-])${literally(repository)}(?![\\w-])`, 'i');
  if (reference.test(restOfLine)) {
    const form = `https://github.com/${repository}/blob/main/<path>`;
    return `a reference to ${repository} that is not a link target ${form}`;
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
 * It throws, with a `line <n>: …` for each README line, on any other reference to `repository` (compared ignoring
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

const githubRepositoryUrl = /^git\+https:\/\/github\.com\/([\w-]+\/[\w.-]+?)\.git$/;

/**
 * The `<owner>/<name>` of the GitHub repository a package's manifest declares in `repository.url`
 * (`git+https://github.com/<owner>/<name>.git`); throws when the field is absent or names another form.
 */
export function repositoryOf(manifest: { readonly repository?: unknown }): string {
  const { repository } = manifest;
  const url =
    typeof repository === 'object' && repository !== null && 'url' in repository
      ? repository.url
      : undefined;
  const match = typeof url === 'string' ? githubRepositoryUrl.exec(url) : null;
  if (match?.[1] === undefined) {
    throw new Error('repository.url must be "git+https://github.com/<owner>/<name>.git"');
  }
  return match[1];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The error `step` throws, with `path` in front of each line of its message. */
function atPath<Value>(path: string, step: () => Value): Value {
  try {
    return step();
  } catch (error) {
    throw new Error(messageOf(error).replaceAll(/^/gm, `${path}: `), { cause: error });
  }
}

type PinnedReadme = { readonly path: string; readonly text: string };

/** The README of a package folder, pinned with the repository its `package.json` declares. */
function pinnedReadmeOf(folder: string, commit: string): PinnedReadme {
  const manifestPath = join(folder, 'package.json');
  const manifest = atPath(manifestPath, () => JSON.parse(readFileSync(manifestPath, 'utf8')));
  const repository = atPath(manifestPath, () => repositoryOf(manifest));
  const path = join(folder, 'README.md');
  const text = atPath(path, () => pinnedReadme(readFileSync(path, 'utf8'), repository, commit));
  return { path, text };
}

/** The folders of `packages/` that hold a README. */
function packagesWithReadme(): string[] {
  const names = readdirSync('packages').sort();
  return names
    .map((name) => join('packages', name))
    .filter((folder) => existsSync(join(folder, 'README.md')));
}

/** Pins every package README of the current directory to `commit`, all or none. */
function pinPackageReadmes(commit: string): void {
  const pinned: PinnedReadme[] = [];
  const problems: string[] = [];
  for (const folder of packagesWithReadme()) {
    try {
      pinned.push(pinnedReadmeOf(folder, commit));
    } catch (error) {
      problems.push(messageOf(error));
    }
  }
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exitCode = 1;
    return;
  }
  for (const { path, text } of pinned) {
    writeFileSync(path, text);
  }
}

const fullCommit = /^[0-9a-f]{40}$/;

/** The command: pins the READMEs to the commit it is given, or says how to give one. */
function runCommand(commit: string | undefined): void {
  if (commit === undefined || !fullCommit.test(commit)) {
    console.error(
      'usage: node scripts/pin-readme-links.ts <commit>  (40 lower-case hexadecimal digits)',
    );
    process.exitCode = 1;
    return;
  }
  pinPackageReadmes(commit);
}

if (import.meta.main) {
  runCommand(process.argv[2]);
}
