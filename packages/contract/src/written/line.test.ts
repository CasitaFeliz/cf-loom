import { describe, expect, test } from 'vitest';
import { growthOf } from '../../test/growth.ts';
import { lineBreaksIn, linePool } from '../../test/line-breaks.ts';
import { unbrokenLineOf } from '../internal/index.ts';

/** How much longer writing a line may take at ten times the line breaks: three times the growth of the size. */
const linearGrowth = 30;

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

  test('a line already written on one line is unchanged when written again', () => {
    const pool = linePool();

    const changed = pool.filter(
      (text) => unbrokenLineOf(unbrokenLineOf(text)) !== unbrokenLineOf(text),
    );

    expect(changed).toEqual([]);
  });

  test('writing a line takes time that grows as its line breaks do', () => {
    const count = 100_000;
    const written = (size: number) => {
      const text = 'a\n'.repeat(size);
      return () => unbrokenLineOf(text);
    };

    const growth = growthOf(written, { small: count / 10, large: count }, linearGrowth);

    expect(growth).toBeLessThan(linearGrowth);
    expect(unbrokenLineOf('a\n'.repeat(count))).toBe('a\\n'.repeat(count));
  });

  test('the texts a line is written from hold each line break, CR LF, a lone surrogate and the names every object has', () => {
    const pool = linePool();

    for (const [_, code] of lineBreaks) {
      expect(pool).toContain(String.fromCharCode(code));
      expect(pool).toContain(`a${String.fromCharCode(code)}b`);
    }
    expect(pool).toContain(String.fromCharCode(0x0d, 0x0a));
    expect(pool).toContain('\\n');
    expect(pool).toContain('__proto__');
    expect(pool).toContain('constructor');
    expect(pool).toContain('toString');
    expect(pool.some((text) => text.length > 0 && lineBreaksIn(text) === 0)).toBe(true);
    expect(pool.some((text) => text.includes(String.fromCharCode(0xd800)))).toBe(true);
  });

  test('every text of the pool is written with no line break, and one with none as it is', () => {
    const pool = linePool();

    const broken = pool.filter((text) => lineBreaksIn(unbrokenLineOf(text)) > 0);
    const changed = pool.filter(
      (text) => lineBreaksIn(text) === 0 && unbrokenLineOf(text) !== text,
    );

    expect(broken).toEqual([]);
    expect(changed).toEqual([]);
  });
});
