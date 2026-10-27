/** A README: the path reports name it by, and its text. */
export type Readme = { readonly path: string; readonly markdown: string };

/** A TypeScript block of a README: where it starts, the file it is, and its code. */
export type Block = {
  readonly readme: string;
  readonly line: number;
  readonly path: string;
  readonly source: string;
};

/** The blocks of a README, and why a block cannot be read, as `README:line: …`. */
export type Blocks = { readonly blocks: Block[]; readonly problems: string[] };

const opening = /^(\s*)```(?:ts|typescript)(?:\s.*)?$/;
const closing = /^\s*```\s*$/;
const pathComment = /^\/\/\s+((?:[\w.-]+\/)+[\w.-]+\.ts)\b/;

/** Every fenced `ts` block of a README, each with the path its first-line comment names. */
export function blocksOf(readme: Readme): Blocks {
  const lines = readme.markdown.split(/\r?\n/);
  const blocks: Block[] = [];
  const problems: string[] = [];
  let at = 0;
  while (at < lines.length) {
    const indent = opening.exec(lines[at] ?? '')?.[1];
    if (indent === undefined) {
      at++;
      continue;
    }
    const end = lines.findIndex((line, index) => index > at && closing.test(line));
    if (end === -1) {
      problems.push(`${readme.path}:${at + 1}: the TypeScript block is never closed`);
      break;
    }
    const source = lines
      .slice(at + 1, end)
      .map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line))
      .join('\n');
    blocks.push({
      readme: readme.path,
      line: at + 2,
      path: pathOf(source, readme.path, at + 2),
      source,
    });
    at = end + 1;
  }
  return { blocks, problems };
}

/** The path a block's first line names, or one that tells it from the other blocks of its README. */
function pathOf(source: string, readme: string, line: number): string {
  const named = pathComment.exec(source)?.[1];
  return named ?? `snippets/${readme.replaceAll(/\W+/g, '-')}-${line}.ts`;
}
