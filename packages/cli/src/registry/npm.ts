import { ownOf } from '@cf-loom/contract/internal';
import {
  type ChildRan,
  exitReasonOf,
  type Failed,
  failed,
  firstLineOf,
  lineOf,
  ranChild,
} from '../child-process/index.ts';

/** Where npm runs: the project's directory, whose `.npmrc` npm reads, and the environment the organization's npm login lives in. */
export type NpmPlace = {
  readonly directory: string;
  readonly env: Readonly<Record<string, string | undefined>>;
};

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

async function endedOf(place: NpmPlace, call: NpmCall): Promise<ChildRan> {
  const ended = await ranChild({
    label: call.label,
    file: 'npm',
    args: [...call.args, '--json', '--no-update-notifier'],
    cwd: place.directory,
    env: { ...place.env, ...call.env },
  });
  if (ended.kind === 'unrunnable') {
    const reason = `npm cannot be run: ${ended.reason}`;
    return failed(`${reason}: cf-loom reads the registry through npm, which must be on PATH`);
  }
  return ended;
}

function refusalOf(call: NpmCall, ended: Extract<ChildRan, { kind: 'errored' }>): Refused | Failed {
  const printed = jsonOf(call, ended.stdout);
  const error = printed.kind === 'json' ? errorOf(printed.value) : undefined;
  if (error === undefined) {
    const reason = exitReasonOf([ended.stderr], ended.status);
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
  return typeof code === 'string' && typeof summary === 'string'
    ? { code, summary: firstLineOf(summary) }
    : undefined;
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
