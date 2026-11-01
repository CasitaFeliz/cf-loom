import { format, inspect } from 'node:util';
import { describe, expect, test } from 'vitest';
import { orderOf, orders } from '../../test/growth.ts';
import { lineBreaks, lineBreaksIn } from '../../test/line-breaks.ts';
import { linePool } from '../../test/line-pool.ts';
import { seededNext } from '../../test/random-schemas.ts';
import { linesTextOf, logOf, unbrokenLineOf } from '../internal/index.ts';

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

    const order = orderOf(written, { small: count / 10, large: count }, orders.linear);

    expect(order).toBeLessThan(orders.linear);
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

describe('linesTextOf', () => {
  test('writes each line on one line and joins them by LF, so a message has one line per problem', () => {
    const lines = ['first\nline', 'second', `third${String.fromCharCode(0x2028)}line`];

    const message = linesTextOf(lines);

    expect(message).toBe('first\\nline\nsecond\nthird\\u2028line');
  });

  test('a message of 1 to 5 lines of the pool splits at LF into those lines and has no other break', () => {
    const next = seededNext(5);
    const pool = linePool();
    const draw = (): string => pool[Math.floor(next() * pool.length)] ?? '';
    const lists = Array.from({ length: 200 }, () =>
      Array.from({ length: 1 + Math.floor(next() * 5) }, draw),
    );

    const wrong = lists.filter((lines) => {
      const message = linesTextOf(lines);
      const parts = message.split('\n');
      const isEachLine = parts.every((part, index) => part === unbrokenLineOf(lines[index] ?? ''));
      return !(
        isEachLine &&
        parts.length === lines.length &&
        lineBreaksIn(message) === lines.length - 1
      );
    });

    expect(wrong).toEqual([]);
  });
});

describe('logOf', () => {
  test('a line is logged on one line as a %s argument, then its cause, the same object, when it has one', () => {
    const cause = new Error('boom');
    const lines = linePool();

    const logged = lines.map((line) => logOf(line, cause));

    expect(logged).toEqual(lines.map((line) => ['%s', unbrokenLineOf(line), cause]));
    expect(logged.every((args) => args[2] === cause)).toBe(true);
  });

  test('a line holding console format specifiers is printed as it is, then its cause', () => {
    const cause = new Error('boom');
    const specifiers = ['%s', '%d', '%i', '%f', '%j', '%o', '%O', '%c', '%%'];
    const lines = specifiers.map((specifier) => `card ${specifier} declined`);

    const printed = lines.map((line) => format(...logOf(line, cause)));
    const alone = lines.map((line) => format(...logOf(line)));

    expect(printed).toEqual(lines.map((line) => `${line} ${inspect(cause)}`));
    expect(alone).toEqual(lines);
  });

  test('a line with no cause is logged alone, and one with an undefined cause too', () => {
    const lines = linePool();

    const alone = lines.map((line) => logOf(line));
    const undefinedCause = lines.map((line) => logOf(line, undefined));

    expect(alone).toEqual(lines.map((line) => [unbrokenLineOf(line)]));
    expect(undefinedCause).toEqual(alone);
  });
});
