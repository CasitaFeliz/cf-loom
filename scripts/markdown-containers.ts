import type { MarkedToken } from 'marked';
import type { Draw } from './seeded-draw.ts';

/** Every type of token `marked` produces, so that a test fails to compile when `marked` adds one. */
export const tokenTypes: Record<MarkedToken['type'], true> = {
  blockquote: true,
  br: true,
  checkbox: true,
  code: true,
  codespan: true,
  def: true,
  del: true,
  em: true,
  escape: true,
  heading: true,
  hr: true,
  html: true,
  image: true,
  link: true,
  list: true,
  // biome-ignore lint/style/useNamingConvention: marked names this token type list_item
  list_item: true,
  paragraph: true,
  space: true,
  strong: true,
  table: true,
  text: true,
};

/** What a container puts before each line of what it holds. */
export type Container = {
  /** The prefix of its first line. */
  readonly first: string;
  /** The prefix of every later line, and of a blank line once its trailing white space is cut. */
  readonly rest: string;
  /** A task item holds text first: a block that is no text there is no task. */
  readonly needsText: boolean;
  /** Whether a list marker opens it: the spaces that follow the marker set the column its lines are indented to. */
  readonly hasMarker: boolean;
  /** Whether the prefix holds a tab, whose width depends on its column. */
  readonly hasTab: boolean;
  /** Whether a paragraph's later lines may leave the prefix out: `marked` misreads a list in a quote there. */
  readonly canBeLazy: boolean;
};

function aContainer(first: string, rest: string, flags: Partial<Container> = {}): Container {
  return {
    first,
    rest,
    needsText: false,
    hasMarker: false,
    hasTab: false,
    canBeLazy: true,
    ...flags,
  };
}

/** Every container a Markdown block can sit in, each drawn by the tests of the three readers. */
export const containers: Record<string, Container> = {
  'the top level': aContainer('', ''),
  'a list item': aContainer('- ', '  ', { hasMarker: true }),
  'a task item': aContainer('- [ ] ', '  ', { needsText: true, hasMarker: true }),
  'an ordered item': aContainer('1. ', '   ', { hasMarker: true }),
  'a nested list': aContainer('- - ', '    ', { hasMarker: true }),
  'a blockquote': aContainer('> ', '> '),
  'a nested quote': aContainer('> > ', '> > '),
  'a list in a quote': aContainer('> - ', '>   ', { canBeLazy: false, hasMarker: true }),
  'a quote in a list': aContainer('- > ', '  > '),
  'a quote with a tab': aContainer('>\t', '>\t', { hasTab: true }),
  'an item indented with a tab': aContainer('- ', '\t', { hasMarker: true, hasTab: true }),
};

/** The lines of one block of Markdown, and whether it is a paragraph, whose later lines may be lazy. */
export type MarkdownBlock = { readonly lines: readonly string[]; readonly isParagraph: boolean };

/** Blocks laid out in a container: its lines, and the line of them, counted from 1, that each block starts on. */
export type Placed = { readonly lines: readonly string[]; readonly starts: readonly number[] };

function prefixOf(container: Container, row: number, isLazy: boolean): string {
  if (row === 0) {
    return container.first;
  }
  return isLazy ? '' : container.rest;
}

/** The blocks in `container`, a blank line between two of them, a paragraph's later lines lazy now and then. */
export function placed(blocks: readonly MarkdownBlock[], container: Container, draw: Draw): Placed {
  const lines: string[] = [];
  const starts: number[] = [];
  for (const [index, block] of blocks.entries()) {
    if (index > 0) {
      lines.push(container.rest.trimEnd());
    }
    starts.push(lines.length + 1);
    for (const [at, text] of block.lines.entries()) {
      const isLazy = block.isParagraph && at > 0 && container.canBeLazy && draw() < 0.4;
      lines.push(`${prefixOf(container, lines.length, isLazy)}${text}`);
    }
  }
  return { lines, starts };
}
