import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runProcess } from '../../../packages/messaging/test/test-process.ts';

const packageDir = join(import.meta.dirname, '..');
const bin = join(packageDir, 'node_modules/@cf-loom/cli/dist/bin.js');

describe('the committed generated files', () => {
  test('cf-loom verify finds contract.snapshot.json up to date', async () => {
    const verified = await runProcess(process.execPath, [bin, 'verify'], { cwd: packageDir });

    expect({
      status: verified.status,
      stdout: verified.stdout,
      stderr: verified.stderr,
    }).toEqual({ status: 0, stdout: 'contract.snapshot.json is up to date\n', stderr: '' });
  });
});
