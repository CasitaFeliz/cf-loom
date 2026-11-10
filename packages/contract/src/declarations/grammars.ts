import { reservedNames } from './reserved-names.ts';

/**
 * A grammar a kind of name follows, so it is safe in code, file names, subjects and broker names:
 * its pattern, the most characters it allows, and the words it refuses though they match.
 */
export type Grammar = {
  readonly name: string;
  readonly pattern: RegExp;
  /** The most characters a name may have; none bounds a grammar whose names reach no broker or file name. */
  readonly maxLength?: number;
  readonly reserved?: ReadonlySet<string>;
};

/** A grammar that bounds its names, so a sentence about it can state how many characters. */
export type CappedGrammar = Grammar & { readonly maxLength: number };

/**
 * The most characters a name that reaches a broker name or a file name has, 64 of the 72 that keep
 * every Stream and Durable consumer name within the 255 characters NATS allows.
 */
const nameLength = 64;

/** The grammar of a Service, Application or Group name. */
export const kebabCase: CappedGrammar = {
  name: 'kebab-case',
  pattern: /^[a-z0-9]+(-[a-z0-9]+)*$/,
  maxLength: nameLength,
};

/** The grammar of a path param's name and a recursion id. */
export const camelCase: Grammar = { name: 'camelCase', pattern: /^[a-z][a-zA-Z0-9]*$/ };

/**
 * The grammar of an Endpoint, Guard or Subscription name: camelCase words, each capital starting
 * a word of lower-case letters and digits, and no reserved name.
 */
export const elementName: CappedGrammar = {
  name: 'camelCase words',
  pattern: /^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]+)*$/,
  maxLength: nameLength,
  reserved: new Set<string>(reservedNames),
};

/** The grammar of a Message name: PascalCase words, each capital starting a word. */
export const pascalCase: CappedGrammar = {
  name: 'PascalCase words',
  pattern: /^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)*$/,
  maxLength: nameLength,
};

/** The grammar of a Service's name, which an Application's name follows too: the one place it is named. */
export const serviceNameGrammar: CappedGrammar = kebabCase;

/** The grammar of a Message name, an Event's or a Command's: the one place it is named. */
export const messageNameGrammar: CappedGrammar = pascalCase;

/** The grammar of a Subscription's name: the one place it is named. */
export const subscriptionNameGrammar: CappedGrammar = elementName;

/** The grammar of a Rejection code. */
export const upperSnakeCase: CappedGrammar = {
  name: 'UPPER_SNAKE_CASE',
  pattern: /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/,
  maxLength: nameLength,
};

/** Whether a value is a string the grammar accepts: its pattern, its length and no reserved word. */
export function follows(grammar: Grammar, value: unknown): value is string {
  return (
    typeof value === 'string' &&
    grammar.pattern.test(value) &&
    !isTooLong(grammar, value) &&
    !isReserved(grammar, value)
  );
}

/** What a name of the grammar is, as a sentence says it: `kebab-case of at most 64 characters`. */
export function ruleOf(grammar: CappedGrammar): string {
  return `${grammar.name} of at most ${grammar.maxLength} characters`;
}

function isTooLong(grammar: Grammar, value: string): boolean {
  return grammar.maxLength !== undefined && value.length > grammar.maxLength;
}

/** Whether a name the grammar's pattern matches is a word it refuses. */
export function isReserved(grammar: Grammar, value: string): boolean {
  return grammar.reserved?.has(value) ?? false;
}

/** A name re-spelled so each run of capitals is one word, `getURL` as `getUrl`. */
export function wordsOf(name: string): string {
  return name.replace(/([A-Z]{2,})([a-z]?)/g, (_, run: string, next: string) =>
    next === '' ? titled(run) : `${titled(run.slice(0, -1))}${run.slice(-1)}${next}`,
  );
}

function titled(capitals: string): string {
  return `${capitals.charAt(0)}${capitals.slice(1).toLowerCase()}`;
}
