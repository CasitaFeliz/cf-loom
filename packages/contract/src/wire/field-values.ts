/**
 * The values of an HTTP field as one field value, each after a comma but the first, as a field
 * given several times is combined (RFC 9110, section 5.3); empty for none, as an `Allow` that
 * lists no method is.
 */
export function fieldValueOf(values: readonly string[]): string {
  return values.join(', ');
}
