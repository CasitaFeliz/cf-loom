import { decimalDigitsOf, type JsonPrimitive, type SchemaNode } from '../walker/index.ts';

/** A number as text: no sign but `-`, no leading zero, no exponent, no trailing dot. */
const numberText = /^-?(0|[1-9]\d*)(\.\d+)?$/;

/** A value a text part or a Success header holds: a string, a number or a boolean. */
export type TextValue = string | number | boolean;

/**
 * A value as the text it travels in: a boolean as JavaScript writes it, a number as plain decimal,
 * so the number pattern reads it back as itself.
 */
export function textOfValue(value: TextValue): string {
  return typeof value === 'number' ? decimalOf(value) : String(value);
}

/**
 * A finite number in plain decimal: JavaScript's shortest round-trip digits, with the decimal point
 * moved by hand, never `toFixed`, which rounds.
 */
function decimalOf(value: number): string {
  const { isNegative, digits, exponent } = decimalDigitsOf(value);
  const sign = isNegative ? '-' : '';
  return `${sign}${digitsWithPoint(digits, digits.length + exponent)}`;
}

/** Digits with the decimal point after `point` of them, padded with zeros on either side. */
function digitsWithPoint(digits: string, point: number): string {
  if (point <= 0) {
    return `0.${'0'.repeat(-point)}${digits}`;
  }
  if (point >= digits.length) {
    return `${digits}${'0'.repeat(point - digits.length)}`;
  }
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}

/** Whether a value is one a text part or a Success header holds. */
export function isTextValue(value: unknown): value is TextValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/**
 * The value a text part's field carries, by its node: `[text]` for a header or param, every
 * occurrence for a query key; a list node converts each, and a single node given several texts
 * keeps them as a list, for its schema to refuse.
 */
export function valueOfText(node: SchemaNode, texts: readonly string[]): unknown {
  if (node.type === 'array') {
    return texts.map((text) => valueOfOneText(node.items, text));
  }
  const [text, ...others] = texts;
  if (text === undefined || others.length > 0) {
    return texts;
  }
  return valueOfOneText(node, text);
}

/** One text as its node reads it; a text that is not its type's is kept, for the schema to refuse. */
function valueOfOneText(node: SchemaNode, text: string): unknown {
  switch (node.type) {
    case 'number':
      return numberText.test(text) ? Number(text) : text;
    case 'boolean':
      return booleanOf(text);
    case 'enum':
      return declaredValueOf(node.values, text);
    case 'string':
    case 'object':
    case 'record':
    case 'array':
    case 'tuple':
    case 'union':
    case 'tagged':
    case 'allOf':
    case 'json':
    case 'ref':
      return text;
  }
}

function booleanOf(text: string): unknown {
  if (text === 'true') {
    return true;
  }
  return text === 'false' ? false : text;
}

/** The declared value whose text, as it travels, is the one received, keeping its JSON type. */
function declaredValueOf(values: readonly JsonPrimitive[], text: string): unknown {
  return values.find((value) => isTextValue(value) && textOfValue(value) === text) ?? text;
}
