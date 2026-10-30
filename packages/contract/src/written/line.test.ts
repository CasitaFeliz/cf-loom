import { describe, expect, test } from 'vitest';
import { unbrokenLineOf } from '../internal/index.ts';

const lineBreaks = [
  ['CR', 0x0d, '\\r'],
  ['LF', 0x0a, '\\n'],
  ['U+0085', 0x85, '\\u0085'],
  ['U+2028', 0x2028, '\\u2028'],
  ['U+2029', 0x2029, '\\u2029'],
  ['U+000B', 0x0b, '\\u000b'],
  ['U+000C', 0x0c, '\\u000c'],
  ['U+001C', 0x1c, '\\u001c'],
  ['U+001D', 0x1d, '\\u001d'],
  ['U+001E', 0x1e, '\\u001e'],
] as const;

describe('unbrokenLineOf', () => {
  test.for(lineBreaks)(
    'writes %s between letters as the visible text of its escape',
    ([_, code, visible]) => {
      const text = `a${String.fromCharCode(code)}b`;

      const line = unbrokenLineOf(text);

      expect(line).toBe(`a${visible}b`);
    },
  );

  test('writes CR LF as the escape of each, a tab, a backslash and a quote as they are', () => {
    const text = `a${String.fromCharCode(0x0d, 0x0a)}b\t\\n"c`;

    const line = unbrokenLineOf(text);

    expect(line).toBe('a\\r\\nb\t\\n"c');
  });
});
