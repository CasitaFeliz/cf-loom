import type { Issue } from '../validation/index.ts';
import { isTextValue, textOfValue } from './text.ts';

/** Headers as they travel: each as text, or every one that cannot travel, as Issues. */
export type HeaderTexts =
  | { readonly kind: 'texts'; readonly texts: readonly (readonly [string, string])[] }
  | { readonly kind: 'issues'; readonly issues: readonly Issue[] };

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

/**
 * The headers of a Success or an Input as they travel, each value as its text; one left
 * `undefined` is not sent, and one that cannot travel is an Issue at its part, by its name.
 */
export function headerTextsOf(
  part: 'success.headers' | 'input.headers',
  headers: Readonly<Record<string, unknown>> | undefined,
): HeaderTexts {
  const texts: (readonly [string, string])[] = [];
  const issues: Issue[] = [];
  for (const [name, value] of Object.entries(headers ?? {})) {
    const text = isTextValue(value) ? textOfValue(value) : undefined;
    if (text !== undefined && isHeaderText(text)) {
      texts.push([name, text]);
    } else if (value !== undefined) {
      issues.push(headerIssueOf(part, name));
    }
  }
  return issues.length > 0 ? { kind: 'issues', issues } : { kind: 'texts', texts };
}

function isFieldCode(code: number): boolean {
  return code === 0x09 || (code >= 0x20 && code <= 0x7e) || (code >= 0x80 && code <= 0xff);
}

function headerIssueOf(part: 'success.headers' | 'input.headers', name: string): Issue {
  const message = 'The header value cannot travel as HTTP field text';
  return { part, path: [name], code: 'invalid_format', message };
}
