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

/** The grammar of an Endpoint or Guard name, and of a path param's name. */
export const camelCase: Grammar = { name: 'camelCase', pattern: /^[a-z][a-zA-Z0-9]*$/ };

/**
 * The words code cannot declare or import a binding by: ECMAScript's reserved words, strict
 * mode's included, `eval` and `arguments`, and `handle`, which every stub imports.
 */
const reservedWords: ReadonlySet<string> = new Set([
  'arguments',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'eval',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'handle',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

/** The grammar of an Endpoint or Guard name: camelCase, and a name its stub can import it by. */
export const elementName: Grammar = { ...camelCase, reserved: reservedWords };

/**
 * The grammar of a Subscription name: kebab-case from a letter, and no word code cannot use, since
 * its camelCase names its pairing, which its stub imports.
 */
export const subscriptionName: Grammar = {
  name: 'kebab-case from a letter',
  pattern: /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/,
  reserved: reservedWords,
};

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
