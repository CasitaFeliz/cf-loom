/** The one content type bodies travel with. */
export const jsonContentType = 'application/json; charset=utf-8';

/** Whether a request's content type names JSON by its media type, whatever its parameters. */
export function isJsonContentType(contentType: string | null): boolean {
  const mediaType = contentType?.split(';')[0]?.trim().toLowerCase();
  return mediaType === 'application/json';
}

/** The `Deprecation` header's value for a `deprecatedAt` stamp: `@<unix seconds>` (RFC 9745). */
export function deprecationHeaderOf(deprecatedAt: string): string {
  return `@${Math.floor(Date.parse(deprecatedAt) / 1000)}`;
}
