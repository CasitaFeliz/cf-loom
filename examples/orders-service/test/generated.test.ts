import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';

const serviceDir = join(import.meta.dirname, '..');
const bin = join(serviceDir, 'node_modules/@casitafeliz/loom-cli/dist/bin.js');
const outDir = mkdtempSync(join(tmpdir(), 'orders-contract-package-'));

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

function cfLoom(...args: string[]) {
  const ran = spawnSync(process.execPath, [bin, ...args], { cwd: serviceDir, encoding: 'utf8' });
  return { status: ran.status, stderr: ran.stderr };
}

/** Every file `cf-loom package` writes under `dir`, by its path, leaving out a build's and an install's. */
function filesOf(dir: string): Record<string, string> {
  const dirents = readdirSync(dir, { recursive: true, withFileTypes: true });
  const files: Record<string, string> = {};
  for (const dirent of dirents) {
    const path = relative(dir, join(dirent.parentPath, dirent.name));
    const isBuildOrInstall = path.startsWith('dist') || path.startsWith('node_modules');
    if (dirent.isFile() && !isBuildOrInstall) {
      files[path] = readFileSync(join(dir, path), 'utf8');
    }
  }
  return files;
}

describe('the committed generated files', () => {
  test('cf-loom verify finds them up to date', () => {
    const verified = cfLoom('verify');

    expect(verified).toEqual({ status: 0, stderr: '' });
  });

  test('cf-loom package writes exactly the committed Contract Package', () => {
    const packaged = cfLoom('package', '--out', outDir);

    expect(packaged).toEqual({ status: 0, stderr: '' });
    expect(filesOf(outDir)).toEqual(filesOf(join(serviceDir, 'contract-package')));
  });
});
