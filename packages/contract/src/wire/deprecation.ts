import { isStampable, stampOf } from '../declarations/index.ts';

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

/**
 * A received `Deprecation` header's instant as a `deprecatedAt` stamp; none for any other text, or
 * for an instant no `Date` can hold.
 */
export function deprecatedAtOfHeader(header: string): string | undefined {
  const seconds = /^@(-?\d+)$/.exec(header)?.[1];
  const instant = Number(seconds) * 1000;
  return isStampable(instant) ? stampOf(instant) : undefined;
}
