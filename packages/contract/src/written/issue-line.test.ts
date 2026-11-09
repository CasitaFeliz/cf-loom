import { describe, expect, test } from 'vitest';
import { orderOf, orders } from '../../test/growth.ts';
import { lineBreaks, lineBreaksIn } from '../../test/line-breaks.ts';
import { seededNext } from '../../test/random-schemas.ts';
import type { Issue } from '../index.ts';
import { issueLineOf, listedIssueLinesOf, unbrokenLineOf } from '../internal/index.ts';

const source = 'notifyOnCreated orders-service.event.OrderCreated.v1 m-1 f-1 attempt 1';

function anIssue(overrides: Partial<Issue> = {}): Issue {
  return { part: 'body', path: [], code: 'invalid_type', message: 'Expected string', ...overrides };
}

/** The bytes the console writes for these lines: their UTF-8, and a line break after each. */
function totalBytesOf(lines: readonly string[]): number {
  let total = 0;
  for (const line of lines) {
    total += Buffer.byteLength(line) + 1;
  }
  return total;
}

/** Each Issue's line as the console writes it, on one line: the oracle the lines are checked against. */
function linesOf(issues: readonly Issue[], sourceText = source): readonly string[] {
  return issues.map((issue) => unbrokenLineOf(issueLineOf(sourceText, issue)));
}

describe('issueLineOf', () => {
  test('an Issue is written after its source, its part and path joined by dots, its code and its message', () => {
    const issue = {
      part: 'body',
      path: ['orderId'],
      code: 'invalid_format',
      message: 'Invalid UUID',
    } as const;

    const line = issueLineOf('orders', issue);

    expect(line).toBe('orders: body.orderId invalid_format: Invalid UUID');
  });

  test('an Issue at the part itself is written with no path', () => {
    const issue = { part: 'body', path: [], code: 'required', message: 'Required' } as const;

    const line = issueLineOf('orders', issue);

    expect(line).toBe('orders: body required: Required');
  });
});

describe('listedIssueLinesOf: the count and the order', () => {
  test.for([0, 1, 100])(
    'the Issues of a Fault are one line each, in order, with no count line when all %i are listed',
    (count) => {
      const issues = Array.from({ length: count }, (_, index) => anIssue({ path: [index] }));

      const lines = listedIssueLinesOf(source, issues);

      expect(lines).toEqual(linesOf(issues));
    },
  );

  test.for([
    [101, '1 more Issue'],
    [102, '2 more Issues'],
  ] as const)('%i Issues list the first 100 and end with the line %s', ([count, counted]) => {
    const issues = Array.from({ length: count }, (_, index) => anIssue({ path: [index] }));

    const lines = listedIssueLinesOf(source, issues);

    expect(lines).toHaveLength(101);
    expect(lines.slice(0, 100)).toEqual(linesOf(issues.slice(0, 100)));
    expect(lines[100]).toBe(`${source}: ${counted}`);
  });
});

/** The Issue whose line, with its line break, brings the lines of `before` and itself to exactly `bytes`. */
function anIssueFilling(bytes: number, before: readonly Issue[], character = 'k'): Issue {
  const bare = anIssue({ message: '' });
  const room = bytes - totalBytesOf(linesOf([...before, bare]));
  const characterBytes = Buffer.byteLength(character);
  const message = character.repeat(Math.floor(room / characterBytes));
  return anIssue({ message: `${message}${'k'.repeat(room % characterBytes)}` });
}

describe('listedIssueLinesOf: the size', () => {
  test('lines filling exactly 64 KiB are all listed', () => {
    const first = anIssue({ path: [0] });
    const issues = [first, anIssueFilling(65_536, [first])];

    const lines = listedIssueLinesOf(source, issues);

    expect(lines).toEqual(linesOf(issues));
    expect(totalBytesOf(lines)).toBe(65_536);
  });

  test('lines that would take one byte more than 64 KiB leave the last Issue counted, not listed', () => {
    const first = anIssue({ path: [0] });
    const issues = [first, anIssueFilling(65_537, [first])];

    const lines = listedIssueLinesOf(source, issues);

    expect(lines).toEqual([...linesOf([first]), `${source}: 1 more Issue`]);
  });

  test('an Issue whose line would take the lines past 64 KiB is counted, and so is every Issue after it, a short one included', () => {
    const first = anIssue({ path: [0] });
    const issues = [first, anIssue({ path: ['k'.repeat(65_536)] }), anIssue({ path: [2] })];

    const lines = listedIssueLinesOf(source, issues);

    expect(lines).toEqual([...linesOf([first]), `${source}: 2 more Issues`]);
  });

  test('one Issue whose line is larger than 64 KiB alone lists none and counts it', () => {
    const issues = [anIssue({ path: ['k'.repeat(70_000)] })];

    const lines = listedIssueLinesOf(source, issues);

    expect(lines).toEqual([`${source}: 1 more Issue`]);
  });

  test.for([
    ['a multi-byte character', '€'],
    ['a lone surrogate, which a console writes as the three bytes of U+FFFD', '\ud800'],
  ] as const)('the size counts the UTF-8 bytes of the line, %s included', ([, character]) => {
    const fits = anIssueFilling(65_536, [], character);
    const passes = anIssue({ message: `${fits.message}${character}` });

    const counted = [listedIssueLinesOf(source, [fits]), listedIssueLinesOf(source, [passes])];

    expect(counted).toEqual([linesOf([fits]), [`${source}: 1 more Issue`]]);
  });

  test('the size counts a line as written: a line break in a key takes the two characters of its escape', () => {
    const fixed = Buffer.byteLength(`${source}: body.a\\nb invalid_type: `) + 1;
    const fits = anIssue({ path: ['a\nb'], message: 'k'.repeat(65_536 - fixed) });
    const passes = anIssue({ path: ['a\nb'], message: 'k'.repeat(65_537 - fixed) });

    const counted = [listedIssueLinesOf(source, [fits]), listedIssueLinesOf(source, [passes])];

    expect(counted.map((lines) => lines.length)).toEqual([1, 1]);
    expect(totalBytesOf(counted[0] ?? [])).toBe(65_536);
    expect(counted[1]).toEqual([`${source}: 1 more Issue`]);
  });
});

describe('listedIssueLinesOf: a line stays a line', () => {
  test.for(lineBreaks)(
    'a key holding %s is listed on one line, as the visible text of its escape',
    ([, code, visible]) => {
      const issue = anIssue({ path: [`a${String.fromCharCode(code)}b`] });

      const lines = listedIssueLinesOf(source, [issue]);

      expect(lines).toEqual([`${source}: body.a${visible}b invalid_type: Expected string`]);
      expect(lineBreaksIn(lines.join(''))).toBe(0);
    },
  );

  test.for(lineBreaks)(
    'a source holding %s leaves a count line on one line, as the visible text of its escape',
    ([, code, visible]) => {
      const sourceWithBreak = `a${String.fromCharCode(code)}b`;
      const issues = [anIssue({ path: ['k'.repeat(70_000)] })];

      const lines = listedIssueLinesOf(sourceWithBreak, issues);

      expect(lines).toEqual([`a${visible}b: 1 more Issue`]);
    },
  );
});

describe('listedIssueLinesOf: a source too long, a path too deep, a count too large', () => {
  test('a source too long for any line leaves only the count line', () => {
    const longSource = 'f'.repeat(70_000);
    const issues = Array.from({ length: 3 }, (_, index) => anIssue({ path: [index] }));

    const lines = listedIssueLinesOf(longSource, issues);

    expect(lines).toEqual([`${longSource}: 3 more Issues`]);
  });

  test('a path of 1,000 segments is listed as one line', () => {
    const deep = anIssue({ path: Array.from({ length: 1_000 }, (_, index) => index) });

    const lines = listedIssueLinesOf(source, [deep]);

    expect(lines).toEqual(linesOf([deep]));
  });

  test('telling a Fault’s Issues takes time flat in their count', () => {
    const small = 10_000;
    const large = 100_000;
    const lists = new Map(
      [small, large].map((count) => [
        count,
        Array.from({ length: count }, (_, index) => anIssue({ path: [index] })),
      ]),
    );
    const told = (count: number) => {
      const issues = lists.get(count) ?? [];
      return () => listedIssueLinesOf(source, issues);
    };

    const order = orderOf(told, { small, large }, orders.flat);

    expect(order).toBeLessThan(orders.flat);
    expect(listedIssueLinesOf(source, lists.get(large) ?? [])).toHaveLength(101);
  });
});

/** The characters a drawn text is made of: ordinary, multi-byte, a lone surrogate, CR LF and each line break. */
const textCharacters = [
  ...['k', 'é', '€', '😀', '\ud800', '"', '\\', '.', String.fromCharCode(0x0d, 0x0a)],
  ...lineBreaks.map(([, code]) => String.fromCharCode(code)),
];

const keyNames = ['__proto__', 'constructor', 'toString'];

const keyLengthScales = [0, 100, 1_000, 40_000];

function randomText(next: () => number, length: number): string {
  const chunk = Array.from(
    { length: 1 + Math.floor(next() * 8) },
    () => textCharacters[Math.floor(next() * textCharacters.length)] ?? 'k',
  ).join('');
  return chunk.repeat(Math.ceil(length / chunk.length)).slice(0, length);
}

function randomKey(next: () => number, longestKey: number): string {
  if (next() < 0.1) {
    return keyNames[Math.floor(next() * keyNames.length)] ?? '';
  }
  return randomText(next, Math.floor(next() ** 2 * longestKey));
}

function randomPath(next: () => number, longestKey: number): readonly (string | number)[] {
  const segments = Math.floor(next() * 6);
  return Array.from({ length: segments }, () =>
    next() < 0.3 ? Math.floor(next() * 1000) : randomKey(next, longestKey),
  );
}

/** Up to 300 Issues, or up to 20 when their keys may be 1,000 characters or more, so the oracle stays fast. */
function randomIssues(next: () => number): readonly Issue[] {
  const longestKey = keyLengthScales[Math.floor(next() * keyLengthScales.length)] ?? 0;
  const most = longestKey >= 1_000 ? 20 : 300;
  const count = Math.floor(next() * (most + 1));
  return Array.from({ length: count }, () => anIssue({ path: randomPath(next, longestKey) }));
}

function randomSource(next: () => number): string {
  return randomText(next, Math.floor(next() ** 3 * 2_000));
}

/** Whether the lines hold each invariant of a Fault’s Issues told as lines, for the Issues they were written from. */
function invariantsOf(lines: readonly string[], sourceText: string, issues: readonly Issue[]) {
  const written = linesOf(issues, sourceText);
  let listed = 0;
  while (listed < lines.length && lines[listed] === written[listed]) {
    listed++;
  }
  const omitted = issues.length - listed;
  const countLine = unbrokenLineOf(
    `${sourceText}: ${omitted} more Issue${omitted === 1 ? '' : 's'}`,
  );
  return {
    withinCount: listed <= 100,
    withinBytes: totalBytesOf(written.slice(0, listed)) <= 65_536,
    stopsAtFirstMisfit:
      listed === issues.length ||
      listed === 100 ||
      totalBytesOf(written.slice(0, listed + 1)) > 65_536,
    countsTheRestOnce: lines.slice(listed).join('|') === (omitted === 0 ? '' : countLine),
  };
}

const heldInvariants = {
  withinCount: true,
  withinBytes: true,
  stopsAtFirstMisfit: true,
  countsTheRestOnce: true,
};

describe('listedIssueLinesOf: any Issues and source', () => {
  test.for([17, 2026, 4099, 65_537, 99_991, 271_828, 314_159, 1_000_003])(
    'seed %i: a prefix of their lines within 100 and 64 KiB of UTF-8, the rest counted',
    (seed) => {
      const next = seededNext(seed);
      const cases = Array.from({ length: 12 }, () => ({
        sourceText: randomSource(next),
        issues: randomIssues(next),
      }));

      const invariants = cases.map(({ sourceText, issues }) =>
        invariantsOf(listedIssueLinesOf(sourceText, issues), sourceText, issues),
      );

      expect(invariants).toEqual(cases.map(() => heldInvariants));
    },
  );
});
