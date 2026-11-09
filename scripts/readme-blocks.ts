import { locatedTokens } from './markdown-tokens.ts';

/** A README: the path reports name it by, and its text. */
export type Readme = { readonly path: string; readonly markdown: string };

/** A file a README shows in a TypeScript block: where it starts, where it is written, and its code. */
export type Block = {
  readonly readme: string;
  readonly line: number;
  readonly path: string;
  readonly named: boolean;
  readonly source: string;
};

/** The files of a README, and why a block cannot be read, as `README:line: …`. */
export type Blocks = { readonly blocks: Block[]; readonly problems: string[] };

type CodeFile = {
  readonly line: number;
  readonly path: string | undefined;
  readonly source: string;
};

const typeScriptInfo = /^(?:ts|typescript)(?:\s|$)/;
const pathComment = /^\/\/\s+([\w./-]+\.ts)\b/;
const servicePath = /^(?:(?!node_modules\/)([\w-]+)\/)?src\/(?:(?!\.\.?\/)[\w.-]+\/)*[\w.-]+\.ts$/;

/**
 * The Service a path is a file of, as Layout names its paths: `src/…` is the Service's own (`''`),
 * `<service>/src/…` that Service's, with no `.` or `..` segment; any other path is no path of a
 * Service.
 */
export function serviceOf(path: string): string | undefined {
  const match = servicePath.exec(path);
  return match === null ? undefined : (match[1] ?? '');
}

/**
 * Every file the TypeScript blocks of a README show, read as GitHub Flavored Markdown: each fenced block whose
 * info string starts with `ts` or `typescript`, whatever its fence or container. A path comment names a file, and
 * starts another when it follows a blank line; a path that is no path of a Service is a problem, and its file is left
 * out. A file with no path comment is written under its nearest heading.
 */
export function blocksOf(readme: Readme): Blocks {
  const blocks: Block[] = [];
  const problems: string[] = [];
  const snippetPath = snippetNamer(readme.path);
  let anchor = '';
  for (const { token, line } of locatedTokens(readme.markdown)) {
    if (token.type === 'heading') {
      anchor = headingAnchor(token.text);
    } else if (token.type === 'code' && typeScriptInfo.test(token.lang ?? '')) {
      for (const file of filesOf(token.text.split('\n'), line + 1)) {
        const refusal = refusalOf(readme.path, file);
        if (refusal === undefined) {
          blocks.push(blockOf(readme.path, file, () => snippetPath(anchor)));
        } else {
          problems.push(refusal);
        }
      }
    }
  }
  return { blocks, problems };
}

/** The block a file of a README is, written where its path comment says, else where `snippetPath` names. */
function blockOf(readme: string, file: CodeFile, snippetPath: () => string): Block {
  const path = file.path ?? snippetPath();
  return { readme, line: file.line, path, named: file.path !== undefined, source: file.source };
}

/** Why a file of a block is left out: its path comment names no path of a Service. */
function refusalOf(readme: string, file: CodeFile): string | undefined {
  if (file.path === undefined || serviceOf(file.path) !== undefined) {
    return undefined;
  }
  return `${readme}:${file.line}: ${file.path} is no path of a Service: src/… or <service>/src/…`;
}

/** The files in a block's lines: one for each path comment at its start or after a blank line. */
function filesOf(code: readonly string[], firstLine: number): CodeFile[] {
  const starts = [0];
  for (const [index, row] of code.entries()) {
    const afterBlank = code[index - 1]?.trim() === '';
    if (index > 0 && afterBlank && pathComment.test(row)) {
      starts.push(index);
    }
  }
  return starts.map((from, position) => {
    const rows = code.slice(from, starts[position + 1] ?? code.length);
    while (rows.at(-1)?.trim() === '') {
      rows.pop();
    }
    const path = pathComment.exec(rows[0] ?? '')?.[1];
    return { line: firstLine + from, path, source: rows.join('\n') };
  });
}

/** Where a file without a path is written: one folder deep, so its `../src/…` imports resolve. */
function snippetNamer(readme: string): (anchor: string) => string {
  const counts = new Map<string, number>();
  const label =
    /^packages\/([^/]+)\/README\.md$/.exec(readme)?.[1] ?? readme.replaceAll(/\W+/g, '-');
  return (anchor) => {
    const count = (counts.get(anchor) ?? 0) + 1;
    counts.set(anchor, count);
    const name = [label, anchor].filter((part) => part !== '').join('-');
    return `snippets/${name}${count > 1 ? `-${count}` : ''}.ts`;
  };
}

/** The anchor GitHub gives a heading: lower case, its punctuation dropped, its spaces hyphens. */
function headingAnchor(text: string): string {
  const kept = text.toLowerCase().replaceAll(/[^\p{L}\p{N}\s-]/gu, '');
  return kept.trim().replaceAll(/\s+/g, '-');
}
