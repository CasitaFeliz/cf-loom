import type { Issue } from '../validation/index.ts';

/** A value a text part or a Success header holds: a string, a number or a boolean. */
export type TextValue = string | number | boolean;

/** A Success's headers as they travel: each as text, or every one that cannot travel, as Issues. */
export type SuccessHeaderTexts =
  | { readonly kind: 'texts'; readonly texts: readonly (readonly [string, string])[] }
  | { readonly kind: 'issues'; readonly issues: readonly Issue[] };

/** A value as the text it travels in, as a Success header: a number or boolean as JavaScript writes it. */
export function textOfValue(value: TextValue): string {
  return String(value);
}

/** Whether a value is one a text part or a Success header holds. */
export function isTextValue(value: unknown): value is TextValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

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
 * The headers of a Success as they travel, each value as its text; one left `undefined` is not
 * sent, and one that cannot travel is an Issue at `success.headers`, by its name.
 */
export function successHeaderTextsOf(
  headers: Readonly<Record<string, unknown>> | undefined,
): SuccessHeaderTexts {
  const texts: (readonly [string, string])[] = [];
  const issues: Issue[] = [];
  for (const [name, value] of Object.entries(headers ?? {})) {
    const text = isTextValue(value) ? textOfValue(value) : undefined;
    if (text !== undefined && isHeaderText(text)) {
      texts.push([name, text]);
    } else if (value !== undefined) {
      issues.push(headerIssueOf(name));
    }
  }
  return issues.length > 0 ? { kind: 'issues', issues } : { kind: 'texts', texts };
}

function isFieldCode(code: number): boolean {
  return code === 0x09 || (code >= 0x20 && code <= 0x7e) || (code >= 0x80 && code <= 0xff);
}

function headerIssueOf(name: string): Issue {
  const message = 'The header value cannot travel as HTTP field text';
  return { part: 'success.headers', path: [name], code: 'invalid_format', message };
}
