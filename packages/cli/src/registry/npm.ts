import { execFile } from 'node:child_process';
import { promisify, stripVTControlCharacters } from 'node:util';
import { ownOf } from '@cf-loom/contract/internal';

const execFileAsync = promisify(execFile);
const npmTimeoutMilliseconds = 10 * 60 * 1000;
const maxStdoutBytes = 16 * 1024 * 1024;

/** Where npm runs: the project's directory, whose `.npmrc` npm reads, and the environment the organization's npm login lives in. */
export type NpmPlace = {
  readonly directory: string;
  readonly env: Readonly<Record<string, string | undefined>>;
};

/** A read that stopped, in one line without control characters. */
export type Failed = { readonly kind: 'failed'; readonly message: string };

/** One run of npm: what it is called in messages, its arguments, and the environment it adds to the place's. */
export type NpmCall = {
  readonly label: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
};

/** npm's own refusal, from the `{ error }` it prints with `--json`. */
export type Refused = {
  readonly kind: 'refused';
  readonly code: string;
  readonly summary: string;
  readonly message: string;
};

/** What npm printed as JSON, nothing at all being `undefined`, or why it did not. */
export type NpmJson = { readonly kind: 'json'; readonly value: unknown } | Refused | Failed;

/** What npm printed as text, or why it did not. */
export type NpmText = { readonly kind: 'text'; readonly text: string } | Failed;

type Ended =
  | { readonly kind: 'exited'; readonly stdout: string }
  | {
      readonly kind: 'errored';
      readonly stdout: string;
      readonly stderr: string;
      readonly status: number;
    }
  | Failed;

/** A failure as a value: npm's text can hold ANSI and line breaks, a message never does. */
export function failed(message: string): Failed {
  return { kind: 'failed', message: lineOf(message) };
}

/** Runs the npm on the place's PATH, with no shell, and reads its JSON. */
export async function jsonFromNpm(place: NpmPlace, call: NpmCall): Promise<NpmJson> {
  const ended = await endedOf(place, call);
  switch (ended.kind) {
    case 'failed':
      return ended;
    case 'errored':
      return refusalOf(call, ended);
    case 'exited':
      return jsonOf(call, ended.stdout);
  }
}

/** Runs the npm on the place's PATH, with no shell, and reads its text. */
export async function textFromNpm(place: NpmPlace, call: NpmCall): Promise<NpmText> {
  const ended = await endedOf(place, call);
  switch (ended.kind) {
    case 'failed':
      return ended;
    case 'errored':
      return failed(refusalOf(call, ended).message);
    case 'exited':
      return { kind: 'text', text: ended.stdout };
  }
}

async function endedOf(place: NpmPlace, call: NpmCall): Promise<Ended> {
  const args = [...call.args, '--json', '--no-update-notifier'];
  try {
    const { stdout } = await execFileAsync('npm', args, {
      cwd: place.directory,
      env: { ...place.env, ...call.env },
      shell: false,
      timeout: npmTimeoutMilliseconds,
      maxBuffer: maxStdoutBytes,
      windowsHide: true,
      encoding: 'utf8',
    });
    return { kind: 'exited', stdout };
  } catch (e) {
    return endedByError(call, e);
  }
}

function endedByError(call: NpmCall, thrown: unknown): Ended {
  const error = thrown instanceof Error ? thrown : new Error(String(thrown));
  const { code, killed, signal, stdout, stderr }: Readonly<Record<string, unknown>> = { ...error };
  if (typeof code === 'number') {
    return { kind: 'errored', stdout: textOf(stdout), stderr: textOf(stderr), status: code };
  }
  if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return failed(`${call.label} printed more than 16 MiB`);
  }
  if (killed === true) {
    return failed(`${call.label} did not finish within 10 minutes`);
  }
  if (typeof signal === 'string') {
    return failed(`${call.label} was stopped by ${signal}`);
  }
  return failed(
    `npm cannot be run: ${error.message}: cf-loom reads the registry through npm, which must be on PATH`,
  );
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function refusalOf(call: NpmCall, ended: Extract<Ended, { kind: 'errored' }>): Refused | Failed {
  const printed = jsonOf(call, ended.stdout);
  const error = printed.kind === 'json' ? errorOf(printed.value) : undefined;
  if (error === undefined) {
    const reason = firstLineOf(ended.stderr) || `exit status ${ended.status}`;
    return failed(`${call.label} failed: ${reason}`);
  }
  const { code, summary } = error;
  const message = lineOf(`${call.label} failed (${code}: ${summary})`);
  return { kind: 'refused', code: lineOf(code), summary: lineOf(summary), message };
}

function errorOf(printed: unknown): { code: string; summary: string } | undefined {
  const error = ownOf(printed, 'error');
  const code = ownOf(error, 'code');
  const summary = ownOf(error, 'summary');
  return typeof code === 'string' && typeof summary === 'string' ? { code, summary } : undefined;
}

function jsonOf(call: NpmCall, stdout: string): { kind: 'json'; value: unknown } | Failed {
  if (stdout.trim() === '') {
    return { kind: 'json', value: undefined };
  }
  try {
    return { kind: 'json', value: JSON.parse(stdout) };
  } catch {
    return failed(`${call.label} printed no JSON: ${firstLineOf(stdout)}`);
  }
}

function firstLineOf(text: string): string {
  return text.trim().split('\n', 1)[0] ?? '';
}

/** A text on one line, without the ANSI sequences and control characters npm or a registry may print. */
export function lineOf(text: string): string {
  return stripVTControlCharacters(text)
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
