import { globSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { MarkedToken } from 'marked';
import { locatedTokens } from './markdown-tokens.ts';

const multiWordTerm = /^[A-Z]\S*( \S+)+$/;
const wordBreak = '(?:[ \\t]+|[ \\t]*\\r?\\n[ \\t]*)';
const root = join(import.meta.dirname, '..');

/** A prose use of a glossary term that CONTEXT.md spells otherwise. */
export type TermMisspelling = {
  readonly line: number;
  /** The words as the document writes them, such as `direct calls`. */
  readonly written: string;
  /** The words as CONTEXT.md spells them, with the ending the document writes, such as `Direct calls`. */
  readonly spelled: string;
};

/** The glossary's terms of two words or more: each bold phrase of CONTEXT.md that starts with a capital letter. */
export function multiWordTerms(glossary: string): string[] {
  const phrases: string[] = [];
  for (const { token } of locatedTokens(glossary)) {
    if (token.type === 'strong') {
      phrases.push(token.text);
    }
  }
  return [...new Set(phrases.filter((phrase) => multiWordTerm.test(phrase)))];
}

/** A stretch of prose: text no markup breaks, and the line where it starts. */
type ProseRun = { text: string; readonly line: number };

/** The text of an inline text token, which holds no other token. */
function proseTextOf(token: MarkedToken): string | undefined {
  return token.type === 'text' && token.tokens === undefined ? token.text : undefined;
}

/**
 * The prose of `markdown`, one run for the text of each inline text token, joined to the one before it across a hard
 * line break: code, HTML, definitions, link destinations and link titles hold none, and emphasis, link text and image
 * text are runs of their own.
 */
function proseRunsOf(markdown: string): ProseRun[] {
  const runs: ProseRun[] = [];
  let isAfterBreak = false;
  for (const { token, line } of locatedTokens(markdown)) {
    const text = proseTextOf(token);
    const previous = runs.at(-1);
    if (text !== undefined && isAfterBreak && previous !== undefined) {
      previous.text += `\n${text}`;
    } else if (text !== undefined) {
      runs.push({ text, line });
    }
    isAfterBreak = token.type === 'br';
  }
  return runs;
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The pattern of a use of any term or its plural, longest term first so that Breaking Change Approval is not read as Breaking Change. */
function usesOf(terms: readonly string[]): RegExp {
  const longestFirst = [...terms].sort((left, right) => right.length - left.length);
  const spaced = longestFirst.map((term) => term.split(' ').map(escaped).join(wordBreak));
  return new RegExp(`(?<![A-Za-z0-9-])(${spaced.join('|')})(s|es)?(?![A-Za-z0-9-])`, 'gi');
}

function lineOf(run: ProseRun, index: number): number {
  return run.line + run.text.slice(0, index).split('\n').length - 1;
}

/**
 * Each use in the prose of `markdown`, read as GitHub Flavored Markdown, of a term or its plural, its words separated
 * by at most one line break, that is spelled otherwise than in `terms`. Code, HTML, link destinations, link titles
 * and definitions are not prose; a URL holds no white space, so none holds a term.
 */
export function misspelledTerms(markdown: string, terms: readonly string[]): TermMisspelling[] {
  const spelledOut = new Map(terms.map((term) => [term.toLowerCase(), term]));
  const misspellings: TermMisspelling[] = [];
  for (const run of proseRunsOf(markdown)) {
    for (const { 1: head = '', 2: ending = '', index } of run.text.matchAll(usesOf(terms))) {
      const words = head.replace(/\s+/g, ' ');
      const term = spelledOut.get(words.toLowerCase());
      if (term !== undefined && words !== term) {
        misspellings.push({
          line: lineOf(run, index),
          written: words + ending,
          spelled: term + ending,
        });
      }
    }
  }
  return misspellings;
}

function messageOf({ spelled, written }: TermMisspelling): string {
  return `terms: write "${spelled}", not "${written}".`;
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
