import { jsonContentType } from '@cf-loom/contract/internal';
import type { JsonSchema } from '../json-schema/index.ts';

/** The content of a request or response body: the schema, under the one content type bodies travel with. */
export function jsonContentOf(schema: JsonSchema): Readonly<Record<string, unknown>> {
  return { [jsonContentType]: { schema } };
}
