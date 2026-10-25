import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { moveFiles } from './index.ts';

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

/** A folder holding the files given, by name and text. */
function aFolder(files: Readonly<Record<string, string>>): string {
  const folder = mkdtempSync(join(tmpdir(), 'cf-loom-moving-'));
  folders.push(folder);
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(folder, name), text);
  }
  return folder;
}

describe('moveFiles', () => {
  test('a path one file leaves can be the path another takes', () => {
    const folder = aFolder({ a: 'A', b: 'B' });

    const moved = moveFiles(folder, [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'a' },
    ]);

    expect(moved.kind).toBe('moved');
    expect(readFileSync(join(folder, 'a'), 'utf8')).toBe('B');
    expect(readFileSync(join(folder, 'b'), 'utf8')).toBe('A');
  });

  test('a move that fails after another landed puts every file back, over none', () => {
    const folder = aFolder({ a: 'A', c: 'C', d: 'D', e: 'E' });

    const moved = moveFiles(folder, [
      { from: 'a', to: 'b' },
      { from: 'c', to: 'a' },
      { from: 'd', to: 'e' },
    ]);

    expect(moved).toMatchObject({ kind: 'failed' });
    expect(readFileSync(join(folder, 'a'), 'utf8')).toBe('A');
    expect(readFileSync(join(folder, 'c'), 'utf8')).toBe('C');
    expect(readFileSync(join(folder, 'd'), 'utf8')).toBe('D');
    expect(readFileSync(join(folder, 'e'), 'utf8')).toBe('E');
    expect(readdirSync(folder).sort()).toEqual(['a', 'c', 'd', 'e']);
  });

  test('a failure names the move, not the file it set aside', () => {
    const folder = aFolder({ a: 'A', e: 'E', d: 'D' });

    const moved = moveFiles(folder, [{ from: 'd', to: 'e' }]);

    expect(moved).toEqual({
      kind: 'failed',
      message: 'd cannot be moved to e: a file is already there',
    });
  });
});
