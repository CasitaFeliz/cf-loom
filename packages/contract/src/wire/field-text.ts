/**
 * Whether a text can travel as an HTTP header value: RFC 9110 field text, a tab, visible ASCII, a
 * space or U+0080 to U+00FF, with no whitespace leading or trailing, which a field value never keeps.
 */
export function isHeaderText(text: string): boolean {
  if (/^[\t ]|[\t ]$/.test(text)) {
    return false;
  }
  for (let index = 0; index < text.length; index += 1) {
    if (!isFieldCode(text.charCodeAt(index))) {
      return false;
    }
  }
  return true;
}

function isFieldCode(code: number): boolean {
  return code === 0x09 || (code >= 0x20 && code <= 0x7e) || (code >= 0x80 && code <= 0xff);
}
