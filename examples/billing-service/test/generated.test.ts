import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const serviceDir = join(import.meta.dirname, '..');
const bin = join(serviceDir, 'node_modules/@casitafeliz/loom-cli/dist/bin.js');

describe('the committed generated files', () => {
  test('cf-loom verify finds them up to date', () => {
    const verified = spawnSync(process.execPath, [bin, 'verify'], {
      cwd: serviceDir,
      encoding: 'utf8',
    });

    expect({ status: verified.status, stderr: verified.stderr }).toEqual({ status: 0, stderr: '' });
  });
});
