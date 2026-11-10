import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inheritedPath } from './npm-environment.ts';
import { anNpmPathWith } from './stub-npm.ts';

/** A call the recording npm got: its arguments, and the SHA-512 (hex) of the file it was asked to `publish`. */
export type RecordedNpmCall = {
  readonly args: readonly string[];
  readonly publishedSha512: string | null;
};

/** An `npm` that records its calls, the PATH that finds it before the real one, and the variable it reads. */
export type RecordingNpm = {
  readonly path: string;
  readonly env: Readonly<Record<string, string>>;
  readonly calls: () => readonly RecordedNpmCall[];
};

/** The variable the recording npm reads: where it logs. */
const callsVariable = 'CF_LOOM_NPM_CALLS';

const script = [
  '#!/usr/bin/env node',
  "const { appendFileSync, readFileSync, statSync } = require('node:fs');",
  "const { createHash } = require('node:crypto');",
  "const { spawnSync } = require('node:child_process');",
  'const args = process.argv.slice(2);',
  "const file = args[0] === 'publish' ? args[1] : undefined;",
  'const isFile = file !== undefined && statSync(file).isFile();',
  'const bytes = isFile ? readFileSync(file) : undefined;',
  "const sha = bytes === undefined ? null : createHash('sha512').update(bytes).digest('hex');",
  `appendFileSync(process.env.${callsVariable}, JSON.stringify({ args, publishedSha512: sha }) + '\\n');`,
  `const real = { ...process.env, PATH: ${JSON.stringify(inheritedPath)} };`,
  "const ran = spawnSync('npm', args, { stdio: 'inherit', env: real });",
  'process.exit(ran.status ?? 1);',
].join('\n');

/** An `npm` in `folder` that appends each call to a log and then runs the npm the developer has. */
export function anNpmRecording(folder: string): RecordingNpm {
  const bin = join(folder, 'recording-npm');
  const log = join(folder, 'npm-calls.jsonl');
  mkdirSync(bin);
  const path = anNpmPathWith(bin, script);
  const calls = () =>
    existsSync(log)
      ? readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      : [];
  return { path, env: { [callsVariable]: log }, calls };
}
