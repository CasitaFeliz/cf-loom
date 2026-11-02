import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pinnedReadme } from './pinned-readme.ts';

const githubRepositoryUrl = /^git\+https:\/\/github\.com\/([\w-]+\/[\w.-]+?)\.git$/;

/**
 * The `<owner>/<name>` of the GitHub repository a package's manifest declares in `repository.url`
 * (`git+https://github.com/<owner>/<name>.git`), or `undefined` when the field is absent or names another form.
 */
export function repositoryOf(manifest: { readonly repository?: unknown }): string | undefined {
  const { repository } = manifest;
  const url =
    typeof repository === 'object' && repository !== null && 'url' in repository
      ? repository.url
      : undefined;
  const match = typeof url === 'string' ? githubRepositoryUrl.exec(url) : null;
  return match?.[1];
}

type PinnedFile = { readonly path: string; readonly text: string };

/** What pinning a package folder gives: its README pinned, or each problem with its file and line. */
type FolderPinning =
  | { readonly kind: 'pinned'; readonly file: PinnedFile }
  | { readonly kind: 'refused'; readonly problems: readonly string[] };

/** The README of a package folder, pinned with the repository its `package.json` declares. */
function pinFolder(folder: string, commit: string): FolderPinning {
  const manifestPath = join(folder, 'package.json');
  const repository = repositoryOf(JSON.parse(readFileSync(manifestPath, 'utf8')));
  if (repository === undefined) {
    const form = '"git+https://github.com/<owner>/<name>.git"';
    return { kind: 'refused', problems: [`${manifestPath}: repository.url must be ${form}`] };
  }
  const path = join(folder, 'README.md');
  const pinning = pinnedReadme(readFileSync(path, 'utf8'), repository, commit);
  switch (pinning.kind) {
    case 'pinned':
      return { kind: 'pinned', file: { path, text: pinning.text } };
    case 'refused':
      return {
        kind: 'refused',
        problems: pinning.problems.map(({ line, problem }) => `${path}: line ${line}: ${problem}`),
      };
  }
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
  const files: PinnedFile[] = [];
  const problems: string[] = [];
  for (const folder of packagesWithReadme()) {
    const pinning = pinFolder(folder, commit);
    switch (pinning.kind) {
      case 'pinned':
        files.push(pinning.file);
        break;
      case 'refused':
        for (const problem of pinning.problems) {
          problems.push(problem);
        }
        break;
    }
  }
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exitCode = 1;
    return;
  }
  for (const { path, text } of files) {
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
