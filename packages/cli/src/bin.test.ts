import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const cliDir = join(import.meta.dirname, '..');
const bin = join(cliDir, 'src', 'bin.ts');
const cliVersion: string = JSON.parse(readFileSync(join(cliDir, 'package.json'), 'utf8')).version;
const projects: string[] = [];

afterEach(() => {
  for (const project of projects.splice(0)) {
    rmSync(project, { recursive: true, force: true });
  }
});

/** A project in a temporary directory, with cf-loom and zod installed and the files given. */
function aProject(files: Readonly<Record<string, string>> = {}, prefix = 'cf-loom-'): string {
  const project = mkdtempSync(join(tmpdir(), prefix));
  projects.push(project);
  link(join(cliDir, '..', 'contract'), join(project, 'node_modules/@casitafeliz/loom-contract'));
  link(cliDir, join(project, 'node_modules/@casitafeliz/loom-cli'));
  link(realpathSync(join(cliDir, 'node_modules/zod')), join(project, 'node_modules/zod'));
  const packageJson = JSON.stringify({ name: '@org/orders-service', type: 'module' });
  write(project, { 'package.json': packageJson, ...files });
  return project;
}

function link(target: string, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path, 'dir');
}

function write(project: string, files: Readonly<Record<string, string>>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(project, path)), { recursive: true });
    writeFileSync(join(project, path), text);
  }
}

function read(project: string, path: string): string {
  return readFileSync(join(project, path), 'utf8');
}

function cfLoom(project: string, ...args: string[]) {
  const ran = spawnSync(process.execPath, [bin, ...args], { cwd: project, encoding: 'utf8' });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

/** Root may write in any folder, so a permission test means nothing when run as root. */
const isRoot = process.getuid?.() === 0;

const usage =
  'Usage: cf-loom init [service | application | definitions] | generate | verify | package [--out <dir>]';

const config = [
  "import { defineConfig } from '@casitafeliz/loom-cli';",
  '',
  "export const config = defineConfig({ scope: '@org' });",
  '',
].join('\n');

function aRoot({
  lifecycle = 'active',
  body = 'z.object({ ok: z.boolean() })',
} = {}): Readonly<Record<string, string>> {
  return {
    'src/contract/ping.endpoint.ts': [
      "import { defineEndpoint } from '@casitafeliz/loom-contract';",
      "import { z } from 'zod';",
      '',
      'export const ping = defineEndpoint({',
      "  name: 'ping',",
      "  method: 'GET',",
      "  path: '/ping',",
      "  visibility: 'public',",
      "  description: 'Answers',",
      `  lifecycle: '${lifecycle}',`,
      `  success: { status: 200, body: ${body} },`,
      '});',
      '',
    ].join('\n'),
    'src/contract/index.ts': [
      "import { defineContract, defineGroup } from '@casitafeliz/loom-contract';",
      "import { ping } from './ping.endpoint.ts';",
      '',
      "const health = defineGroup({ name: 'health', description: 'Health', endpoints: [ping] });",
      '',
      "export const contract = defineContract({ name: 'orders-service', groups: [health] });",
      '',
    ].join('\n'),
  };
}

/** The Definitions Package `@org/definitions`, installed as built JavaScript under `at`. */
function installedDefinitions(
  at: string,
  manifest: Readonly<Record<string, unknown>> = { version: '4.2.0' },
): Readonly<Record<string, string>> {
  return {
    [`${at}/@org/definitions/package.json`]: JSON.stringify({
      name: '@org/definitions',
      type: 'module',
      exports: './index.js',
      ...manifest,
    }),
    [`${at}/@org/definitions/index.js`]: [
      "import { defineDefinitions, defineRejection } from '@casitafeliz/loom-contract';",
      "export const gone = defineRejection({ code: 'GONE', status: 410, message: 'Gone' });",
      'export const definitions = defineDefinitions({',
      "  name: 'definitions',",
      '  rejections: [gone],',
      "  standardRejections: { notFound: { code: 'MISSING', status: 404, message: 'Missing' } },",
      '});',
      '',
    ].join('\n'),
  };
}

/** Lists `@org/definitions` on the project's root. */
function listDefinitions(project: string): void {
  write(project, {
    'src/contract/index.ts': read(project, 'src/contract/index.ts')
      .replace(
        "import { ping } from './ping.endpoint.ts';",
        "import { ping } from './ping.endpoint.ts';\nimport { definitions } from '@org/definitions';",
      )
      .replace("name: 'orders-service',", "name: 'orders-service', definitions: [definitions],"),
  });
}

/** Rewrites one file of a project from what it holds. */
function edit(project: string, path: string, change: (text: string) => string): void {
  write(project, { [path]: change(read(project, path)) });
}

/** The package.json files the CLI refuses, each with what is wrong with it. */
const brokenManifests = [
  ['no JSON', '{ "name": '],
  ['no name', JSON.stringify({ type: 'module' })],
  ['an upper-case name', JSON.stringify({ name: '@org/Orders', type: 'module' })],
  ['a scope alone', JSON.stringify({ name: '@org', type: 'module' })],
];

/** A value with every object's keys sorted, as the canonical form writes them. */
function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortedKeys);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const keys = Object.keys(value).sort();
  return Object.fromEntries(keys.map((key) => [key, sortedKeys(Reflect.get(value, key))]));
}

describe('cf-loom init', () => {
  test('init service writes the root and the config, with the scope and name of package.json', () => {
    const project = aProject();

    const ran = cfLoom(project, 'init', 'service');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    expect(read(project, 'src/contract/index.ts')).toBe(
      [
        "import { defineContract } from '@casitafeliz/loom-contract';",
        '',
        'export const contract = defineContract({',
        "  name: 'orders-service',",
        '});',
        '',
      ].join('\n'),
    );
    expect(read(project, 'cf-loom.config.ts')).toBe(config);
  });

  test('init with no kind initializes a Service', () => {
    const project = aProject();

    const ran = cfLoom(project, 'init');

    expect(ran.status).toBe(0);
    expect(read(project, 'src/contract/index.ts')).toContain('export const contract =');
  });

  test('init application writes an Application’s root', () => {
    const project = aProject();

    const ran = cfLoom(project, 'init', 'application');

    expect(ran.status).toBe(0);
    expect(read(project, 'src/contract/index.ts')).toBe(
      [
        "import { defineApplication } from '@casitafeliz/loom-contract';",
        '',
        'export const application = defineApplication({',
        "  name: 'orders-service',",
        '  dependencies: [],',
        '});',
        '',
      ].join('\n'),
    );
  });

  test('init definitions writes a Definitions Package’s root under src/definitions', () => {
    const project = aProject();

    const ran = cfLoom(project, 'init', 'definitions');

    expect(ran.status).toBe(0);
    expect(read(project, 'src/definitions/index.ts')).toBe(
      [
        "import { defineDefinitions } from '@casitafeliz/loom-contract';",
        '',
        'export const definitions = defineDefinitions({',
        "  name: 'orders-service',",
        '});',
        '',
      ].join('\n'),
    );
  });

  test('init keeps a config that already exists', () => {
    const kept = config.replace('@org', '@kept');
    const project = aProject({ 'cf-loom.config.ts': kept });

    const ran = cfLoom(project, 'init');

    expect(ran.status).toBe(0);
    expect(read(project, 'cf-loom.config.ts')).toBe(kept);
  });

  test('init refuses to overwrite a root, a tooling error', () => {
    const project = aProject(aRoot());
    const root = read(project, 'src/contract/index.ts');

    const ran = cfLoom(project, 'init');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toBe('src/contract/index.ts already exists\n');
    expect(read(project, 'src/contract/index.ts')).toBe(root);
    expect(existsSync(join(project, 'cf-loom.config.ts'))).toBe(false);
  });

  test('init of an unknown kind is a tooling error', () => {
    const project = aProject();

    const ran = cfLoom(project, 'init', 'service-worker');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: `Unknown kind: service-worker. ${usage}\n`,
    });
  });

  test('init refuses when the root of another kind exists', () => {
    const project = aProject({ 'src/definitions/index.ts': 'export {};\n' });

    const ran = cfLoom(project, 'init', 'service');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: 'src/definitions/index.ts already exists\n',
    });
    expect(existsSync(join(project, 'src/contract/index.ts'))).toBe(false);
    expect(existsSync(join(project, 'cf-loom.config.ts'))).toBe(false);
  });

  test('init writes nothing when src/contract is a file', () => {
    const project = aProject({ 'src/contract': 'not a folder\n' });

    const ran = cfLoom(project, 'init');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toBe('src/contract is no folder: init cannot write src/contract/index.ts\n');
    expect(existsSync(join(project, 'cf-loom.config.ts'))).toBe(false);
  });

  test('init writes nothing when cf-loom.config.ts is no file', () => {
    const project = aProject({ 'cf-loom.config.ts/kept.txt': '' });

    const ran = cfLoom(project, 'init');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toBe('cf-loom.config.ts is no file\n');
    expect(existsSync(join(project, 'src/contract/index.ts'))).toBe(false);
  });

  test('init removes what it wrote, folders included, when a write fails', () => {
    const project = aProject();
    symlinkSync('missing/config.ts', join(project, 'cf-loom.config.ts'));

    const ran = cfLoom(project, 'init');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toMatch(/^init cannot write: EEXIST[^\n]*\n$/);
    expect(existsSync(join(project, 'src'))).toBe(false);
  });

  test('init refuses a package.json whose type is not module', () => {
    const project = aProject({ 'package.json': JSON.stringify({ name: '@org/orders-service' }) });

    const ran = cfLoom(project, 'init');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toBe(
      'package.json has no "type": "module": the config and the Contract\'s files are ES modules\n',
    );
    expect(existsSync(join(project, 'src/contract/index.ts'))).toBe(false);
  });

  test.each(brokenManifests)('init refuses a package.json with %s', (_, manifest) => {
    const project = aProject({ 'package.json': manifest });

    const ran = cfLoom(project, 'init');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toMatch(/^package\.json [^\n]+\n$/);
    expect(existsSync(join(project, 'src/contract/index.ts'))).toBe(false);
  });

  test.each(['service', 'application', 'definitions'])(
    'the %s root init writes generates its Snapshot',
    (kind) => {
      const project = aProject();
      cfLoom(project, 'init', kind);

      const ran = cfLoom(project, 'generate');

      expect(ran).toMatchObject({ status: 0, stderr: '' });
      const snapshot = JSON.parse(read(project, 'contract.snapshot.json'));
      expect(snapshot).toMatchObject({ kind, name: 'orders-service' });
    },
  );
});

describe('cf-loom generate', () => {
  test('generate writes contract.snapshot.json in canonical form and exits 0', () => {
    const project = aProject({ 'cf-loom.config.ts': config, ...aRoot() });

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    expect(ran.stdout).toMatch(/^Wrote contract\.snapshot\.json\n/);
    const text = read(project, 'contract.snapshot.json');
    const snapshot = JSON.parse(text);
    expect(text).toBe(`${JSON.stringify(sortedKeys(snapshot), null, 2)}\n`);
    expect(snapshot).toMatchObject({
      format: 1,
      kind: 'service',
      name: 'orders-service',
      generator: `@casitafeliz/loom-cli@${cliVersion}`,
      definitions: {},
      endpoints: { 'GET /ping': { name: 'ping', group: 'health', lifecycle: 'active' } },
    });
  });

  test('generate gives the same bytes every time', () => {
    const project = aProject({ 'cf-loom.config.ts': config, ...aRoot() });
    cfLoom(project, 'generate');
    const first = read(project, 'contract.snapshot.json');

    cfLoom(project, 'generate');

    expect(read(project, 'contract.snapshot.json')).toBe(first);
  });

  test('a construct that is not allowed exits 1 with one line per failure', () => {
    const body = 'z.object({ at: z.date(), ok: z.boolean().default(true) })';
    const project = aProject({ 'cf-loom.config.ts': config, ...aRoot({ body }) });

    const ran = cfLoom(project, 'generate');

    const at = 'groups.health.endpoints.GET /ping.success.body.fields';
    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr: [
        `${at}.at not allowed: z.date() (use z.iso.datetime())`,
        `${at}.ok not allowed: .default()`,
        '',
      ].join('\n'),
    });
    expect(existsSync(join(project, 'contract.snapshot.json'))).toBe(false);
  });

  test('a broken rule exits 1 with its location, rule and message', () => {
    const project = aProject({ 'cf-loom.config.ts': config, ...aRoot() });
    write(project, {
      'src/contract/index.ts': read(project, 'src/contract/index.ts').replace(
        "name: 'orders-service'",
        "name: 'Orders Service'",
      ),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran.status).toBe(1);
    expect(ran.stderr).toMatch(/^name name-grammar: .+\nname package-name: .+\n$/);
  });

  test('a missing config is a tooling error', () => {
    const project = aProject(aRoot());

    const ran = cfLoom(project, 'generate');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toBe('cf-loom.config.ts not found: run cf-loom init\n');
  });

  test('a config without a scope is a tooling error', () => {
    const project = aProject({
      'cf-loom.config.ts': 'export const config = {};\n',
      ...aRoot(),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toContain('scope');
  });

  test('a root that fails to load is a tooling error', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      'src/contract/index.ts':
        "import { missing } from './missing.ts';\nexport const contract = missing;\n",
    });

    const ran = cfLoom(project, 'generate');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toMatch(/^src\/contract\/index\.ts cannot be loaded: /);
  });

  test('a project without a root is a tooling error', () => {
    const project = aProject({ 'cf-loom.config.ts': config });

    const ran = cfLoom(project, 'generate');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toContain('run cf-loom init');
  });

  test('a listed Definitions Package is written at the exact version installed, with its origins', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      ...aRoot(),
      ...installedDefinitions('node_modules'),
    });
    listDefinitions(project);

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    const snapshot = JSON.parse(read(project, 'contract.snapshot.json'));
    expect(snapshot.definitions).toEqual({ '@org/definitions': '4.2.0' });
    expect(snapshot.standardRejections.notFound).toEqual({
      origin: '@org/definitions@4.2.0',
      code: 'MISSING',
      status: 404,
      message: 'Missing',
    });
  });

  test('a listed Definitions Package that is not installed is a tooling error', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      ...aRoot(),
      'src/contract/definitions.ts': [
        "import { defineDefinitions } from '@casitafeliz/loom-contract';",
        "export const definitions = defineDefinitions({ name: 'definitions' });",
        '',
      ].join('\n'),
    });
    write(project, {
      'src/contract/index.ts': read(project, 'src/contract/index.ts')
        .replace(
          "import { ping } from './ping.endpoint.ts';",
          "import { ping } from './ping.endpoint.ts';\nimport { definitions } from './definitions.ts';",
        )
        .replace("name: 'orders-service',", "name: 'orders-service', definitions: [definitions],"),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toBe('@org/definitions is not installed: install it to list it\n');
  });

  test('a Deprecated Endpoint keeps the deprecatedAt of the committed file', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      ...aRoot({ lifecycle: 'deprecated' }),
    });
    const generated = cfLoom(project, 'generate');
    expect(generated.status).toBe(0);
    const committed = JSON.parse(read(project, 'contract.snapshot.json'));
    committed.endpoints['GET /ping'].deprecatedAt = '2026-01-02T03:04:05Z';
    write(project, { 'contract.snapshot.json': JSON.stringify(committed) });

    cfLoom(project, 'generate');

    const snapshot = JSON.parse(read(project, 'contract.snapshot.json'));
    expect(snapshot.endpoints['GET /ping'].deprecatedAt).toBe('2026-01-02T03:04:05Z');
  });

  test('an Endpoint first seen Deprecated is stamped with the clock, to the second', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      ...aRoot({ lifecycle: 'deprecated' }),
    });
    const before = Math.floor(Date.now() / 1000) * 1000;

    cfLoom(project, 'generate');

    const after = Date.now();
    const snapshot = JSON.parse(read(project, 'contract.snapshot.json'));
    const stamp: string = snapshot.endpoints['GET /ping'].deprecatedAt;
    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(Date.parse(stamp)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(stamp)).toBeLessThanOrEqual(after);
  });

  test('a committed file that is no JSON is a tooling error', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      ...aRoot(),
      'contract.snapshot.json': '<<<<<<< HEAD\n',
    });

    const ran = cfLoom(project, 'generate');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toMatch(
      /^contract\.snapshot\.json is no JSON \([^\n]+\): restore it or delete it, then run cf-loom generate\n$/,
    );
  });
});

describe('cf-loom generate: what it refuses', () => {
  test('a root whose name is not the unscoped name of package.json exits 1', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      ...aRoot(),
      'package.json': JSON.stringify({ name: '@org/billing-service', type: 'module' }),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr:
        'name package-name: A root is named as its package.json, without the scope: billing-service\n',
    });
  });

  test('a wrong root name is reported with every other failure at once', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      ...aRoot({ body: 'z.object({ at: z.date() })' }),
      'package.json': JSON.stringify({ name: '@org/billing-service', type: 'module' }),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran.status).toBe(1);
    expect(ran.stderr.split('\n')).toEqual([
      'name package-name: A root is named as its package.json, without the scope: billing-service',
      'groups.health.endpoints.GET /ping.success.body.fields.at not allowed: z.date() (use z.iso.datetime())',
      '',
    ]);
  });

  test.each(brokenManifests)('a package.json with %s is a tooling error', (_, manifest) => {
    const project = aProject({ 'cf-loom.config.ts': config, ...aRoot(), 'package.json': manifest });

    const ran = cfLoom(project, 'generate');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toMatch(/^package\.json [^\n]+\n$/);
  });

  test('a package.json whose type is not module is a tooling error', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      ...aRoot(),
      'package.json': JSON.stringify({ name: '@org/orders-service' }),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toContain('"type": "module"');
  });

  test('a root file that exports two roots is a tooling error', () => {
    const project = aProject({ 'cf-loom.config.ts': config, ...aRoot() });
    edit(project, 'src/contract/index.ts', (text) =>
      text.concat('export const application = contract;\n'),
    );

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: 'src/contract/index.ts exports one root, not contract and application\n',
    });
  });

  test('a schema that throws while it is read is a tooling error naming the file and line', () => {
    const body = [
      'z.object({ name: z.string(), get children() { return z.array(categry); } })',
    ].join('');
    const project = aProject({ 'cf-loom.config.ts': config, ...aRoot({ body }) });

    const ran = cfLoom(project, 'generate');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toBe(
      'src/contract/index.ts threw while it was read: src/contract/ping.endpoint.ts:11: categry is not defined\n',
    );
  });

  test('a config that throws while it is read is a tooling error naming it', () => {
    const throwing = "export const config = { get scope() { throw new Error('not yet'); } };\n";
    const project = aProject({ 'cf-loom.config.ts': throwing, ...aRoot() });

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: 'cf-loom.config.ts threw while it was read: cf-loom.config.ts:1: not yet\n',
    });
  });

  test('a nested file with TypeScript Node cannot strip names the file and line', () => {
    const project = aProject({ 'cf-loom.config.ts': config, ...aRoot() });
    edit(project, 'src/contract/ping.endpoint.ts', (text) => `enum Unused { A }\n${text}`);

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr:
        'src/contract/index.ts cannot be loaded: src/contract/ping.endpoint.ts:1: TypeScript enum is not supported in strip-only mode\n',
    });
  });

  test('a nested file that is no TypeScript names the file and line', () => {
    const project = aProject({ 'cf-loom.config.ts': config, ...aRoot() });
    edit(project, 'src/contract/ping.endpoint.ts', (text) => `${text}export const broken = ;\n`);

    const ran = cfLoom(project, 'generate');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toMatch(
      /^src\/contract\/index\.ts cannot be loaded: src\/contract\/ping\.endpoint\.ts:13: [^\n]+\n$/,
    );
  });

  test('a relative import without its .ts extension says relative imports name the .ts file', () => {
    const project = aProject({ 'cf-loom.config.ts': config, ...aRoot() });
    edit(project, 'src/contract/index.ts', (text) =>
      text.replace("'./ping.endpoint.ts'", "'./ping.endpoint'"),
    );

    const ran = cfLoom(project, 'generate');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toMatch(
      /^src\/contract\/index\.ts cannot be loaded: [^\n]+: relative imports name the \.ts file\n$/,
    );
  });

  test('a listed Definitions Package is resolved from the root file, not the working directory', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      ...aRoot(),
      ...installedDefinitions('src/contract/node_modules'),
    });
    listDefinitions(project);

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    const snapshot = JSON.parse(read(project, 'contract.snapshot.json'));
    expect(snapshot.definitions).toEqual({ '@org/definitions': '4.2.0' });
  });

  test('a listed Definitions Package whose package.json has no version is a tooling error', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      ...aRoot(),
      ...installedDefinitions('node_modules', { version: undefined }),
    });
    listDefinitions(project);

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: '@org/definitions has no version in its package.json\n',
    });
  });
});

describe('cf-loom generate: what the user’s code throws', () => {
  test('a root file that throws what is no Error reports its first line', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      'src/contract/index.ts': "throw 'first line\\nsecond line';\n",
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: 'src/contract/index.ts cannot be loaded: first line\n',
    });
  });

  test('a thrown value with no text is still one line', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      'src/contract/index.ts': 'throw Object.create(null);\n',
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: 'src/contract/index.ts cannot be loaded: a thrown value with no text\n',
    });
  });

  test('a thrown value whose text throws is still one line', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      'src/contract/index.ts': "throw { toString() { throw new Error('no text'); } };\n",
    });

    const ran = cfLoom(project, 'generate');

    expect(ran.stderr).toBe(
      'src/contract/index.ts cannot be loaded: a thrown value with no text\n',
    );
  });

  test('a relative import naming the .js file of a .ts file says relative imports name the .ts file', () => {
    const project = aProject({ 'cf-loom.config.ts': config, ...aRoot() });
    edit(project, 'src/contract/index.ts', (text) =>
      text.replace("'./ping.endpoint.ts'", "'./ping.endpoint.js'"),
    );

    const ran = cfLoom(project, 'generate');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toMatch(/: relative imports name the \.ts file\n$/);
  });

  test('a project whose path holds a parenthesis still names the file and line', () => {
    const project = aProject({ 'cf-loom.config.ts': config, ...aRoot() }, 'cf-loom (copy)-');
    edit(project, 'src/contract/ping.endpoint.ts', (text) => `${text}export const broken = ;\n`);

    const ran = cfLoom(project, 'generate');

    expect(ran.stderr).toMatch(
      /^src\/contract\/index\.ts cannot be loaded: src\/contract\/ping\.endpoint\.ts:13: [^\n]+\n$/,
    );
  });

  test('a file URL in a thrown message is written relative to the project', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      'src/contract/index.ts': `throw new Error(\`broken at \${import.meta.url}\`);\n`,
    });

    const ran = cfLoom(project, 'generate');

    expect(ran.stderr).toBe(
      'src/contract/index.ts cannot be loaded: src/contract/index.ts:1: broken at src/contract/index.ts\n',
    );
  });
});

describe('cf-loom generate and verify: contract.snapshot.json on disk', () => {
  test.each(['generate', 'verify'])(
    '%s reports a contract.snapshot.json that cannot be read in one line',
    (command) => {
      const project = aProject({
        'cf-loom.config.ts': config,
        ...aRoot(),
        'contract.snapshot.json/kept.txt': '',
      });

      const ran = cfLoom(project, command);

      expect(ran.status).toBe(3);
      expect(ran.stderr).toMatch(/^contract\.snapshot\.json cannot be read: EISDIR[^\n]*\n$/);
    },
  );

  test.skipIf(isRoot)(
    'generate reports a project it cannot write in in one line (skipped as root, who writes anywhere)',
    () => {
      const project = aProject({ 'cf-loom.config.ts': config, ...aRoot() });
      chmodSync(project, 0o555);

      const ran = cfLoom(project, 'generate');

      chmodSync(project, 0o755);
      expect(ran.status).toBe(3);
      expect(ran.stderr).toMatch(/^contract\.snapshot\.json cannot be written: EACCES[^\n]*\n$/);
    },
  );

  test('a write that fails leaves the committed contract.snapshot.json as it was', () => {
    const project = aProject({ 'cf-loom.config.ts': config, ...aRoot() });
    expect(cfLoom(project, 'generate').status).toBe(0);
    const committed = read(project, 'contract.snapshot.json');
    write(project, {
      ...aRoot({ body: 'z.object({ ok: z.boolean(), at: z.iso.datetime() })' }),
      'contract.snapshot.json.tmp/kept.txt': '',
    });

    const ran = cfLoom(project, 'generate');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toMatch(/^contract\.snapshot\.json cannot be written: [^\n]+\n$/);
    expect(read(project, 'contract.snapshot.json')).toBe(committed);
  });
});

describe('cf-loom generate: a Definitions Package installed as built JavaScript', () => {
  test('its Guards and shared schemas carry the origin of the version installed', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      'node_modules/@org/definitions/package.json': JSON.stringify({
        name: '@org/definitions',
        version: '4.2.0',
        type: 'module',
        exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
      }),
      'node_modules/@org/definitions/dist/index.d.ts':
        'export declare const definitions: unknown;\nexport declare const apiKey: unknown;\nexport declare const money: unknown;\n',
      'node_modules/@org/definitions/dist/index.js': [
        "import { defineDefinitions, defineGuard } from '@casitafeliz/loom-contract';",
        "import { z } from 'zod';",
        'export const money = z.object({ amount: z.int() });',
        "export const apiKey = defineGuard({ name: 'apiKey', description: 'A key' });",
        'export const definitions = defineDefinitions({',
        "  name: 'definitions',",
        '  guards: [apiKey],',
        '  schemas: { money },',
        '});',
        '',
      ].join('\n'),
      'src/contract/index.ts': [
        "import { defineContract, defineEndpoint, defineGroup } from '@casitafeliz/loom-contract';",
        "import { apiKey, definitions, money } from '@org/definitions';",
        '',
        'export const price = defineEndpoint({',
        "  name: 'price',",
        "  method: 'GET',",
        "  path: '/price',",
        "  visibility: 'public',",
        "  description: 'The price',",
        '  guards: [apiKey],',
        '  success: { status: 200, body: money },',
        '});',
        "const prices = defineGroup({ name: 'prices', description: 'Prices', endpoints: [price] });",
        'export const contract = defineContract({',
        "  name: 'orders-service',",
        '  definitions: [definitions],',
        '  groups: [prices],',
        '});',
        '',
      ].join('\n'),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    const snapshot = JSON.parse(read(project, 'contract.snapshot.json'));
    expect(snapshot.guards.apiKey.origin).toBe('@org/definitions@4.2.0');
    expect(snapshot.endpoints['GET /price'].success.body.origin).toBe(
      '@org/definitions@4.2.0#money',
    );
  });
});

describe('cf-loom generate: a Definitions Package whose entry is missing', () => {
  const guards = [
    "import { defineDefinitions, defineGuard } from '@casitafeliz/loom-contract';",
    "export const apiKey = defineGuard({ name: 'apiKey', description: 'A key' });",
    "export const definitions = defineDefinitions({ name: 'definitions', guards: [apiKey] });",
    '',
  ].join('\n');

  test.each([
    ['only subpaths in its exports', { exports: { './guards': './guards.js' } }],
    [
      'a main that does not exist',
      {
        exports: { '.': { types: './index.d.ts' }, './guards': './guards.js' },
        main: './dist/index.js',
      },
    ],
  ])('a package with %s is a tooling error in one line', (_, manifest) => {
    const project = aProject({
      'cf-loom.config.ts': config,
      ...aRoot(),
      'node_modules/@org/definitions/package.json': JSON.stringify({
        name: '@org/definitions',
        version: '4.2.0',
        type: 'module',
        ...manifest,
      }),
      'node_modules/@org/definitions/guards.js': guards,
    });
    edit(project, 'src/contract/index.ts', (text) =>
      text
        .replace(
          "import { ping } from './ping.endpoint.ts';",
          "import { ping } from './ping.endpoint.ts';\nimport { definitions } from '@org/definitions/guards';",
        )
        .replace("name: 'orders-service',", "name: 'orders-service', definitions: [definitions],"),
    );

    const ran = cfLoom(project, 'generate');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toMatch(/^@org\/definitions [^\n]+\n$/);
  });
});

describe('cf-loom generate: a Definitions Package root', () => {
  test('a Guard the root file exports and its root does not list fails definitions-unlisted', () => {
    const project = aProject({
      'package.json': JSON.stringify({ name: '@org/definitions', type: 'module' }),
      'cf-loom.config.ts': config,
      'src/definitions/index.ts': [
        "import { defineDefinitions, defineGuard, defineRejection } from '@casitafeliz/loom-contract';",
        '',
        "export const apiKey = defineGuard({ name: 'apiKey', description: 'A key' });",
        "export const gone = defineRejection({ code: 'GONE', status: 410, message: 'Gone' });",
        'export const definitions = defineDefinitions({',
        "  name: 'definitions',",
        '  guards: [],',
        '  rejections: [gone],',
        '});',
        '',
      ].join('\n'),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr:
        'guards definitions-unlisted: A Definitions Package lists every Guard it exports or its Guards reach: apiKey\n',
    });
  });
});

describe('cf-loom generate: what a listed Definitions Package lists', () => {
  test('a Rejection the package exports and does not list fails with every other failure', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      ...aRoot(),
      'node_modules/@org/definitions/package.json': JSON.stringify({
        name: '@org/definitions',
        version: '4.2.0',
        type: 'module',
        exports: './index.js',
      }),
      'node_modules/@org/definitions/index.js': [
        "import { defineDefinitions, defineRejection } from '@casitafeliz/loom-contract';",
        "export const gone = defineRejection({ code: 'GONE', status: 410, message: 'Gone' });",
        "export const definitions = defineDefinitions({ name: 'definitions' });",
        '',
      ].join('\n'),
    });
    listDefinitions(project);

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr:
        'definitions.definitions.rejections definitions-unlisted: A Definitions Package lists every Rejection it exports or its Guards reach: GONE\n',
    });
  });

  test('a listed Definitions Package whose name breaks the grammar is reported by the grammar', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      ...aRoot(),
      'src/contract/definitions.ts': [
        "import { defineDefinitions } from '@casitafeliz/loom-contract';",
        "export const definitions = defineDefinitions({ name: 'Org Definitions' });",
        '',
      ].join('\n'),
    });
    edit(project, 'src/contract/index.ts', (text) =>
      text
        .replace(
          "import { ping } from './ping.endpoint.ts';",
          "import { ping } from './ping.endpoint.ts';\nimport { definitions } from './definitions.ts';",
        )
        .replace("name: 'orders-service',", "name: 'orders-service', definitions: [definitions],"),
    );

    const ran = cfLoom(project, 'generate');

    expect(ran.status).toBe(1);
    expect(ran.stderr).toMatch(/^definitions\.Org Definitions\.name name-grammar: [^\n]+\n$/);
  });
});

describe('cf-loom generate: deprecatedAt', () => {
  test('an Endpoint Deprecated again after being Active is stamped anew', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      ...aRoot({ lifecycle: 'deprecated' }),
    });
    expect(cfLoom(project, 'generate').status).toBe(0);
    edit(project, 'contract.snapshot.json', (text) =>
      text.replace(/"deprecatedAt": "[^"]+"/, '"deprecatedAt": "2020-01-02T03:04:05Z"'),
    );
    write(project, aRoot({ lifecycle: 'active' }));
    expect(cfLoom(project, 'generate').status).toBe(0);
    write(project, aRoot({ lifecycle: 'deprecated' }));

    const ran = cfLoom(project, 'generate');

    expect(ran.status).toBe(0);
    const snapshot = JSON.parse(read(project, 'contract.snapshot.json'));
    expect(snapshot.endpoints['GET /ping'].deprecatedAt).not.toBe('2020-01-02T03:04:05Z');
  });
});

describe('cf-loom verify', () => {
  test('verify exits 0 when contract.snapshot.json is up to date', () => {
    const project = aProject({ 'cf-loom.config.ts': config, ...aRoot() });
    cfLoom(project, 'generate');

    const ran = cfLoom(project, 'verify');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    expect(ran.stdout).toMatch(/^contract\.snapshot\.json is up to date\n/);
  });

  test('verify exits 1 when contract.snapshot.json was edited', () => {
    const project = aProject({ 'cf-loom.config.ts': config, ...aRoot() });
    cfLoom(project, 'generate');
    write(project, {
      'contract.snapshot.json': read(project, 'contract.snapshot.json').replace('"ping"', '"pong"'),
    });

    const ran = cfLoom(project, 'verify');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr: 'contract.snapshot.json was edited or is out of date: run cf-loom generate\n',
    });
  });

  test('verify exits 1 when the Contract changed since generate', () => {
    const project = aProject({ 'cf-loom.config.ts': config, ...aRoot() });
    cfLoom(project, 'generate');
    write(project, aRoot({ body: 'z.object({ ok: z.boolean(), at: z.iso.datetime() })' }));

    const ran = cfLoom(project, 'verify');

    expect(ran.status).toBe(1);
  });

  test('verify exits 1 when contract.snapshot.json was never generated', () => {
    const project = aProject({ 'cf-loom.config.ts': config, ...aRoot() });

    const ran = cfLoom(project, 'verify');

    expect(ran).toMatchObject({ status: 1, stdout: '' });
    expect(ran.stderr).toMatch(/^contract\.snapshot\.json is missing: run cf-loom generate\n/);
  });

  test('verify ignores which CLI wrote contract.snapshot.json', () => {
    const project = aProject({ 'cf-loom.config.ts': config, ...aRoot() });
    expect(cfLoom(project, 'generate').status).toBe(0);
    edit(project, 'contract.snapshot.json', (text) =>
      text.replace(`@casitafeliz/loom-cli@${cliVersion}`, '@casitafeliz/loom-cli@0.0.1'),
    );

    const ran = cfLoom(project, 'verify');

    expect(ran.status).toBe(0);
  });

  test('verify exits 1 when the Contract changed, whichever CLI wrote the file', () => {
    const project = aProject({ 'cf-loom.config.ts': config, ...aRoot() });
    expect(cfLoom(project, 'generate').status).toBe(0);
    edit(project, 'contract.snapshot.json', (text) =>
      text.replace(`@casitafeliz/loom-cli@${cliVersion}`, '@casitafeliz/loom-cli@0.0.1'),
    );
    write(project, aRoot({ body: 'z.object({ ok: z.boolean(), at: z.iso.datetime() })' }));

    const ran = cfLoom(project, 'verify');

    expect(ran.status).toBe(1);
  });

  test('generate writes the CLI that runs it', () => {
    const project = aProject({ 'cf-loom.config.ts': config, ...aRoot() });
    expect(cfLoom(project, 'generate').status).toBe(0);
    edit(project, 'contract.snapshot.json', (text) =>
      text.replace(`@casitafeliz/loom-cli@${cliVersion}`, '@casitafeliz/loom-cli@0.0.1'),
    );

    cfLoom(project, 'generate');

    const snapshot = JSON.parse(read(project, 'contract.snapshot.json'));
    expect(snapshot.generator).toBe(`@casitafeliz/loom-cli@${cliVersion}`);
  });

  test('verify exits 1 when a deprecatedAt was edited into no instant', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      ...aRoot({ lifecycle: 'deprecated' }),
    });
    expect(cfLoom(project, 'generate').status).toBe(0);
    edit(project, 'contract.snapshot.json', (text) =>
      text.replace(/"deprecatedAt": "[^"]+"/, '"deprecatedAt": "yesterday"'),
    );

    const ran = cfLoom(project, 'verify');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr: 'contract.snapshot.json was edited or is out of date: run cf-loom generate\n',
    });
  });

  test('verify exits 1 when contract.snapshot.json is no JSON', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      ...aRoot(),
      'contract.snapshot.json': '<<<<<<< HEAD\n',
    });

    const ran = cfLoom(project, 'verify');

    expect(ran.status).toBe(1);
    expect(ran.stderr).toMatch(/^contract\.snapshot\.json was edited: it is no JSON \([^\n]+\)\n/);
  });

  test('verify writes nothing', () => {
    const project = aProject({ 'cf-loom.config.ts': config, ...aRoot() });

    cfLoom(project, 'verify');

    expect(existsSync(join(project, 'contract.snapshot.json'))).toBe(false);
  });
});

describe('cf-loom', () => {
  test('an unknown command is a usage error', () => {
    const project = aProject();

    const ran = cfLoom(project, 'publish-everything');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: `Unknown command: publish-everything. ${usage}\n`,
    });
  });

  test('an unknown option is a usage error', () => {
    const project = aProject();

    const ran = cfLoom(project, 'generate', '--force');

    expect(ran).toEqual({ status: 3, stdout: '', stderr: `Unknown option: --force. ${usage}\n` });
  });
});
