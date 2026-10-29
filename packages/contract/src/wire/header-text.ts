import type { Issue } from '../written/index.ts';
import { isTextValue, textOfValue } from './text.ts';
import { textTravel } from './text-travel.ts';

/** The parts whose headers travel: an Input's, a Success's or a Rejection's. */
type HeaderPart = 'success.headers' | 'input.headers' | 'headers';

/** Headers as they travel: each as text, or every one that cannot travel, as Issues at its part. */
export type HeaderTexts<Part extends HeaderPart> =
  | { readonly kind: 'texts'; readonly texts: readonly (readonly [string, string])[] }
  | { readonly kind: 'issues'; readonly issues: readonly (Issue & { readonly part: Part })[] };

/**
 * The headers of a Success, a Rejection or an Input as they travel, each value as its text; one left
 * `undefined` is not sent, and one that cannot travel is an Issue at its part, by its name.
 */
export function headerTextsOf<Part extends HeaderPart>(
  part: Part,
  headers: Readonly<Record<string, unknown>> | undefined,
): HeaderTexts<Part> {
  const texts: (readonly [string, string])[] = [];
  const issues: (Issue & { readonly part: Part })[] = [];
  for (const [name, value] of Object.entries(headers ?? {})) {
    const text = isTextValue(value) ? textOfValue(value) : undefined;
    if (text !== undefined && textTravel.headers.isCarried(text)) {
      texts.push([name, text]);
    } else if (value !== undefined) {
      issues.push(headerIssueOf(part, name));
    }
  }
  return issues.length > 0 ? { kind: 'issues', issues } : { kind: 'texts', texts };
}

function headerIssueOf<Part extends HeaderPart>(
  part: Part,
  name: string,
): Issue & { readonly part: Part } {
  const message = `The header value cannot travel as ${textTravel.headers.travelsAs}`;
  return { part, path: [name], code: 'invalid_format', message };
}
