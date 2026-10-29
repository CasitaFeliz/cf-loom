import type { TextIn } from '../written/index.ts';

/** What each text part's text travels as, in the words every message that refuses a text uses. */
export const textTravelsAs: Readonly<Record<TextIn, string>> = {
  params: 'a URL segment',
  query: 'URL text',
  headers: 'HTTP field text',
};
