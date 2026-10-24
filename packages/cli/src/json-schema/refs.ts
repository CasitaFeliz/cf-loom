import type { JsonSchema } from './keywords.ts';

/** The pointer to the components an OpenAPI or AsyncAPI document keeps its reusable schemas under. */
const componentsPointer = '#/components/schemas/';

/** The schema that refers to a component of the document by its name. */
export function componentRefOf(name: string): JsonSchema {
  return { $ref: `${componentsPointer}${name}` };
}
