/** The header every response of a Deprecated Endpoint carries (RFC 9745). */
export const deprecationHeader = 'deprecation';

/** The `Deprecation` header's value for a `deprecatedAt` stamp: `@<unix seconds>`. */
export function deprecationHeaderOf(deprecatedAt: string): string {
  return `@${Math.floor(Date.parse(deprecatedAt) / 1000)}`;
}

/** A response of a Deprecated Endpoint, whatever it answers, with its `Deprecation` header. */
export function withDeprecation(response: Response, deprecatedAt: string | undefined): Response {
  if (deprecatedAt !== undefined) {
    response.headers.set(deprecationHeader, deprecationHeaderOf(deprecatedAt));
  }
  return response;
}
