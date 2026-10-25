import { safeParse } from 'zod/v4/core';
import {
  formatSchemaOf,
  type NumberNode,
  type SchemaNode,
  type StringNode,
} from '../walker/index.ts';
import { valueOfText } from './text.ts';

/** Whether a node accepts a text: decided either way, or `unknown` where the Snapshot cannot say. */
export type TextAcceptance = 'accepted' | 'refused' | 'unknown';

/**
 * Whether a param or query node may accept one text as the runtime reads it: by value, type and
 * constraints, or `unknown` where the node's rules cannot be decided without the author's schema.
 */
export function textAcceptanceOf(node: SchemaNode, text: string): TextAcceptance {
  const value = valueOfText(node, [text]);
  switch (node.type) {
    case 'enum':
      return node.open || node.values.some((declared) => declared === value)
        ? 'accepted'
        : 'refused';
    case 'boolean':
      return typeof value === 'boolean' ? 'accepted' : 'refused';
    case 'number':
      return typeof value === 'number' ? numberAcceptanceOf(node, value) : 'refused';
    case 'string':
      return stringAcceptanceOf(node, text);
    case 'object':
    case 'record':
    case 'array':
    case 'tuple':
    case 'union':
    case 'tagged':
    case 'allOf':
    case 'json':
    case 'ref':
      return 'unknown';
  }
}

function numberAcceptanceOf(node: NumberNode, value: number): TextAcceptance {
  const outside = [
    node.int === true && !Number.isSafeInteger(value),
    node.min !== undefined && value < node.min,
    node.max !== undefined && value > node.max,
    node.exclusiveMin !== undefined && value <= node.exclusiveMin,
    node.exclusiveMax !== undefined && value >= node.exclusiveMax,
  ];
  if (outside.includes(true)) {
    return 'refused';
  }
  return node.multipleOf === undefined ? 'accepted' : stepAcceptanceOf(value, node.multipleOf);
}

/** A multiple judged on whole numbers alone, where no rounding can turn an accepted value away. */
function stepAcceptanceOf(value: number, step: number): TextAcceptance {
  if (!Number.isInteger(value) || !Number.isInteger(step)) {
    return 'unknown';
  }
  return value % step === 0 ? 'accepted' : 'refused';
}

function stringAcceptanceOf(node: StringNode, text: string): TextAcceptance {
  const outside =
    (node.min !== undefined && text.length < node.min) ||
    (node.max !== undefined && text.length > node.max);
  const checks = [
    outside ? 'refused' : 'accepted',
    node.regex === undefined ? 'accepted' : regexAcceptanceOf(node.regex, text),
    node.format === undefined ? 'accepted' : formatAcceptanceOf(node, text),
  ];
  if (checks.includes('refused')) {
    return 'refused';
  }
  return checks.includes('unknown') ? 'unknown' : 'accepted';
}

function regexAcceptanceOf(regex: NonNullable<StringNode['regex']>, text: string): TextAcceptance {
  try {
    return new RegExp(regex.source, regex.flags).test(text) ? 'accepted' : 'refused';
  } catch {
    return 'unknown';
  }
}

function formatAcceptanceOf(node: StringNode, text: string): TextAcceptance {
  const schema =
    node.format === undefined ? undefined : formatSchemaOf(node.format, node.formatOptions ?? {});
  if (schema === undefined) {
    return 'unknown';
  }
  return safeParse(schema, text).success ? 'accepted' : 'refused';
}
