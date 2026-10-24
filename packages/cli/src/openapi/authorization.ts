import {
  byCodePoint,
  type EndpointSnapshot,
  type ObjectNode,
  type ServiceSnapshot,
} from '@cf-loom/contract/internal';
import type { OpenApiObject } from './objects.ts';

/** The header credentials travel in, which OpenAPI tools ignore as a parameter and take as a security scheme. */
const authorizationHeader = 'authorization';

/** The security schemes an Endpoint's authorization header stands for, and whether a Caller must send it. */
export type Authorization = { readonly schemes: readonly string[]; readonly required: boolean };

/** The definition of every security scheme: a key sent in the authorization header. */
export const authorizationScheme: OpenApiObject = {
  type: 'apiKey',
  in: 'header',
  name: authorizationHeader,
};

/** An Endpoint's headers without the authorization one, and what that one stands for. */
export type HeadersAndAuthorization = {
  readonly headers: ObjectNode | null;
  readonly authorization: Authorization | undefined;
};

/** Takes the authorization header out of an Endpoint's headers and says which schemes it stands for. */
export function separatedAuthorizationOf(
  endpoint: EndpointSnapshot,
  guards: ServiceSnapshot['guards'],
): HeadersAndAuthorization {
  const { headers } = endpoint.input;
  const header = headers?.fields[authorizationHeader];
  if (headers === null || header === undefined) {
    return { headers, authorization: undefined };
  }
  const others = Object.entries(headers.fields).filter(([name]) => name !== authorizationHeader);
  return {
    headers: { ...headers, fields: Object.fromEntries(others) },
    authorization: { schemes: schemesOf(endpoint, guards), required: header.required },
  };
}

/** The schemes of an authorization header: each attached Guard that demands it, else the Endpoint's own, `authorization`. */
function schemesOf(
  endpoint: EndpointSnapshot,
  guards: ServiceSnapshot['guards'],
): readonly string[] {
  const demanding = endpoint.guards
    .map(({ guard }) => guard)
    .filter((name) => guards[name]?.demands.headers?.fields[authorizationHeader] !== undefined);
  return demanding.length === 0 ? [authorizationHeader] : demanding.sort(byCodePoint);
}

/** The security requirements of an OpenAPI operation: every scheme at once, or none when the header is optional. */
export function securityOf({ schemes, required }: Authorization): readonly OpenApiObject[] {
  const requirement = Object.fromEntries(schemes.map((scheme) => [scheme, []]));
  return required ? [requirement] : [requirement, {}];
}
