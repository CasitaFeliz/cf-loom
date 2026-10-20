import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const packageDir = join(import.meta.dirname, '..');
const bin = join(packageDir, 'node_modules/@cf-loom/cli/dist/bin.js');

describe('the committed generated files', () => {
  test('cf-loom verify finds contract.snapshot.json up to date', () => {
    const verified = spawnSync(process.execPath, [bin, 'verify'], {
      cwd: packageDir,
      encoding: 'utf8',
    });

    expect({
      status: verified.status,
      stdout: verified.stdout,
      stderr: verified.stderr,
    }).toEqual({ status: 0, stdout: 'contract.snapshot.json is up to date\n', stderr: '' });
  });
});
