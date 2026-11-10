import { isPlainObject, ownOf } from '@cf-loom/contract/internal';
import {
  type ChildRan,
  exitReasonOf,
  type Failed,
  failed,
  firstLineOf,
  lineOf,
  ranChild,
} from '../child-process/index.ts';

/** Where npm runs: the project's directory, where npm reads its configuration as for any command run there (in a member of a workspaces root, the root's `.npmrc` instead of the member's own), and the environment the organization's npm login lives in. */
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

/** npm's own refusal, from the `{ error }` it prints with `--json`; `printed` is its summary's first line as npm printed it, with the credentials of a URL in it, which `summary` leaves out. */
export type Refused = {
  readonly kind: 'refused';
  readonly code: string;
  readonly summary: string;
  readonly printed: string;
  readonly message: string;
};

/**
 * What one npm command prints with `--json` in every release `engines.npm` admits, read as one
 * value, and what that is, to say so when a print is not it. `read` gets nothing at all as
 * `undefined` and gives `undefined` for a print that is not the shape.
 */
export type NpmShape<Value> = {
  readonly expected: string;
  readonly read: (printed: unknown) => Value | undefined;
};

/** What npm prints in place of each part of its output it takes for a secret: a URL's password, an npm token, a UUID. */
export const redactionMark = '***';

/**
 * Whether npm could have printed `printed` for the text `known`: npm redacts everything it prints,
 * so each mark stands for any one or more characters it hid. The parts between the marks are
 * found one after the other, each as early as it can be, so a print with many marks is read in
 * time linear in its length.
 */
export function isPrintOf(printed: string, known: string): boolean {
  const [first = '', ...others] = printed.split(redactionMark);
  const last = others.pop();
  if (last === undefined) {
    return printed === known;
  }
  if (!known.startsWith(first) || !known.endsWith(last)) {
    return false;
  }
  let hidden = first.length;
  for (const part of others) {
    const found = known.indexOf(part, hidden + 1);
    if (found === -1) {
      return false;
    }
    hidden = found + part.length;
  }
  return hidden < known.length - last.length;
}

/** A JSON object npm printed. */
export type PrintedObject = Readonly<Record<string, unknown>>;

/** What npm printed as JSON, read as the shape its call expects, or why it was not. */
export type NpmJson<Value> = { readonly kind: 'json'; readonly value: Value } | Refused | Failed;

/**
 * Runs the npm on the place's PATH, with no shell, and reads its JSON as the shape given: a print
 * that is not that shape fails with the call, what it printed and what the shape expects.
 */
export async function jsonFromNpm<Value>(
  place: NpmPlace,
  call: NpmCall,
  shape: NpmShape<Value>,
): Promise<NpmJson<Value>> {
  const ended = await endedOf(place, call);
  switch (ended.kind) {
    case 'failed':
      return ended;
    case 'errored':
      return refusalOf(call, ended);
    case 'exited':
      return shapedOf(call, shape, jsonOf(call, ended.stdout));
  }
}

/**
 * Starts every npm call with its workspace selection reset: `--workspaces=null`, which beats the
 * setting from any source and is npm's own default, so npm still reads the configuration of the
 * project it finds, and `whoami` runs under any `workspaces` setting.
 */
async function endedOf(place: NpmPlace, call: NpmCall): Promise<ChildRan> {
  const ended = await ranChild({
    label: call.label,
    file: 'npm',
    args: [...call.args, '--json', '--no-update-notifier', '--workspaces=null'],
    cwd: place.directory,
    env: { ...place.env, ...call.env },
  });
  if (ended.kind === 'unrunnable') {
    const reason = `npm cannot be run: ${ended.reason}`;
    return failed(`${reason}: cf-loom reads the registry through npm, which must be on PATH`);
  }
  return ended;
}

/** `npm view <package> versions`: the versions it lists, none when npm prints nothing, as it does for a package with no latest dist-tag. */
export const viewedVersions: NpmShape<readonly string[]> = {
  expected: 'a list of versions',
  read: (printed) => (printed === undefined ? [] : textsOf(printed)),
};

/** `npm view <package> dist-tags`: each dist-tag and the version it points at. */
export const viewedDistTags: NpmShape<Readonly<Record<string, string>>> = {
  expected: 'a map of dist-tags',
  read: (printed) => {
    const tags = viewedOnce(printed);
    return isTextMap(tags) ? tags : undefined;
  },
};

/** `npm view <package>@<version> <fields>`: the fields of that one version. */
export const viewedFields: NpmShape<PrintedObject> = {
  expected: "one version's fields",
  read: (printed) => objectOf(viewedOnce(printed)),
};

/** `npm pack`: the report of the one package it packed, in an array of reports or keyed by package name. */
export const packedReport: NpmShape<PrintedObject> = {
  expected: 'the report of one packed package',
  read: (printed) => {
    const reports = typeof printed === 'object' && printed !== null ? Object.values(printed) : [];
    return reports.length === 1 ? objectOf(reports[0]) : undefined;
  },
};

/** `npm whoami`: the user name npm logs in as. */
export const userName: NpmShape<string> = {
  expected: 'a user name',
  read: (printed) => (typeof printed === 'string' ? printed : undefined),
};

/** A print the caller does not read, such as `npm publish`'s. */
export const anyPrint: NpmShape<null> = { expected: 'anything', read: () => null };

/** What `npm view` printed for one version, which npm prints bare or wraps in a list of one. */
function viewedOnce(printed: unknown): unknown {
  return Array.isArray(printed) && printed.length === 1 ? printed[0] : printed;
}

function objectOf(printed: unknown): PrintedObject | undefined {
  return isPlainObject(printed) ? printed : undefined;
}

function isText(printed: unknown): printed is string {
  return typeof printed === 'string';
}

function textsOf(printed: unknown): readonly string[] | undefined {
  return Array.isArray(printed) && printed.every(isText) ? printed : undefined;
}

function isTextMap(printed: unknown): printed is Readonly<Record<string, string>> {
  return isPlainObject(printed) && Object.values(printed).every(isText);
}

function shapedOf<Value>(
  call: NpmCall,
  shape: NpmShape<Value>,
  printed: { readonly kind: 'json'; readonly value: unknown } | Failed,
): NpmJson<Value> {
  if (printed.kind === 'failed') {
    return printed;
  }
  const value = shape.read(printed.value);
  if (value === undefined) {
    return failed(`${call.label} printed ${excerptOf(printed.value)}, not ${shape.expected}`);
  }
  return { kind: 'json', value };
}

const excerptLength = 60;

/** What npm printed in a failure's words: its JSON cut after 60 characters, never inside one, or `nothing`. */
function excerptOf(printed: unknown): string {
  if (printed === undefined) {
    return 'nothing';
  }
  const json = JSON.stringify(printed);
  const characters = Array.from(json.slice(0, 2 * excerptLength + 1));
  return characters.length > excerptLength
    ? `${characters.slice(0, excerptLength).join('')}…`
    : json;
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
  return {
    kind: 'refused',
    code: lineOf(code),
    summary: lineOf(summary),
    printed: summary,
    message,
  };
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
