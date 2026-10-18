import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { layoutViolations } from './check-layout.ts';

const manifest = JSON.stringify({
  exports: {
    '.': { types: './dist/index.d.ts', default: './dist/index.js' },
    './internal': { types: './dist/internal/index.d.ts', default: './dist/internal/index.js' },
  },
  bin: { tool: './dist/bin.js' },
});

const wellLaidOut: Record<string, string> = {
  'package.json': manifest,
  'src/index.ts': "export { walk } from './walker/index.ts';\n",
  'src/readme.test.ts': "import { walk } from './index.ts';\n",
  'src/bin.ts': "#!/usr/bin/env node\nimport { walk } from './index.ts';\n\nwalk();\n",
  'src/internal/index.ts': "export type { Node } from '../walker/index.ts';\nexport {};\n",
  'src/internal/index.test.ts': "import { walk } from '../internal/index.ts';\n",
  'src/walker/index.ts': "export { walk } from './walk.ts';\n",
  'src/walker/walk.ts': "import { isNode } from '../nodes/index.ts';\n",
  'src/walker/walk.test.ts': "import { walk } from '../index.ts';\n",
  'src/nodes/index.ts': "export { isNode } from './predicates.ts';\n",
  'src/nodes/predicates.ts': "import type { Node } from './node.ts';\n",
};

/** A package directory holding `files` over a well laid out package. */
function aPackage(files: Record<string, string> = {}): string {
  const packageDir = mkdtempSync(join(tmpdir(), 'check-layout-'));
  for (const [path, source] of Object.entries({ ...wellLaidOut, ...files })) {
    mkdirSync(dirname(join(packageDir, path)), { recursive: true });
    writeFileSync(join(packageDir, path), source);
  }
  return packageDir;
}

describe('layoutViolations', () => {
  it('accepts entries, their tests and modules imported through their index.ts', () => {
    const packageDir = aPackage();

    const violations = layoutViolations(packageDir);

    expect(violations).toEqual([]);
  });

  it('passes every package of this repository', () => {
    const packagesDir = join(import.meta.dirname, '..', 'packages');

    const violations = readdirSync(packagesDir).flatMap((name) =>
      layoutViolations(join(packagesDir, name)),
    );

    expect(violations).toEqual([]);
  });

  it('reports a file in src/ that is not an entry nor a test', () => {
    const packageDir = aPackage({ 'src/predicates.ts': 'export const one = 1;\n' });

    const violations = layoutViolations(packageDir);

    expect(violations).toEqual([{ path: 'src/predicates.ts', kind: 'not-an-entry' }]);
  });

  it('reports a file in an entry folder that is not its entry nor a test', () => {
    const packageDir = aPackage({ 'src/internal/kinds.ts': 'export type Kind = string;\n' });

    const violations = layoutViolations(packageDir);

    expect(violations).toEqual([{ path: 'src/internal/kinds.ts', kind: 'not-an-entry' }]);
  });

  it('reports a module with a grab-bag name', () => {
    const packageDir = aPackage({ 'src/utils/index.ts': "export { trim } from './trim.ts';\n" });

    const violations = layoutViolations(packageDir);

    expect(violations).toEqual([{ path: 'src/utils', kind: 'grab-bag' }]);
  });

  it('reports a module nested in a module', () => {
    const packageDir = aPackage({ 'src/walker/scalars/index.ts': 'export {};\n' });

    const violations = layoutViolations(packageDir);

    expect(violations).toEqual([{ path: 'src/walker/scalars', kind: 'nested-module' }]);
  });

  it("reports an import of another module's file not through its index.ts", () => {
    const packageDir = aPackage({
      'src/walker/walk.ts': "import { isNode } from '../nodes/predicates.ts';\n",
    });

    const violations = layoutViolations(packageDir);

    expect(violations).toEqual([{ path: 'src/walker/walk.ts', kind: 'past-the-index' }]);
  });

  it("reports an entry that re-exports a module's file not through its index.ts", () => {
    const packageDir = aPackage({
      'src/index.ts': "export { walk } from './walker/walk.ts';\n",
    });

    const violations = layoutViolations(packageDir);

    expect(violations).toEqual([{ path: 'src/index.ts', kind: 'past-the-index' }]);
  });

  it('reports an entry file holding more than re-exports', () => {
    const packageDir = aPackage({
      'src/internal/index.ts':
        "import type { Node } from '../walker/index.ts';\n\n/** Why. */\nexport type Kind = Node['kind'];\n",
    });

    const violations = layoutViolations(packageDir);

    expect(violations).toEqual([{ path: 'src/internal/index.ts', kind: 'not-only-re-exports' }]);
  });

  it('accepts a bin entry that calls the API', () => {
    const packageDir = aPackage({
      'src/bin.ts': "#!/usr/bin/env node\nimport { walk } from './index.ts';\n\nwalk();\n",
    });

    const violations = layoutViolations(packageDir);

    expect(violations).toEqual([]);
  });
});
