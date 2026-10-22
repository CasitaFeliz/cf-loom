import { stripVTControlCharacters } from 'node:util';

const urlCredentials = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/?#]*@/gi;

/** The first line of a text, without the white space around it. */
export function firstLineOf(text: string): string {
  return text.trim().split('\n', 1)[0] ?? '';
}

/**
 * A text on one line, without the ANSI sequences and control characters npm or a registry may
 * print, and without the user and password of a URL in it.
 */
export function lineOf(text: string): string {
  return stripVTControlCharacters(text)
    .replace(urlCredentials, '$1')
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
