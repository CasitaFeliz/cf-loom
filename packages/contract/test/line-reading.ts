/** What a reader of a line takes as one word of an item: the characters of a text that is not quoted. */
export type WordClass = 'item' | 'path';

const wordPatterns: Readonly<Record<WordClass, RegExp>> = {
  item: /[A-Za-z0-9_@/$.:+~-]+/y,
  path: /[A-Za-z0-9_@/$-]+/y,
};

type Word = { readonly text: string; readonly end: number; readonly isClosing: boolean };

function closingQuoteOf(line: string, open: number): number | undefined {
  for (let position = open + 1; position < line.length; position++) {
    if (line[position] === '\\') {
      position++;
    } else if (line[position] === '"') {
      return position + 1;
    }
  }
  return undefined;
}

/** The word at `from`: a JSON string, or a run of the class's characters, where a bare `and` or `or` is no item but a closing. */
function readWord(line: string, from: number, wordClass: WordClass): Word | undefined {
  if (line[from] === '"') {
    const end = closingQuoteOf(line, from);
    return end === undefined
      ? undefined
      : { text: JSON.parse(line.slice(from, end)), end, isClosing: false };
  }
  const pattern = wordPatterns[wordClass];
  pattern.lastIndex = from;
  const text = pattern.exec(line)?.[0];
  if (text === undefined) {
    return undefined;
  }
  return { text, end: from + text.length, isClosing: text === 'and' || text === 'or' };
}

type Unit = { readonly words: readonly string[]; readonly end: number };

/** Words separated by single spaces, up to a `,` or the closing word of the list or the end. */
function readUnit(line: string, from: number): Unit | undefined {
  const words: string[] = [];
  let position = from;
  for (;;) {
    const word = readWord(line, position, 'item');
    if (word === undefined || word.isClosing) {
      return undefined;
    }
    words.push(word.text);
    position = word.end;
    const next = line[position] === ' ' ? readWord(line, position + 1, 'item') : undefined;
    if (next === undefined || next.isClosing) {
      return { words, end: position };
    }
    position++;
  }
}

/**
 * The units of a list, each as its words, or `undefined` when the line is no list: `a, b and c`
 * is three units of one word, `x y, z` two of two and one.
 */
export function readList(line: string): readonly (readonly string[])[] | undefined {
  if (line === '') {
    return [];
  }
  const units: (readonly string[])[] = [];
  let position = 0;
  for (;;) {
    const unit = readUnit(line, position);
    if (unit === undefined) {
      return undefined;
    }
    units.push(unit.words);
    position = unit.end;
    if (position === line.length) {
      return units;
    }
    const closing = /^ (?:and|or) /.exec(line.slice(position));
    if (closing === null && line.startsWith(', ', position)) {
      position += 2;
      continue;
    }
    if (closing === null) {
      return undefined;
    }
    const last = readUnit(line, position + closing[0].length);
    return last?.end === line.length ? [...units, last.words] : undefined;
  }
}

/** The words of one item, separated by spaces, or `undefined` when the line is no such item. */
export function readWords(line: string): readonly string[] | undefined {
  const unit = readUnit(line, 0);
  return unit?.end === line.length ? unit.words : undefined;
}

/** The keys of a path, separated by dots, or `undefined` when the line is no path. */
export function readPath(line: string): readonly string[] | undefined {
  const keys: string[] = [];
  let position = 0;
  for (;;) {
    const word = readWord(line, position, 'path');
    if (word === undefined) {
      return undefined;
    }
    keys.push(word.text);
    if (word.end === line.length) {
      return keys;
    }
    if (line[word.end] !== '.') {
      return undefined;
    }
    position = word.end + 1;
  }
}

/** The one key a text ends with, from `from`: a JSON string, or a run of the path class's characters. */
export function readKeyAt(line: string, from: number): string | undefined {
  const word = readWord(line, from, 'path');
  return word?.end === line.length ? word.text : undefined;
}

/**
 * The keys and positions of the steps of an author's path, `a."b c"[2].d`: a key bare at the start
 * and after a dot, a position in brackets; `undefined` when the line is no such path.
 */
export function readSteps(line: string): readonly (string | number)[] | undefined {
  const steps: (string | number)[] = [];
  let position = 0;
  while (position < line.length) {
    const bracket = /\[(\d+)\]/y;
    bracket.lastIndex = position;
    const index = bracket.exec(line)?.[1];
    if (index !== undefined) {
      steps.push(Number(index));
      position += index.length + 2;
      continue;
    }
    const isFirst = position === 0;
    if (!isFirst && line[position] !== '.') {
      return undefined;
    }
    const key = readWord(line, isFirst ? 0 : position + 1, 'path');
    if (key === undefined) {
      return undefined;
    }
    steps.push(key.text);
    position = key.end;
  }
  return steps;
}
