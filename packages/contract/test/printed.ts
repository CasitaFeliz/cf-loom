import { format } from 'node:util';
import { vi } from 'vitest';

/** The console methods a test can silence and read. */
export const consoleMethods = ['debug', 'error', 'info', 'log', 'warn'] as const;

/** A console method a test silences and reads. */
export type ConsoleMethod = (typeof consoleMethods)[number];

/**
 * Silences `console[method]` and returns what it prints from then on: for each call, the text Node's
 * console writes for its arguments, read when the call is made, before its line break, uncolored as
 * on a pipe or a file. The one place a test spies on the console (C23).
 */
export function printedBy(method: ConsoleMethod): readonly string[] {
  const printed: string[] = [];
  vi.spyOn(console, method).mockImplementation((...args) => {
    printed.push(format(...args));
  });
  return printed;
}

/** Makes every call of `console[method]` throw `error`, for a test of what a library does when the console throws. */
export function throwingConsole(method: ConsoleMethod, error: unknown): void {
  vi.spyOn(console, method).mockImplementation(() => {
    throw error;
  });
}
