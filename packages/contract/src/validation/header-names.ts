import {
  headerCaseSentence,
  isReservedRequestHeaderName,
  isReservedResponseHeaderName,
} from '../declarations/index.ts';
import { inFields, type Place } from '../walker/index.ts';
import { isInputPart, type ObjectPart, type TextIn } from '../written/index.ts';
import { type DeclarationFailure, failure } from './failures.ts';

/** A lower-case RFC 9110 token: the only header names a Contract declares. */
const lowerCaseToken = /^[!#$%&'*+\-.^_`|~0-9a-z]+$/;

/** A header name in a headers part that is no lower-case token, or one another party owns; no other text part has names to judge. */
export function headerNameFailures(
  { at, part, textIn }: { readonly at: Place; readonly part: ObjectPart; readonly textIn: TextIn },
  name: string,
): readonly DeclarationFailure[] {
  if (textIn !== 'headers') {
    return [];
  }
  const message = headerNameMessageOf(name, part);
  return message === undefined ? [] : [failure(inFields(at, name), 'header-names', message)];
}

/** What is wrong with a header name: its case, its characters, or a name another party owns in its direction. */
function headerNameMessageOf(name: string, part: ObjectPart): string | undefined {
  if (name !== name.toLowerCase()) {
    return headerCaseSentence(name);
  }
  if (!lowerCaseToken.test(name)) {
    return `A header name is an RFC 9110 token: ${name}`;
  }
  return reservedHeaderMessageOf(name, part);
}

function reservedHeaderMessageOf(name: string, part: ObjectPart): string | undefined {
  if (isInputPart(part)) {
    return isReservedRequestHeaderName(name)
      ? `A request header the Fetch standard keeps for the user agent, or cf-loom owns, is reserved: ${name}`
      : undefined;
  }
  return isReservedResponseHeaderName(name)
    ? `A response header the host or cf-loom owns, or a browser hides, is reserved: ${name}`
    : undefined;
}
