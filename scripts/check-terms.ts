import { globSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const boldPhrase = /\*\*([^*\n]+)\*\*/g;
const multiWordTerm = /^[A-Z]\S*( \S+)+$/;
const fencedBlock = /^([ \t]*)(```|~~~)[\s\S]*?^\1\2.*$/gm;
const codeSpan = /`[^`\n]*`/g;
const linkDestination = /\]\([^)\n]*\)/g;
const bareUrl = /https?:\/\/\S+/g;
const root = join(import.meta.dirname, '..');

/** A prose use of a glossary term that CONTEXT.md spells otherwise. */
export type TermMisspelling = {
  readonly line: number;
  /** The words as the document writes them, such as `direct calls`. */
  readonly written: string;
  /** The term as CONTEXT.md spells it, such as `Direct call`. */
  readonly term: string;
};

/** The glossary's terms of two words or more: each bold phrase of CONTEXT.md that starts with a capital letter. */
export function multiWordTerms(glossary: string): string[] {
  const phrases = [...glossary.matchAll(boldPhrase)].map(([, phrase = '']) => phrase);
  return [...new Set(phrases.filter((phrase) => multiWordTerm.test(phrase)))];
}

/** `markdown` with code, fenced blocks and link destinations replaced by spaces, so every line keeps its number. */
function proseOf(markdown: string): string {
  const blankedOut = (match: string): string => match.replace(/[^\n]/g, ' ');
  let prose = markdown;
  for (const notProse of [fencedBlock, codeSpan, linkDestination, bareUrl]) {
    prose = prose.replace(notProse, blankedOut);
  }
  return prose;
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The pattern of a use of any term or its plural, longest term first so that Breaking Change Approval is not read as Breaking Change. */
function usesOf(terms: readonly string[]): RegExp {
  const longestFirst = [...terms].sort((left, right) => right.length - left.length);
  const spaced = longestFirst.map((term) => term.split(' ').map(escaped).join('\\s+'));
  return new RegExp(`(?<![\\w-])(${spaced.join('|')})(s|es)?(?![\\w-])`, 'gi');
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

/**
 * Each use in the prose of `markdown`, even across a line break, of a term or its plural that is spelled
 * otherwise than in `terms`.
 */
export function misspelledTerms(markdown: string, terms: readonly string[]): TermMisspelling[] {
  const prose = proseOf(markdown);
  const spelledOut = new Map(terms.map((term) => [term.toLowerCase(), term]));
  const misspellings: TermMisspelling[] = [];
  for (const { 1: head = '', 2: ending = '', index } of prose.matchAll(usesOf(terms))) {
    const words = head.replace(/\s+/g, ' ');
    const term = spelledOut.get(words.toLowerCase());
    if (term !== undefined && words !== term) {
      misspellings.push({ line: lineOf(prose, index), term, written: words + ending });
    }
  }
  return misspellings;
}

function messageOf({ term, written }: TermMisspelling): string {
  const ending = written.slice(term.length);
  return `terms: write "${term}${ending}", not "${written}".`;
}

/** The documents CLAUDE.md lists: the root ones and each package's README.md and ARCHITECTURE.md. */
function documents(): string[] {
  const rootDocuments = globSync('*.md', { cwd: root });
  const packageDocuments = globSync('packages/*/{README,ARCHITECTURE}.md', { cwd: root });
  return [...rootDocuments, ...packageDocuments].sort();
}

function checkDocuments(): void {
  const terms = multiWordTerms(readFileSync(join(root, 'CONTEXT.md'), 'utf8'));
  for (const path of documents()) {
    const markdown = readFileSync(join(root, path), 'utf8');
    for (const misspelling of misspelledTerms(markdown, terms)) {
      const shown = relative(process.cwd(), join(root, path));
      console.error(`${shown}:${misspelling.line} ${messageOf(misspelling)}`);
      process.exitCode = 1;
    }
  }
}

if (import.meta.main) {
  checkDocuments();
}
