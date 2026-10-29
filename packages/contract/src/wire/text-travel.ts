import type { TextIn } from '../written/index.ts';
import { isHeaderText } from './field-text.ts';
import { isQueryText, isSegmentText } from './url-text.ts';

/**
 * What each text part carries: whether a text can travel in it, as the runtime sends it, and the
 * words every message that refuses a text names it by.
 */
export const textTravel: Readonly<
  Record<TextIn, { readonly isCarried: (text: string) => boolean; readonly travelsAs: string }>
> = {
  params: { isCarried: isSegmentText, travelsAs: 'a URL segment' },
  query: { isCarried: isQueryText, travelsAs: 'URL text' },
  headers: { isCarried: isHeaderText, travelsAs: 'HTTP field text' },
};
