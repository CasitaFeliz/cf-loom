import {
  type CodeSnapshot,
  type EndpointSnapshot,
  isLive,
  type SchemaNode,
} from '@cf-loom/contract/internal';
import { definedOf, jsonSchemaOf } from '../json-schema/index.ts';
import { jsonContentOf } from './content.ts';
import type { OpenApiObject } from './objects.ts';
import { demandedParametersOf, pathParametersOf } from './parameters.ts';
import { responsesOf, retiredResponsesOf } from './responses.ts';

/**
 * The operation of an Endpoint: what its Snapshot entry says, and what `serve` answers; a Retired
 * Endpoint answers `RETIRED` and reads nothing but its path.
 */
export function operationOf(
  method: string,
  endpoint: EndpointSnapshot,
  codes: Readonly<Record<string, CodeSnapshot>>,
): OpenApiObject {
  return {
    ...definedOf({
      operationId: endpoint.name,
      tags: [endpoint.group],
      description: endpoint.description === '' ? undefined : endpoint.description,
      deprecated: endpoint.lifecycle === 'active' ? undefined : true,
      'x-cf-loom-visibility': endpoint.visibility,
      'x-cf-loom-guards': endpoint.guards,
    }),
    ...(isLive(endpoint) ? liveOf(method, endpoint, codes) : retiredOf(method, endpoint)),
  };
}

function liveOf(
  method: string,
  endpoint: EndpointSnapshot,
  codes: Readonly<Record<string, CodeSnapshot>>,
): OpenApiObject {
  const parameters = [...pathParametersOf(endpoint), ...demandedParametersOf(endpoint)];
  const { body } = endpoint.input;
  return definedOf({
    parameters: parameters.length === 0 ? undefined : parameters,
    requestBody:
      body === null ? undefined : { required: true, content: jsonContentOf(jsonSchemaOf(body)) },
    responses: responsesOf(method, endpoint, codes),
  });
}

function retiredOf(method: string, endpoint: EndpointSnapshot): OpenApiObject {
  const parameters = pathParametersOf(endpoint);
  return definedOf({
    parameters: parameters.length === 0 ? undefined : parameters,
    responses: retiredResponsesOf(method),
  });
}

/** The parts of an Endpoint's Snapshot entry that `operationOf` writes, so the defs they reach are written too. */
export function writtenPartsOf(endpoint: EndpointSnapshot): readonly (SchemaNode | null)[] {
  const { input, success } = endpoint;
  return isLive(endpoint)
    ? [input.params, input.query, input.headers, input.body, success.headers, success.body]
    : [input.params];
}
