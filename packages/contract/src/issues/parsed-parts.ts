import type * as core from 'zod/v4/core';
import { type InputPart, type Issue, ownOf, partFieldOf } from '../written/index.ts';
import { parseValue } from './parse-value.ts';

/** A party's declared parts parsed: each value under its field, or every Issue at its part. */
export type ParsedParts<Part extends InputPart> =
  | { readonly kind: 'value'; readonly value: Readonly<Record<string, unknown>> }
  | { readonly kind: 'issues'; readonly issues: readonly (Issue & { readonly part: Part })[] };

/**
 * Each part a party declares a schema at, an Endpoint's Input or a Guard's demands, parsed with it
 * from the field it is given under, unknown keys stripped; a part it declares none at is not read.
 */
export function parsedPartsOf<Part extends InputPart>(
  parts: readonly Part[],
  schemaAt: (part: Part) => core.$ZodType | undefined,
  given: unknown,
): ParsedParts<Part> {
  const values: (readonly [string, unknown])[] = [];
  const issues: (Issue & { readonly part: Part })[] = [];
  for (const part of parts) {
    const schema = schemaAt(part);
    if (schema === undefined) {
      continue;
    }
    const field = partFieldOf(part);
    const parsed = parseValue(schema, ownOf(given, field));
    if (parsed.kind === 'issues') {
      for (const issue of parsed.issues) {
        issues.push({ part, ...issue });
      }
    } else {
      values.push([field, parsed.value]);
    }
  }
  if (issues.length > 0) {
    return { kind: 'issues', issues };
  }
  return { kind: 'value', value: Object.fromEntries(values) };
}
