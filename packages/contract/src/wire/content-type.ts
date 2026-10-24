/** The media type of every body cf-loom sends and reads. */
export const jsonMediaType = 'application/json';

/** The one content type bodies travel with. */
export const jsonContentType = `${jsonMediaType}; charset=utf-8`;

/** Whether a request's content type names JSON by its media type, whatever its parameters. */
export function isJsonContentType(contentType: string | null): boolean {
  const mediaType = contentType?.split(';')[0]?.trim().toLowerCase();
  return mediaType === jsonMediaType;
}
