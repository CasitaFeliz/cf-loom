import type { EndpointSnapshot, Field, ObjectNode } from '@cf-loom/contract/internal';
import { definedOf, jsonSchemaOf } from '../json-schema/index.ts';
import type { OpenApiObject } from './objects.ts';

/** What a Caller sends to an Endpoint. */
type Input = EndpointSnapshot['input'];

/** Where in the request a parameter travels. */
type ParameterIn = 'path' | 'query' | 'header';

/** The parameters of an Endpoint's path, in the order the path names them. */
export function pathParametersOf(
  { name, params }: Pick<EndpointSnapshot, 'name' | 'params'>,
  paramsNode: ObjectNode | null,
): readonly OpenApiObject[] {
  const fields = new Map(Object.entries(paramsNode?.fields ?? {}));
  return params.map((param) => {
    const field = fields.get(param);
    if (field === undefined) {
      throw new Error(`The Endpoint ${name} has the path param ${param}, which its Input lacks`);
    }
    return parameterOf('path', param, field);
  });
}

/** The query and header parameters of an Input, its Guards' demands included. */
export function demandedParametersOf(input: Input): readonly OpenApiObject[] {
  return [...parametersOf('query', input.query), ...parametersOf('header', input.headers)];
}

function parametersOf(location: ParameterIn, object: ObjectNode): readonly OpenApiObject[] {
  return Object.entries(object.fields).map(([name, field]) => parameterOf(location, name, field));
}

/** A parameter with its schema, which keeps its description beside the parameter's own. */
function parameterOf(location: ParameterIn, name: string, field: Field): OpenApiObject {
  return definedOf({
    name,
    in: location,
    required: field.required,
    description: field.schema.description,
    schema: jsonSchemaOf(field.schema, '2020-12'),
  });
}
