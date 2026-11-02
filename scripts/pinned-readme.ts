import type { MarkedToken } from 'marked';
import { locatedTokens } from './readme-tokens.ts';

/** `pattern` as a regular expression source that matches it literally. */
function literally(pattern: string): string {
  return pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The inline links and images to a file of `repository` at `main`, which the release points at a commit. */
function linkAtMain(repository: string): RegExp {
  const target = `(https://github\\.com/${literally(repository)}/blob/)main(/[^)\\s]+)`;
  return new RegExp(`\\]\\(${target}\\)`, 'g');
}

/**
 * Whether a line names `repository` in any case, as a whole name and not as the end of an owner or the start of a
 * name, read without its backslashes, which Markdown drops before punctuation.
 */
function namesRepository(line: string, repository: string): boolean {
  const unescaped = line.replaceAll('\\', '');
  return new RegExp(`(?<![\\w.-])${literally(repository)}(?![\\w-])`, 'i').test(unescaped);
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

/** A reference a browser decodes in a URL and the parser leaves as written: `&#x2F;`, `&#47;`, `&sol;`. */
const characterReference = /&(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i;

/** An HTML comment as a browser ends it: not `<!-->` or `<!--->`, and not at `--!>`. */
const htmlComment = /<!--(?!-?>)(?:(?!--!>)[\s\S])*?-->/g;

function targetProblem(target: string): string | undefined {
  const reference = characterReference.exec(target)?.[0];
  if (reference !== undefined) {
    return `the link target "${target}" holds the character reference ${reference}; write the character itself`;
  }
  if (!absoluteOrAnchor.test(target)) {
    return `the link target "${target}" has no scheme and is not an anchor`;
  }
  return undefined;
}

function htmlProblem(html: string): string | undefined {
  if (html.replace(htmlComment, '').trim() === '') {
    return undefined;
  }
  const [firstLine = ''] = html.trim().split('\n');
  return `raw HTML ${JSON.stringify(firstLine.trimEnd())}: a package README holds no HTML but comments`;
}

function tokenProblem(token: MarkedToken): string | undefined {
  switch (token.type) {
    case 'def':
    case 'image':
    case 'link':
      return targetProblem(token.href);
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
function tokenProblems(pinned: string): ReadmeProblem[] {
  const problems: ReadmeProblem[] = [];
  for (const { token, line } of locatedTokens(pinned)) {
    const problem = tokenProblem(token);
    if (problem !== undefined) {
      problems.push({ line, problem });
    }
  }
  return problems;
}

/** The problems in line order, those of one line in the order found. */
function inLineOrder(problems: readonly ReadmeProblem[]): ReadmeProblem[] {
  return [...problems].sort((first, second) => first.line - second.line);
}

/**
 * The README with each link to a file of `repository` at `main` pointing at the same file at `commit`, or the lines
 * that keep it from being pinned, so that a pinned README holds nothing at `main`.
 *
 * It pins the link target `https://github.com/<repository>/blob/main/<path>` and refuses any other mention of
 * `repository` in its text, code included and backslashes ignored. Read as GitHub Flavored Markdown, it refuses a
 * link, image or definition target with no scheme and no `#`, which GitHub and npm resolve against the default
 * branch, a target holding a character reference, which a browser decodes and the parser does not, and raw HTML
 * other than a comment, whose attributes hold targets Markdown does not parse. Code never gives a target.
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
  const problems = [...mentionProblems(readme, repository), ...tokenProblems(pinned)];
  if (problems.length > 0) {
    return { kind: 'refused', problems: inLineOrder(problems) };
  }
  return { kind: 'pinned', text: pinned };
}
