import type { MarkedToken } from 'marked';
import { locatedTokens } from './readme-tokens.ts';

/** `pattern` as a regular expression source that matches it literally. */
function literally(pattern: string): string {
  return pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The one form a README may use for a file of `repository` at `ref`: a link target, anchor allowed, as a regular
 * expression source with `ref` between its two captures.
 */
function targetAt(repository: string, ref: string): string {
  return `(https://github\\.com/${literally(repository)}/blob/)${literally(ref)}(/[^)\\s]+)`;
}

/** The inline links to a file of `repository` at `main`, which the release points at a commit. */
function linkAtMain(repository: string): RegExp {
  return new RegExp(`\\]\\(${targetAt(repository, 'main')}\\)`, 'g');
}

/** Whether a link target is a file of `repository` at `commit`. */
function isTargetAt(target: string, repository: string, commit: string): boolean {
  return new RegExp(`^${targetAt(repository, commit)}$`).test(target);
}

/** Whether a line names `repository` in any case, as a whole name and not as the end of an owner or the start of a name. */
function namesRepository(line: string, repository: string): boolean {
  return new RegExp(`(?<![\\w.-])${literally(repository)}(?![\\w-])`, 'i').test(line);
}

/** What is wrong on one line of a README. */
export type ReadmeProblem = { readonly line: number; readonly problem: string };

/** A README pinned to a commit, or the lines that keep it from being pinned. */
export type ReadmePinning =
  | { readonly kind: 'pinned'; readonly text: string }
  | { readonly kind: 'refused'; readonly problems: readonly ReadmeProblem[] };

function unpinnedMention(repository: string): string {
  const form = `https://github.com/${repository}/blob/main/<path>`;
  return `a reference to ${repository} that is not a link target ${form}`;
}

/** Each line of the text that names `repository`, once its links to a file at `main` are removed. */
function mentionProblems(readme: string, repository: string): ReadmeProblem[] {
  const link = linkAtMain(repository);
  const problems: ReadmeProblem[] = [];
  for (const [index, line] of readme.split('\n').entries()) {
    if (namesRepository(line.replace(link, ''), repository)) {
      problems.push({ line: index + 1, problem: unpinnedMention(repository) });
    }
  }
  return problems;
}

const absoluteOrAnchor = /^(?:[a-z][a-z0-9+.-]*:|#)/i;

/** An HTML comment as a browser ends it: not `<!-->` or `<!--->`, and not at `--!>`. */
const htmlComment = /<!--(?!-?>)(?:(?!--!>)[\s\S])*?-->/g;

function targetProblem(target: string, repository: string, commit: string): string | undefined {
  if (!absoluteOrAnchor.test(target)) {
    return `the link target "${target}" has no scheme and is not an anchor`;
  }
  if (namesRepository(target, repository) && !isTargetAt(target, repository, commit)) {
    return unpinnedMention(repository);
  }
  return undefined;
}

function htmlProblem(html: string): string | undefined {
  if (html.replace(htmlComment, '').trim() === '') {
    return undefined;
  }
  const [firstLine = ''] = html.trim().split('\n');
  return `raw HTML ${JSON.stringify(firstLine.trimEnd())}, but a package README holds no HTML but comments`;
}

function tokenProblem(token: MarkedToken, repository: string, commit: string): string | undefined {
  switch (token.type) {
    case 'def':
    case 'image':
    case 'link':
      return targetProblem(token.href, repository, commit);
    case 'html':
      return htmlProblem(token.raw);
    case 'blockquote':
    case 'br':
    case 'checkbox':
    case 'code':
    case 'codespan':
    case 'del':
    case 'em':
    case 'escape':
    case 'heading':
    case 'hr':
    case 'list':
    case 'list_item':
    case 'paragraph':
    case 'space':
    case 'strong':
    case 'table':
    case 'text':
      return undefined;
  }
}

/** What GitHub and npm would render at `main` from the README read as Markdown, one problem for each token. */
function tokenProblems(pinned: string, repository: string, commit: string): ReadmeProblem[] {
  const problems: ReadmeProblem[] = [];
  for (const { token, line } of locatedTokens(pinned)) {
    const problem = tokenProblem(token, repository, commit);
    if (problem !== undefined) {
      problems.push({ line, problem });
    }
  }
  return problems;
}

/** The problems once each appears once, in line order. */
function inLineOrder(problems: readonly ReadmeProblem[]): ReadmeProblem[] {
  const once = new Map(problems.map((found) => [`${found.line} ${found.problem}`, found]));
  return [...once.values()].sort((first, second) => first.line - second.line);
}

/**
 * The README with each link to a file of `repository` at `main` pointing at the same file at `commit`, or the lines
 * that keep it from being pinned, so that a pinned README holds nothing at `main`.
 *
 * It pins the link target `https://github.com/<repository>/blob/main/<path>` and refuses any other mention of
 * `repository` in its text, code included. Read as GitHub Flavored Markdown, it refuses a link, image or definition
 * target with no scheme and no `#`, which GitHub and npm resolve against the default branch, a target naming
 * `repository` that is not pinned, which a backslash escape can hide from the text, and raw HTML other than a
 * comment, whose attributes hold targets Markdown does not parse. Code never gives a target.
 *
 * @param readme - The README's text.
 * @param repository - The repository as `<owner>/<name>`.
 * @param commit - The full SHA of the commit the release packs.
 */
export function pinnedReadme(readme: string, repository: string, commit: string): ReadmePinning {
  const pinned = readme.replace(
    linkAtMain(repository),
    (_link, before: string, after: string) => `](${before}${commit}${after})`,
  );
  const problems = [
    ...mentionProblems(readme, repository),
    ...tokenProblems(pinned, repository, commit),
  ];
  if (problems.length > 0) {
    return { kind: 'refused', problems: inLineOrder(problems) };
  }
  return { kind: 'pinned', text: pinned };
}
