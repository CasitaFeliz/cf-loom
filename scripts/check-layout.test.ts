import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { layoutViolations } from './check-layout.ts';

const manifest = {
  exports: {
    '.': { types: './dist/index.d.ts', default: './dist/index.js' },
    './internal': { types: './dist/internal/index.d.ts', default: './dist/internal/index.js' },
    './package.json': './package.json',
  },
  bin: { tool: './dist/bin.js' },
};

const wellLaidOut: Record<string, string> = {
  'package.json': JSON.stringify(manifest),
  'src/index.ts': "export { walk } from './walker/index.ts';\n",
  'src/readme.test.ts': "import { walk } from './index.ts';\n",
  'src/bin.ts': '#!/usr/bin/env node\nexport {};\n',
  'src/internal/index.ts': "export type { Node } from '../walker/index.ts';\nexport {};\n",
  'src/internal/index.test.ts': "import { walk } from '../internal/index.ts';\n",
  'src/walker/index.ts': "export { walk } from './walk.ts';\n",
  'src/walker/walk.ts': "import { isNode } from '../nodes/index.ts';\n",
  'src/walker/walk.test.ts': "import { walk } from '../index.ts';\n",
  'src/nodes/index.ts': "export { isNode } from './predicates.ts';\n",
  'src/nodes/predicates.ts': "import type { Node } from './node.ts';\n",
};

const packageDirs: string[] = [];

/** A package directory holding `files` over a well laid out package; `undefined` leaves a file out. */
function aPackage(files: Record<string, string | undefined> = {}): string {
  const packageDir = mkdtempSync(join(tmpdir(), 'check-layout-'));
  packageDirs.push(packageDir);
  for (const [path, source] of Object.entries({ ...wellLaidOut, ...files })) {
    if (source !== undefined) {
      mkdirSync(dirname(join(packageDir, path)), { recursive: true });
      writeFileSync(join(packageDir, path), source);
    }
  }
  return packageDir;
}

/** A package whose `package.json` holds `fields` over the well laid out package's manifest. */
function aPackageWithManifest(fields: Record<string, unknown>): string {
  return aPackage({ 'package.json': JSON.stringify({ ...manifest, ...fields }) });
}

/** A repository holding the check's scripts and one package, `packages/tool`, built as `aPackage` builds it. */
function aRepositoryWith(files: Record<string, string | undefined>): string {
  const repositoryDir = aPackage(files);
  const packageDir = join(repositoryDir, 'packages', 'tool');
  mkdirSync(packageDir, { recursive: true });
  for (const path of ['package.json', 'src']) {
    renameSync(join(repositoryDir, path), join(packageDir, path));
  }
  writeFileSync(join(repositoryDir, 'package.json'), JSON.stringify({ type: 'module' }));
  cpSync(import.meta.dirname, join(repositoryDir, 'scripts'), {
    recursive: true,
    filter: (path) => !path.endsWith('.test.ts'),
  });
  return repositoryDir;
}

afterEach(() => {
  for (const packageDir of packageDirs.splice(0)) {
    rmSync(packageDir, { recursive: true, force: true });
  }
});

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

    expect(violations).toEqual([{ path: 'src/predicates.ts', rule: 'not-an-entry' }]);
  });

  it('reports a file in an entry folder that is not its entry nor a test', () => {
    const packageDir = aPackage({ 'src/internal/kinds.ts': 'export type Kind = string;\n' });

    const violations = layoutViolations(packageDir);

    expect(violations).toEqual([{ path: 'src/internal/kinds.ts', rule: 'not-an-entry' }]);
  });

  it.each(['utils', 'common', 'shared', 'helpers'])('reports a module named %s', (name) => {
    const packageDir = aPackage({
      [`src/${name}/index.ts`]: "export { trim } from './trim.ts';\n",
    });

    const violations = layoutViolations(packageDir);

    expect(violations).toEqual([{ path: `src/${name}`, rule: 'grab-bag' }]);
  });

  it('reports a module nested in a module', () => {
    const packageDir = aPackage({ 'src/walker/scalars/index.ts': 'export {};\n' });

    const violations = layoutViolations(packageDir);

    expect(violations).toEqual([{ path: 'src/walker/scalars', rule: 'nested-module' }]);
  });

  it.each([
    ['a static import', "import { isNode } from '../nodes/predicates.ts';\n"],
    ['a side-effect import', "import '../nodes/predicates.ts';\n"],
    ['a dynamic import', "const nodes = await import('../nodes/predicates.ts');\n"],
    ['a type query', "type Nodes = typeof import('../nodes/predicates.ts');\n"],
  ])("reports %s of another module's file not through its index.ts", (_, source) => {
    const packageDir = aPackage({ 'src/walker/walk.ts': source });

    const violations = layoutViolations(packageDir);

    expect(violations).toEqual([{ path: 'src/walker/walk.ts', rule: 'past-the-index' }]);
  });

  it("reports a module's index named with .js", () => {
    const packageDir = aPackage({
      'src/walker/walk.ts': "import { isNode } from '../nodes/index.js';\n",
    });

    const violations = layoutViolations(packageDir);

    expect(violations).toEqual([{ path: 'src/walker/walk.ts', rule: 'past-the-index' }]);
  });

  it('ignores an import that is commented out', () => {
    const source = [
      "// import { isNode } from '../nodes/predicates.ts';",
      "/* import { isNode } from '../nodes/predicates.ts'; */",
      "import { isNode } from '../nodes/index.ts'; // not '../nodes/predicates.ts'",
    ].join('\n');
    const packageDir = aPackage({ 'src/walker/walk.ts': source });

    const violations = layoutViolations(packageDir);

    expect(violations).toEqual([]);
  });

  it.each([
    [
      'a glob',
      "const built = 'dist/*';\nimport { isNode } from '../nodes/predicates.ts';\n/** Why. */\n",
    ],
    [
      'a URL',
      "const home = 'https://example.com'; import { isNode } from '../nodes/predicates.ts';\n",
    ],
    [
      'a double-quoted glob',
      'const built = "dist/*";\nimport { isNode } from "../nodes/predicates.ts";\n/** Why. */\n',
    ],
  ])('reads an import after a string holding %s', (_, source) => {
    const packageDir = aPackage({ 'src/walker/walk.ts': source });

    const violations = layoutViolations(packageDir);

    expect(violations).toEqual([{ path: 'src/walker/walk.ts', rule: 'past-the-index' }]);
  });

  it("reports an entry that re-exports a module's file not through its index.ts", () => {
    const packageDir = aPackage({ 'src/index.ts': "export { walk } from './walker/walk.ts';\n" });

    const violations = layoutViolations(packageDir);

    expect(violations).toEqual([{ path: 'src/index.ts', rule: 'past-the-index' }]);
  });

  it('accepts named re-exports, with aliases and comments, and the empty export', () => {
    const source = [
      '/** The walker. */',
      "export { walk, walk as walkSchema } from './walker/index.ts'; // the API",
      "export type { Node as SchemaNode } from './nodes/index.ts';",
      "export { type Node, isNode as isSchemaNode } from './nodes/index.ts';",
      'export {};',
    ].join('\n');
    const packageDir = aPackage({ 'src/index.ts': source });

    const violations = layoutViolations(packageDir);

    expect(violations).toEqual([]);
  });

  it.each([
    ['a declaration', "/** Why. */\nexport type Kind = 'walker';\n"],
    ['an import', "import { walk } from './walker/index.ts';\nexport { walk };\n"],
    ['a local export', "export { walk } from './walker/index.ts';\nexport { local };\n"],
    ['an export of everything', "export * from './walker/index.ts';\n"],
  ])('reports an entry file holding %s', (_, source) => {
    const packageDir = aPackage({ 'src/internal/index.ts': source });

    const violations = layoutViolations(packageDir);

    expect(violations).toEqual([{ path: 'src/internal/index.ts', rule: 'not-only-re-exports' }]);
  });

  it('accepts a bin entry that calls the API', () => {
    const packageDir = aPackage({
      'src/bin.ts': "#!/usr/bin/env node\nimport { walk } from './index.ts';\n\nwalk();\n",
    });

    const violations = layoutViolations(packageDir);

    expect(violations).toEqual([]);
  });

  it('reads a bin written without its leading ./', () => {
    const packageDir = aPackageWithManifest({ bin: 'dist/bin.js' });

    const violations = layoutViolations(packageDir);

    expect(violations).toEqual([]);
  });

  it('reports an entry with no source file', () => {
    const packageDir = aPackage({ 'src/internal/index.ts': undefined });

    const violations = layoutViolations(packageDir);

    expect(violations).toEqual([{ path: 'src/internal/index.ts', rule: 'missing-entry' }]);
  });

  it('reports a wildcard export', () => {
    const packageDir = aPackageWithManifest({
      exports: { '.': './dist/index.js', './*': './dist/*.js' },
    });

    const violations = layoutViolations(packageDir);

    expect(violations).toEqual([{ path: 'package.json', rule: 'wildcard-export' }]);
  });

  it('reports every entry of a package with no src/', () => {
    const packageDir = aPackage(
      Object.fromEntries(Object.keys(wellLaidOut).map((path) => [path, undefined])),
    );
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify(manifest));

    const violations = layoutViolations(packageDir);

    expect(violations).toEqual([
      { path: 'src/bin.ts', rule: 'missing-entry' },
      { path: 'src/index.ts', rule: 'missing-entry' },
      { path: 'src/internal/index.ts', rule: 'missing-entry' },
    ]);
  });

  it('skips a folder with no package.json', () => {
    const packageDir = aPackage({ 'package.json': undefined });

    const violations = layoutViolations(packageDir);

    expect(violations).toEqual([]);
  });

  it('lists violations sorted by path', () => {
    const packageDir = aPackage({
      'src/zeta.ts': '',
      'src/alpha.ts': '',
      'src/utils/index.ts': '',
    });

    const violations = layoutViolations(packageDir);

    expect(violations.map((violation) => violation.path)).toEqual([
      'src/alpha.ts',
      'src/utils',
      'src/zeta.ts',
    ]);
  });
});

describe('node scripts/check-layout.ts', () => {
  it('names the file and the rule, and exits with status 1', () => {
    const repositoryDir = aRepositoryWith({ 'src/predicates.ts': 'export const one = 1;\n' });

    const run = spawnSync('node', ['scripts/check-layout.ts'], {
      cwd: repositoryDir,
      encoding: 'utf8',
    });

    expect({ status: run.status, stderr: run.stderr }).toEqual({
      status: 1,
      stderr:
        'packages/tool/src/predicates.ts layout: only entries and their tests sit in src/ and an entry folder; move it into a module.\n',
    });
  });
});
