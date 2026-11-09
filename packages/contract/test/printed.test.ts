import { Console } from 'node:console';
import { Writable } from 'node:stream';
import { describe, expect, test } from 'vitest';
import { linePool } from './line-pool.ts';
import { type ConsoleMethod, consoleMethods, printedBy, throwingConsole } from './printed.ts';

const stderrMethods: readonly ConsoleMethod[] = ['error', 'warn'];

const specifiers = ['%s', '%d', '%i', '%f', '%j', '%o', '%O', '%c', '%%'];

const lines = [
  ...linePool(),
  ...specifiers,
  ...specifiers.map((specifier) => `card ${specifier} declined`),
];

/** What a line carries beside it: none, an undefined cause, an Error, a string and a nested object. */
const causes: readonly (readonly unknown[])[] = [
  [],
  [undefined],
  [new Error('boom')],
  ['a cause that is a string'],
  [{ attempt: 1, nested: { failed: true, steps: ['connect', 'send'] } }],
];

/** What Node's console writes for each call's arguments, to a stream that is not a terminal. */
function writtenFor(method: ConsoleMethod, calls: readonly (readonly unknown[])[]): string {
  const written: string[] = [];
  const stream = new Writable({
    decodeStrings: false,
    write(chunk: string, _encoding, done) {
      written.push(chunk);
      done();
    },
  });
  const nodeConsole = new Console({ stdout: stream, stderr: stream });
  for (const args of calls) {
    nodeConsole[method](...args);
  }
  return written.join('');
}

/** What `printedBy` keeps for each call's arguments, from the same console `method`. */
function printedFor(method: ConsoleMethod, calls: readonly (readonly unknown[])[]): string {
  const printed = printedBy(method);
  for (const args of calls) {
    console[method](...args);
  }
  return printed.map((text) => `${text}\n`).join('');
}

describe('printedBy', () => {
  test("what a console method prints after printedBy is what Node's console writes, call by call, for every line alone", () => {
    const calls = lines.map((line) => [line]);

    const printed = consoleMethods.map((method) => printedFor(method, calls));

    expect(printed).toEqual(consoleMethods.map((method) => writtenFor(method, calls)));
  });

  test("a line with a cause, an Error, a string, an object or undefined, is printed as Node's console prints it", () => {
    const calls = lines.flatMap((line) =>
      causes.flatMap((cause) => [
        ['%s', line, ...cause],
        [line, ...cause],
      ]),
    );

    const printed = stderrMethods.map((method) => printedFor(method, calls));

    expect(printed).toEqual(stderrMethods.map((method) => writtenFor(method, calls)));
  });

  test('a cause changed after the call is printed as it was when the call was made', () => {
    const failure = Object.assign(new Error('boom'), { code: 'E_FIRST' });
    const attempt = { number: 1 };
    const calls = [
      ['%s', 'a line', failure],
      ['%s', 'another line', attempt],
    ];
    const printed = printedBy('error');
    const written = writtenFor('error', calls);

    for (const args of calls) {
      console.error(...args);
    }
    failure.code = 'E_SECOND';
    attempt.number = 2;

    expect(printed.map((text) => `${text}\n`).join('')).toEqual(written);
  });
});

describe('throwingConsole', () => {
  test('every call of the method throws the error given', () => {
    const broken = new Error('the console is closed');
    throwingConsole('error', broken);

    const thrown = ['a line', 'another line'].map((line) => {
      try {
        console.error('%s', line);
        return undefined;
      } catch (error) {
        return error;
      }
    });

    expect(thrown.every((error) => error === broken)).toBe(true);
    expect(thrown).toHaveLength(2);
  });
});
