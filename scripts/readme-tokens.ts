import type { MarkedToken, Token } from 'marked';
import { Lexer } from 'marked';

/** A token of a Markdown text with the line where its source starts. */
export type LocatedToken = { readonly token: MarkedToken; readonly line: number };

/**
 * The lexer's tokens as `MarkedToken`s. No extension is registered, so the lexer yields no `Tokens.Generic`, the
 * member of `Token` that lets any type and any property through.
 */
function markedTokens(tokens: readonly Token[]): readonly MarkedToken[] {
  return tokens as readonly MarkedToken[];
}

function childrenOf(token: MarkedToken): readonly MarkedToken[] {
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
    case 'table': {
      const cells = [...token.header, ...token.rows.flat()];
      return markedTokens(cells.flatMap((cell) => cell.tokens));
    }
    case 'br':
    case 'checkbox':
    case 'code':
    case 'codespan':
    case 'def':
    case 'escape':
    case 'hr':
    case 'html':
    case 'space':
      return [];
  }
}

type Frame = {
  readonly tokens: readonly MarkedToken[];
  next: number;
  cursor: number;
  readonly end: number;
};

/**
 * The tokens of `markdown` as GitHub Flavored Markdown, in document order, each with the line where its source
 * starts, since `marked` keeps no positions. A token is looked for after the one before it and inside its parent's
 * source; one not found as written there, because `marked` took a container's marker out of it, takes the line of
 * the part before it.
 */
export function locatedTokens(markdown: string): readonly LocatedToken[] {
  const text = markdown.replace(/\r\n?/g, '\n');
  const lineStarts = [0, ...Array.from(text.matchAll(/\n/g), (newline) => newline.index + 1)];
  const lexed = Lexer.lex(text, { gfm: true, pedantic: false });
  const located: LocatedToken[] = [];
  const frames: Frame[] = [{ tokens: markedTokens(lexed), next: 0, cursor: 0, end: text.length }];
  for (let frame = frames.at(-1); frame !== undefined; frame = frames.at(-1)) {
    const token = frame.tokens[frame.next];
    if (token === undefined) {
      frames.pop();
      continue;
    }
    frame.next += 1;
    const found = text.indexOf(token.raw, frame.cursor);
    const foundEnd = found + token.raw.length;
    const isWithin = found !== -1 && foundEnd <= frame.end;
    const at = isWithin ? found : frame.cursor;
    frame.cursor = isWithin ? foundEnd : frame.cursor;
    located.push({ token, line: lineStarts.filter((start) => start <= at).length });
    frames.push({
      tokens: childrenOf(token),
      next: 0,
      cursor: at,
      end: isWithin ? foundEnd : frame.end,
    });
  }
  return located;
}
