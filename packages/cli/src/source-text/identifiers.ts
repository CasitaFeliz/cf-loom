/** The kebab-case of a camelCase name, as files are named: `getOrder` is `get-order`. */
export function kebabCaseOf(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** The kebab-case of an UPPER_SNAKE_CASE Rejection code: `ORDER_LOCKED` is `order-locked`. */
export function kebabCaseOfCode(code: string): string {
  return code.toLowerCase().replaceAll('_', '-');
}

/**
 * The camelCase of a name's alphanumeric words, as code names it: `order-locked` is
 * `orderLocked`, and `Tree Node` is `treeNode`.
 */
export function camelCaseOf(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter((word) => word !== '');
  const [first = '', ...rest] = words;
  return [lowerFirst(first), ...rest.map(upperFirst)].join('');
}

/** A Message Version's file name stem, `order-created.v2`, as README's Layout names its files. */
export function messageVersionStemOf(message: {
  readonly name: string;
  readonly version: number;
}): string {
  return `${kebabCaseOf(camelCaseOf(message.name))}.v${message.version}`;
}

/** The PascalCase of a camelCase name, as a type names it. */
export function pascalCaseOf(name: string): string {
  return upperFirst(name);
}

function lowerFirst(word: string): string {
  return `${word.charAt(0).toLowerCase()}${word.slice(1)}`;
}

function upperFirst(word: string): string {
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}
