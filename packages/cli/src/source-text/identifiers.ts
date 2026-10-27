import { kebabCaseOf } from '@cf-loom/contract/internal';

/** The kebab-case of an UPPER_SNAKE_CASE Rejection code: `ORDER_LOCKED` is `order-locked`. */
export function kebabCaseOfCode(code: string): string {
  return code.toLowerCase().replaceAll('_', '-');
}

/**
 * The camelCase of an UPPER_SNAKE_CASE Rejection code, which never loses information: `ORDER_LOCKED`
 * is `orderLocked`, and a word that starts with a digit keeps its underscore, so `ORDER_V_2` is
 * `orderV_2` and `ORDER_V2` is `orderV2`.
 */
export function camelCaseOfCode(code: string): string {
  const [first = '', ...rest] = code.toLowerCase().split('_');
  return [first, ...rest.map(laterWordOf)].join('');
}

/** A Message's name as files are named: `ChargeCard` is `charge-card`. */
export function messageFileNameOf(name: string): string {
  return kebabCaseOf(lowerFirst(name));
}

/** A Message Version's file name stem, `order-created.v2`, as README's Layout names its files. */
export function messageVersionStemOf(message: {
  readonly name: string;
  readonly version: number;
}): string {
  return `${messageFileNameOf(message.name)}.v${message.version}`;
}

/** The PascalCase of a camelCase name, as a type names it. */
export function pascalCaseOf(name: string): string {
  return upperFirst(name);
}

function laterWordOf(word: string): string {
  return /^[0-9]/.test(word) ? `_${word}` : upperFirst(word);
}

function lowerFirst(word: string): string {
  return `${word.charAt(0).toLowerCase()}${word.slice(1)}`;
}

function upperFirst(word: string): string {
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}
