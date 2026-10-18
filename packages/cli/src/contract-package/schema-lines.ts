import type { SchemaNode } from '@casitafeliz/loom-contract/internal';
import { type Writing, zodExpressionOf } from '../schema-code/index.ts';

/** An object of schema parts, each declared one written in a mode; none when no part is. */
export function partsLinesOf(
  key: string,
  parts: Readonly<Record<string, SchemaNode | null>>,
  writing: Writing,
): readonly string[] {
  const written = Object.entries(parts).filter(isDeclaredPart);
  if (written.length === 0) {
    return [];
  }
  const lines = written.map(([part, node]) => `    ${part}: ${zodExpressionOf(node, writing)},`);
  return [`  ${key}: {`, ...lines, '  },'];
}

/** One schema field of a declaration, when it declares one. */
export function schemaLineOf(
  key: string,
  node: SchemaNode | null,
  writing: Writing,
): readonly string[] {
  return node === null ? [] : [`  ${key}: ${zodExpressionOf(node, writing)},`];
}

function isDeclaredPart(part: [string, SchemaNode | null]): part is [string, SchemaNode] {
  return part[1] !== null;
}
