import { defTypeNameOf } from '../schema-code/index.ts';
import type { JsonSchema } from './keywords.ts';

/** The pointer to the components an OpenAPI or AsyncAPI document keeps its reusable schemas under. */
const componentsPointer = '#/components/schemas/';

/** The schema that refers to a component of the document by its name. */
export function componentRefOf(name: string): JsonSchema {
  return { $ref: `${componentsPointer}${name}` };
}

/** The name of a recursive def's component: the name of its type in the Contract Package. */
export function defComponentNameOf(id: string): string {
  return defTypeNameOf(id, 'declared');
}
