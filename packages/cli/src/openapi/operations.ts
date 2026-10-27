import type { EndpointSnapshot } from '@cf-loom/contract/internal';
import { definedOf, jsonSchemaOf } from '../json-schema/index.ts';
import { securityOf } from './authorization.ts';
import { jsonContentOf } from './content.ts';
import type { OpenApiObject } from './objects.ts';
import { demandedParametersOf, pathParametersOf } from './parameters.ts';
import { responsesOf } from './responses.ts';
import type { LiveServed, RetiredServed, Served } from './served.ts';

/** The OpenAPI operation of an Endpoint: what its Snapshot entry says and what `serve` reads and answers. */
export function operationOf(endpoint: EndpointSnapshot, served: Served): OpenApiObject {
  const head = definedOf({
    operationId: endpoint.name,
    tags: [endpoint.group],
    description: endpoint.description,
    deprecated: endpoint.lifecycle === 'active' ? undefined : true,
    'x-cf-loom-visibility': endpoint.visibility,
    'x-cf-loom-guards': endpoint.guards,
  });
  switch (served.kind) {
    case 'retired':
      return { ...head, ...retiredFieldsOf(endpoint, served) };
    case 'live':
      return { ...head, ...liveFieldsOf(endpoint, served) };
  }
}

function retiredFieldsOf(endpoint: EndpointSnapshot, served: RetiredServed): OpenApiObject {
  const parameters = pathParametersOf(endpoint, served.params);
  return definedOf({
    parameters: listedOrNone(parameters),
    responses: responsesOf(served),
  });
}

function liveFieldsOf(endpoint: EndpointSnapshot, served: LiveServed): OpenApiObject {
  const { input, authorization } = served;
  const parameters = [...pathParametersOf(endpoint, input.params), ...demandedParametersOf(input)];
  return definedOf({
    parameters: listedOrNone(parameters),
    requestBody: requestBodyOf(input.body),
    responses: responsesOf(served),
    security: authorization === undefined ? undefined : securityOf(authorization),
  });
}

function listedOrNone<Item>(items: readonly Item[]): readonly Item[] | undefined {
  return items.length === 0 ? undefined : items;
}

function requestBodyOf(body: LiveServed['input']['body']): OpenApiObject | undefined {
  return body === null
    ? undefined
    : { required: true, content: jsonContentOf(jsonSchemaOf(body, '2020-12')) };
}
