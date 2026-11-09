import type { MarkedToken, Token, Tokens } from 'marked';
import { Lexer } from 'marked';

/** A token of a Markdown text with the line where its source starts, and the token that holds it. */
export type LocatedToken = {
  readonly token: MarkedToken;
  readonly line: number;
  /** The token whose children it is, `undefined` at the top level; a table cell's tokens have the table. */
  readonly parent: MarkedToken | undefined;
};

/** A token and the number of lines between the start of what holds it and the start of its own source. */
type Child = { readonly token: MarkedToken; readonly offset: number };

/**
 * The lexer's tokens as `MarkedToken`s. No extension is registered, so the lexer yields no `Tokens.Generic`, the
 * member of `Token` that lets any type and any property through.
 */
function markedTokens(tokens: readonly Token[]): readonly MarkedToken[] {
  return tokens as readonly MarkedToken[];
}

/** The tokens a token holds, which together make up its source token by token. */
function contentOf(token: MarkedToken): readonly MarkedToken[] {
  switch (token.type) {
    case 'blockquote':
    case 'del':
    case 'em':
    case 'heading':
    case 'image':
    case 'link':
    case 'list_item':
    case 'paragraph':
    case 'strong':
      return markedTokens(token.tokens);
    case 'text':
      return markedTokens(token.tokens ?? []);
    case 'list':
      return token.items;
    case 'br':
    case 'checkbox':
    case 'code':
    case 'codespan':
    case 'def':
    case 'escape':
    case 'hr':
    case 'html':
    case 'space':
    case 'table':
      return [];
  }
}

function breaksIn(text: string): number {
  let breaks = 0;
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) {
    breaks++;
  }
  return breaks;
}

/** Each token with the line it starts on, `start` lines after the start of what holds them: the line breaks of the tokens before it. */
function tiled(tokens: readonly MarkedToken[], start: number): Child[] {
  const children: Child[] = [];
  let offset = start;
  for (const token of tokens) {
    children.push({ token, offset });
    offset += breaksIn(token.raw);
  }
  return children;
}

/** A table's header cells are on its line and the cells of row `r` on its line plus 2 plus `r`. */
function cellsOf(table: Tokens.Table): Child[] {
  const children: Child[] = [];
  for (const [index, row] of [table.header, ...table.rows].entries()) {
    const offset = index === 0 ? 0 : index + 1;
    for (const cell of row) {
      for (const child of tiled(markedTokens(cell.tokens), offset)) {
        children.push(child);
      }
    }
  }
  return children;
}

function childrenOf(token: MarkedToken): Child[] {
  return token.type === 'table' ? cellsOf(token) : tiled(contentOf(token), 0);
}

/** Puts `children` on `pending`, the first on top, each `offset` lines after `parent`. */
function pushChildren(
  pending: LocatedToken[],
  children: readonly Child[],
  parent: LocatedToken | undefined,
): void {
  for (const { token, offset } of children.toReversed()) {
    pending.push({ token, line: (parent?.line ?? 0) + offset, parent: parent?.token });
  }
}

/**
 * The tokens of `markdown` as GitHub Flavored Markdown, in document order, each with the line where its source
 * starts: a token's line is its parent's line plus the line breaks in the source of the tokens before it, since
 * `marked` reads a container's content token by token and a container keeps every line break. A table's header cells
 * are on its line, and the cells of row r on its line plus 2 plus r.
 */
export function locatedTokens(markdown: string): readonly LocatedToken[] {
  const text = markdown.replace(/\r\n?/g, '\n');
  const lexed = markedTokens(Lexer.lex(text, { gfm: true, pedantic: false }));
  const located: LocatedToken[] = [];
  const pending: LocatedToken[] = [];
  pushChildren(pending, tiled(lexed, 1), undefined);
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    located.push(next);
    pushChildren(pending, childrenOf(next.token), next);
  }
  return located;
}
