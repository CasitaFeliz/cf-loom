import { jsonMediaType } from '@cf-loom/contract/internal';
import type { JsonSchema } from '../json-schema/index.ts';
import type { OpenApiObject } from './objects.ts';

/** The content of a request or response body: the schema, under the media type of every body. */
export function jsonContentOf(schema: JsonSchema): OpenApiObject {
  return { [jsonMediaType]: { schema } };
}
