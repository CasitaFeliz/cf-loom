import { chmodSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { inheritedPath } from './npm-environment.ts';
import type { Lab } from './npm-lab.ts';

/** The lines that pass the call on to the npm the developer has. */
export const developersNpm = `PATH='${inheritedPath}'\nexport PATH\nnpm "$@"`;

/** The PATH that finds `script`, written as an executable `npm` in `folder`, before the npm the developer has. */
export function anNpmPathWith(folder: string, script: string): string {
  writeFileSync(join(folder, 'npm'), script);
  chmodSync(join(folder, 'npm'), 0o755);
  return `${folder}${delimiter}${inheritedPath}`;
}

/** The PATH that finds, first, an `npm` that runs the shell script `body`, a new folder of the lab holding it. */
export function aStubNpm(lab: Lab, body: string): string {
  return anNpmPathWith(lab.aFolder(), `#!/bin/sh\n${body}\n`);
}
