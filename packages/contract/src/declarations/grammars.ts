import { reservedNames } from './reserved-names.ts';

/**
 * A grammar a kind of name follows, so it is safe in code, subjects and broker names, and the
 * words it refuses though they match.
 */
export type Grammar = {
  readonly name: string;
  readonly pattern: RegExp;
  readonly reserved?: ReadonlySet<string>;
};

/** The grammar of a Service, Application, Definitions Package or Group name. */
export const kebabCase: Grammar = { name: 'kebab-case', pattern: /^[a-z0-9]+(-[a-z0-9]+)*$/ };

/**
 * The grammar of an Endpoint, Guard or Subscription name, a path param's name and a recursion id.
 */
export const camelCase: Grammar = { name: 'camelCase', pattern: /^[a-z][a-zA-Z0-9]*$/ };

/** The grammar of an Endpoint, Guard or Subscription name: camelCase, and no reserved name. */
export const elementName: Grammar = { ...camelCase, reserved: new Set<string>(reservedNames) };

/** The grammar of a Message name. */
export const pascalCase: Grammar = { name: 'PascalCase', pattern: /^[A-Z][a-zA-Z0-9]*$/ };

/** The grammar of a Rejection code. */
export const upperSnakeCase: Grammar = {
  name: 'UPPER_SNAKE_CASE',
  pattern: /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/,
};

/** Whether a value is a string the grammar accepts. */
export function follows(grammar: Grammar, value: unknown): value is string {
  return typeof value === 'string' && grammar.pattern.test(value) && !isReserved(grammar, value);
}

/** Whether a name the grammar's pattern matches is a word it refuses. */
export function isReserved(grammar: Grammar, value: string): boolean {
  return grammar.reserved?.has(value) ?? false;
}
