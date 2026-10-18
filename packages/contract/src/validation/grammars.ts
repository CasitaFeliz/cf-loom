/** A grammar a kind of name follows, so it is safe in code, subjects and broker names. */
export type Grammar = { readonly name: string; readonly pattern: RegExp };

/** The grammar of a Service, Application, Definitions Package, Group or Subscription name. */
export const kebabCase: Grammar = { name: 'kebab-case', pattern: /^[a-z0-9]+(-[a-z0-9]+)*$/ };

/** The grammar of an Endpoint or Guard name, and of a path param's name. */
export const camelCase: Grammar = { name: 'camelCase', pattern: /^[a-z][a-zA-Z0-9]*$/ };

/** The grammar of a Rejection code. */
export const upperSnakeCase: Grammar = {
  name: 'UPPER_SNAKE_CASE',
  pattern: /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/,
};

/** Whether a value is a string the grammar accepts. */
export function follows(grammar: Grammar, value: unknown): value is string {
  return typeof value === 'string' && grammar.pattern.test(value);
}
