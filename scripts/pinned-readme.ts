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

/** What a README writes in place of a mention of `repository` the release cannot point at the commit. */
function unpinnedMention(repository: string): string {
  const form = `[text](https://github.com/${repository}/blob/main/<path>)`;
  return `a reference to ${repository} that is not an inline link or image ${form}, with no title`;
}

/**
 * Each line that names `repository` once its links to a file at `main` are removed, code included, since code names
 * the repository too.
 */
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

/**
 * Why a link, image or definition target keeps a README from being pinned: a character reference, which a browser
 * decodes and `marked` leaves as written, or no scheme and no `#`, which GitHub and npm resolve against `main`.
 */
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

/** Why raw HTML keeps a README from being pinned: its attributes hold targets Markdown does not parse. */
function htmlProblem(html: string): string | undefined {
  if (html.replace(htmlComment, '').trim() === '') {
    return undefined;
  }
  const [firstLine = ''] = html.trim().split('\n');
  return `raw HTML ${JSON.stringify(firstLine.trimEnd())}: a package README holds no HTML but comments`;
}

/** The problem a token causes, or `undefined` when it is neither a target nor raw HTML. */
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

/** The problems of the pinned README read as Markdown, one for each token that causes one. */
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
 * The README with each inline link or image to a file of `repository` at `main` pointing at the same file at
 * `commit`, or the lines that keep it from being pinned, so that a pinned README holds nothing at `main`.
 *
 * A package README so links the repository only as `[text](https://github.com/<owner>/<name>/blob/main/<path>)`,
 * with no title; anything else that could reach `main` refuses it.
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
