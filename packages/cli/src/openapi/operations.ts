import type { EndpointSnapshot } from '@cf-loom/contract/internal';
import { definedOf, jsonSchemaOf } from '../json-schema/index.ts';
import { securityOf } from './authorization.ts';
import { jsonContentOf } from './content.ts';
import type { OpenApiObject } from './objects.ts';
import { demandedParametersOf, pathParametersOf } from './parameters.ts';
import { responsesOf } from './responses.ts';
import type { Served } from './served.ts';

/** The OpenAPI operation of an Endpoint: what its Snapshot entry says and what `serve` reads and answers. */
export function operationOf(
  method: string,
  endpoint: EndpointSnapshot,
  served: Served,
): OpenApiObject {
  const { input, authorization } = served;
  const parameters = [...pathParametersOf(endpoint, input), ...demandedParametersOf(input)];
  return definedOf({
    operationId: endpoint.name,
    tags: [endpoint.group],
    description: endpoint.description === '' ? undefined : endpoint.description,
    deprecated: endpoint.lifecycle === 'active' ? undefined : true,
    'x-cf-loom-visibility': endpoint.visibility,
    'x-cf-loom-guards': endpoint.guards,
    parameters: parameters.length === 0 ? undefined : parameters,
    requestBody: requestBodyOf(input.body),
    responses: responsesOf(method, served),
    security: authorization === undefined ? undefined : securityOf(authorization),
  });
}

function requestBodyOf(body: Served['input']['body']): OpenApiObject | undefined {
  return body === null ? undefined : { required: true, content: jsonContentOf(jsonSchemaOf(body)) };
}
