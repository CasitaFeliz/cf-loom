import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { firstLineOf, lineOf } from './lines.ts';

const execFileAsync = promisify(execFile);
const timeoutMilliseconds = 10 * 60 * 1000;
const maxOutputBytes = 16 * 1024 * 1024;

/** A program to run with no shell, and what its messages call it. */
export type ChildCall = {
  readonly label: string;
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
};

/** A step that stopped, in one line without control characters. */
export type Failed = { readonly kind: 'failed'; readonly message: string };

/** A program that ran: what it printed when it exited, or the line saying a limit or a signal stopped it. */
export type ChildRan =
  | { readonly kind: 'exited'; readonly stdout: string }
  | {
      readonly kind: 'errored';
      readonly stdout: string;
      readonly stderr: string;
      readonly status: number;
    }
  | Failed;

/** How a program ended: it ran, or it could not be started. */
export type ChildEnded = ChildRan | { readonly kind: 'unrunnable'; readonly reason: string };

/**
 * Runs a program with no shell and says how it ended: a limit it passed, a signal that stopped it
 * and a failure to start are told apart from an exit status, each as one line.
 */
export async function ranChild(call: ChildCall): Promise<ChildEnded> {
  try {
    const { stdout } = await execFileAsync(call.file, [...call.args], {
      cwd: call.cwd,
      ...(call.env === undefined ? {} : { env: call.env }),
      shell: false,
      timeout: timeoutMilliseconds,
      maxBuffer: maxOutputBytes,
      windowsHide: true,
      encoding: 'utf8',
    });
    return { kind: 'exited', stdout };
  } catch (e) {
    return endedByError(call.label, e);
  }
}

/** The first line a program printed on the streams given, else its exit status. */
export function exitReasonOf(printed: readonly string[], status: number): string {
  const line = printed.map(firstLineOf).find((text) => text !== '');
  return line ?? `exit status ${status}`;
}

function endedByError(label: string, thrown: unknown): ChildEnded {
  const error = thrown instanceof Error ? thrown : new Error(String(thrown));
  const { code, killed, signal, stdout, stderr }: Readonly<Record<string, unknown>> = { ...error };
  if (typeof code === 'number') {
    return { kind: 'errored', stdout: textOf(stdout), stderr: textOf(stderr), status: code };
  }
  if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return failed(`${label} printed more than 16 MiB`);
  }
  if (killed === true) {
    return failed(`${label} did not finish within 10 minutes`);
  }
  if (typeof signal === 'string') {
    return failed(`${label} was stopped by ${signal}`);
  }
  return { kind: 'unrunnable', reason: lineOf(error.message) };
}

/** A failure as a value: a program's text can hold ANSI and line breaks, a message never does. */
export function failed(message: string): Failed {
  return { kind: 'failed', message: lineOf(message) };
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
