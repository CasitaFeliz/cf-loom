import { deprecationHeaderOf } from '@casitafeliz/loom-contract/internal';

/** A response of a Deprecated Endpoint, whatever it answers, carries its `Deprecation` header. */
export function withDeprecation(response: Response, deprecatedAt: string | undefined): Response {
  if (deprecatedAt !== undefined) {
    response.headers.set('deprecation', deprecationHeaderOf(deprecatedAt));
  }
  return response;
}
