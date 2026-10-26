import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodeSnapshot } from '@cf-loom/contract/internal';
import { afterEach, describe, expect } from 'vitest';
import { canonicalTextOf } from '../test/canonical-text.ts';
import { bin, cfLoomWith } from '../test/cf-loom-run.ts';
import { type Registry, type RegistryOptions, tarballPathOf } from '../test/fake-registry.ts';
import { defaultLoginTo, loginTo, token } from '../test/npm-environment.ts';
import { type Lab, test } from '../test/npm-lab.ts';
import { payments } from '../test/payments-package.ts';
import { ordersPackage } from '../test/published-snapshot.ts';
import { aVersion, type ServedVersion } from '../test/served-version.ts';
import { entriesOf } from '../test/tarball.ts';
import { usage } from '../test/usage.ts';

const cliDir = join(import.meta.dirname, '..');
const cliVersion: string = JSON.parse(readFileSync(join(cliDir, 'package.json'), 'utf8')).version;
const rootDir = join(cliDir, '..', '..');
const zodDir = realpathSync(join(cliDir, 'node_modules/zod'));
const zodVersion: string = JSON.parse(readFileSync(join(zodDir, 'package.json'), 'utf8')).version;
const contractDir = join(cliDir, '..', 'contract');
const contractVersion: string = JSON.parse(
  readFileSync(join(contractDir, 'package.json'), 'utf8'),
).version;
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
  return installedIn(project, files);
}

/** Installs cf-loom, zod and the root's TypeScript in a folder and writes the project's files into it. */
function installedIn(project: string, files: Readonly<Record<string, string>>): string {
  link(contractDir, join(project, 'node_modules/@cf-loom/contract'));
  link(cliDir, join(project, 'node_modules/@cf-loom/cli'));
  link(zodDir, join(project, 'node_modules/zod'));
  link(
    realpathSync(join(rootDir, 'node_modules/typescript')),
    join(project, 'node_modules/typescript'),
  );
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

/** Runs the CLI in a working directory that is removed before it starts, so reading it throws. */
function cfLoomInRemovedFolder(...args: string[]) {
  const folder = mkdtempSync(join(tmpdir(), 'cf-loom-removed-'));
  projects.push(folder);
  const removeThenRun = 'rmdir "$PWD" && exec "$0" "$@"';
  const command = ['-c', removeThenRun, process.execPath, bin, ...args];
  const ran = spawnSync('sh', command, { cwd: folder, encoding: 'utf8' });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

/** Runs the CLI with a working directory that throws `message`, so the command ends as a throw of cf-loom does. */
function cfLoomThrowing(message: string, ...args: string[]) {
  const project = aProject({
    'throwing-cwd.mjs': `process.cwd = () => { throw new Error(${JSON.stringify(message)}); };\n`,
  });
  const preload = pathToFileURL(join(project, 'throwing-cwd.mjs')).href;
  const env = Object.fromEntries([
    ...Object.entries(process.env),
    ['NODE_OPTIONS', `--import ${preload}`],
  ]);
  const ran = spawnSync(process.execPath, [bin, ...args], { cwd: project, env, encoding: 'utf8' });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

/** The one line `--json` prints on stdout for a command that stopped with a message. */
function errorsDocument(...errors: string[]): string {
  return `${JSON.stringify({ format: 1, status: 3, errors })}\n`;
}

/** Root may write in any folder, so a permission test means nothing when run as root. */
const isRoot = process.getuid?.() === 0;

const config = [
  "import { defineConfig } from '@cf-loom/cli';",
  '',
  'export const config = defineConfig({});',
  '',
].join('\n');

function aRoot({
  lifecycle = 'active',
  body = 'z.object({ ok: z.boolean() })',
  status = 200,
  description = 'Answers',
  deprecatedAt = undefined as string | undefined,
  groupDescription = 'Health',
} = {}): Readonly<Record<string, string>> {
  return {
    'src/contract/ping.endpoint.ts': [
      "import { defineEndpoint } from '@cf-loom/contract';",
      "import { z } from 'zod';",
      '',
      'export const ping = defineEndpoint({',
      "  name: 'ping',",
      "  method: 'GET',",
      "  path: '/ping',",
      "  visibility: 'public',",
      `  description: '${description}',`,
      `  lifecycle: '${lifecycle}',`,
      ...(deprecatedAt === undefined ? [] : [`  deprecatedAt: '${deprecatedAt}',`]),
      `  success: { status: ${status}, body: ${body} },`,
      '});',
      '',
    ].join('\n'),
    'src/contract/index.ts': [
      "import { defineService, defineGroup } from '@cf-loom/contract';",
      "import { ping } from './ping.endpoint.ts';",
      '',
      `const health = defineGroup({ name: 'health', description: '${groupDescription}', endpoints: [ping] });`,
      '',
      "export const contract = defineService({ name: 'orders-service', groups: [health] });",
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
      "import { defineDefinitions, defineRejection } from '@cf-loom/contract';",
      "export const gone = defineRejection({ code: 'GONE', status: 410, message: 'Gone' });",
      'export const definitions = defineDefinitions({',
      "  standardRejections: { notFound: { code: 'MISSING', status: 404, message: 'Missing' } },",
      '});',
      '',
    ].join('\n'),
  };
}

/** Names `@org/definitions` as the project Root's `standardRejections`. */
function takeStandardRejections(project: string): void {
  write(project, {
    'src/contract/index.ts': read(project, 'src/contract/index.ts')
      .replace(
        "import { ping } from './ping.endpoint.ts';",
        "import { ping } from './ping.endpoint.ts';\nimport { definitions } from '@org/definitions';",
      )
      .replace(
        "name: 'orders-service',",
        "name: 'orders-service', standardRejections: definitions,",
      ),
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

describe('cf-loom init', () => {
  test('init service writes the Root, named after package.json, and no configuration', () => {
    const project = aProject();

    const ran = cfLoom(project, 'init', 'service');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    expect(read(project, 'src/contract/index.ts')).toBe(
      [
        "import { defineService } from '@cf-loom/contract';",
        '',
        'export const contract = defineService({',
        "  name: 'orders-service',",
        '});',
        '',
      ].join('\n'),
    );
    expect(existsSync(join(project, 'cf-loom.config.ts'))).toBe(false);
  });

  test('init service in an unscoped package writes the Root, and generate then passes', () => {
    const project = aProject({
      'package.json': JSON.stringify({ name: 'orders-service', type: 'module' }),
    });

    const ran = cfLoom(project, 'init', 'service');
    const generatedRan = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 0,
      stdout: 'Created src/contract/index.ts\nCreated .gitattributes\n',
      stderr: '',
    });
    expect(generatedRan).toMatchObject({ status: 0, stderr: '' });
  });

  test('init with no kind initializes a Service', () => {
    const project = aProject();

    const ran = cfLoom(project, 'init');

    expect(ran.status).toBe(0);
    expect(read(project, 'src/contract/index.ts')).toContain('export const contract =');
  });

  test('init application writes an Application’s Root', () => {
    const project = aProject();

    const ran = cfLoom(project, 'init', 'application');

    expect(ran.status).toBe(0);
    expect(read(project, 'src/contract/index.ts')).toBe(
      [
        "import { defineApplication } from '@cf-loom/contract';",
        '',
        'export const application = defineApplication({',
        "  name: 'orders-service',",
        '});',
        '',
      ].join('\n'),
    );
  });

  test('init definitions writes a Definitions Package’s Root under src/definitions', () => {
    const project = aProject();

    const ran = cfLoom(project, 'init', 'definitions');

    expect(ran.status).toBe(0);
    expect(read(project, 'src/definitions/index.ts')).toBe(
      [
        "import { defineDefinitions } from '@cf-loom/contract';",
        '',
        'export const definitions = defineDefinitions({});',
        '',
      ].join('\n'),
    );
  });

  test('init refuses to overwrite a Root, a tooling error', () => {
    const project = aProject(aRoot());
    const root = read(project, 'src/contract/index.ts');

    const ran = cfLoom(project, 'init');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toBe('src/contract/index.ts already exists\n');
    expect(read(project, 'src/contract/index.ts')).toBe(root);
    expect(existsSync(join(project, 'cf-loom.config.ts'))).toBe(false);
    expect(existsSync(join(project, '.gitattributes'))).toBe(false);
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

  test('init refuses when the Root of another kind exists', () => {
    const project = aProject({ 'src/definitions/index.ts': 'export {};\n' });

    const ran = cfLoom(project, 'init', 'service');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: 'src/definitions/index.ts already exists\n',
    });
    expect(existsSync(join(project, 'src/contract/index.ts'))).toBe(false);
    expect(existsSync(join(project, 'cf-loom.config.ts'))).toBe(false);
    expect(existsSync(join(project, '.gitattributes'))).toBe(false);
  });

  test('init writes nothing when src/contract is a file', () => {
    const project = aProject({ 'src/contract': 'not a folder\n' });

    const ran = cfLoom(project, 'init');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toBe('src/contract is no folder: init cannot write src/contract/index.ts\n');
    expect(existsSync(join(project, 'cf-loom.config.ts'))).toBe(false);
    expect(existsSync(join(project, '.gitattributes'))).toBe(false);
  });

  test('init reports a Root it cannot write in one line, and keeps what was there', () => {
    const project = aProject({ 'src/contract/kept.ts': '' });
    symlinkSync('missing/index.ts', join(project, 'src/contract/index.ts'));

    const ran = cfLoom(project, 'init');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toMatch(/^init cannot write: EEXIST[^\n]*\n$/);
    expect(existsSync(join(project, 'src/contract/kept.ts'))).toBe(true);
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

  test.each([
    ['service', 'orders-service'],
    ['application', 'orders-service'],
    ['definitions', '@org/orders-service'],
  ])('the %s Root init writes generates its Snapshot, named %s', (kind, name) => {
    const project = aProject();
    cfLoom(project, 'init', kind);

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    const snapshot = JSON.parse(read(project, 'contract.snapshot.json'));
    expect(snapshot).toMatchObject({ kind, name });
  });
});

describe('cf-loom generate', () => {
  test('generate writes contract.snapshot.json in canonical form and exits 0', () => {
    const project = aProject({ 'cf-loom.config.ts': config, ...aRoot() });

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    expect(ran.stdout).toMatch(/^Wrote contract\.snapshot\.json\n/);
    const text = read(project, 'contract.snapshot.json');
    const snapshot = JSON.parse(text);
    expect(text).toBe(canonicalTextOf(snapshot));
    expect(snapshot).toMatchObject({
      format: 1,
      kind: 'service',
      name: 'orders-service',
      endpoints: { 'GET /ping': { name: 'ping', group: 'health', lifecycle: 'active' } },
    });
    expect(snapshot).not.toHaveProperty('generator');
    expect(
      text.startsWith('{\n  "format": 1,\n  "kind": "service",\n  "name": "orders-service",\n'),
    ).toBe(true);
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

  test.each([
    [
      'a strict object',
      'z.object({ exact: z.strictObject({ a: z.string() }) })',
      'fields.exact not allowed: z.strictObject() (use z.object(): objects are open)',
    ],
    [
      'a record keyed by an enum in a Success',
      "z.object({ totals: z.record(z.enum(['eur']), z.number()) })",
      'fields.totals not allowed: a z.record() or z.partialRecord() keyed by an enum or literal (use z.object() with the keys as fields)',
    ],
  ])('%s exits 1 in one line naming what to use', (_construct, body, line) => {
    const project = aProject({ 'cf-loom.config.ts': config, ...aRoot({ body }) });

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr: `groups.health.endpoints.GET /ping.success.body.${line}\n`,
    });
  });

  test('an intersection reaching an Open Enum exits 1 in one line, since no reader can merge it', () => {
    const body =
      "z.intersection(z.object({ status: openEnum(['a']) }), z.record(z.string(), z.string()))";
    const project = aProject({ 'cf-loom.config.ts': config, ...aRoot({ body }) });
    edit(project, 'src/contract/ping.endpoint.ts', (text) =>
      text.replace('import { defineEndpoint }', 'import { defineEndpoint, openEnum }'),
    );

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr:
        'groups.health.endpoints.GET /ping.success.body not allowed: an intersection that is not of open objects reaching an openEnum() (use .extend())\n',
    });
  });

  test('a union reaching an Open Enum exits 1 in one line, since no reader can tell its Unknown case from another option', () => {
    const body = "z.union([openEnum(['a']), z.literal('b')])";
    const project = aProject({ 'cf-loom.config.ts': config, ...aRoot({ body }) });
    edit(project, 'src/contract/ping.endpoint.ts', (text) =>
      text.replace('import { defineEndpoint }', 'import { defineEndpoint, openEnum }'),
    );

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr:
        'groups.health.endpoints.GET /ping.success.body not allowed: a z.union() reaching an openEnum() (use z.discriminatedUnion(), or one openEnum() of all the values)\n',
    });
  });

  test('a field named __proto__ exits 1 in one line, since zod drops it when parsing', () => {
    const body = "z.object({ ['__proto__']: z.string() })";
    const project = aProject({ 'cf-loom.config.ts': config, ...aRoot({ body }) });

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr:
        'groups.health.endpoints.GET /ping.success.body.fields.__proto__ not allowed: a field named __proto__ (zod drops it when parsing)\n',
    });
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

  test('a project without cf-loom.config.ts generates with the default layout', () => {
    const project = aProject(aRoot());

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    expect(existsSync(join(project, 'src/endpoints/health/ping.handler.ts'))).toBe(true);
  });

  test.each([
    ['a misspelled field', 'layuot: {}'],
    ['scope', "scope: '@org'"],
  ])('a config with %s is a tooling error naming it', (_, field) => {
    const project = aProject({
      'cf-loom.config.ts': `export const config = { ${field} };\n`,
      ...aRoot(),
    });

    const ran = cfLoom(project, 'generate');

    const key = field.split(':')[0];
    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: `cf-loom.config.ts: ${key} is no field of the configuration: it takes layout\n`,
    });
  });

  test('a Root that fails to load is a tooling error', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      'src/contract/index.ts':
        "import { missing } from './missing.ts';\nexport const contract = missing;\n",
    });

    const ran = cfLoom(project, 'generate');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toMatch(/^src\/contract\/index\.ts cannot be loaded: /);
  });

  test('a project without a Root is a tooling error', () => {
    const project = aProject({ 'cf-loom.config.ts': config });

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: 'No Root in src/contract/index.ts or src/definitions/index.ts: run cf-loom init\n',
    });
  });

  test('an imported Definitions Package is recorded at the exact version installed, in its origins', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      ...aRoot(),
      ...installedDefinitions('node_modules'),
    });
    takeStandardRejections(project);

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    const snapshot = JSON.parse(read(project, 'contract.snapshot.json'));
    expect(snapshot.codes.MISSING.origin).toBe('@org/definitions@4.2.0');
    expect(snapshot.standardRejections.notFound).toBe('MISSING');
    expect(snapshot.codes.MISSING).toEqual({
      origin: '@org/definitions@4.2.0',
      status: 404,
      message: 'Missing',
      body: null,
    });
  });

  test('a Deprecated Endpoint carries the deprecatedAt its declaration states', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      ...aRoot({ lifecycle: 'deprecated', deprecatedAt: '2026-01-02T03:04:05Z' }),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    const snapshot = JSON.parse(read(project, 'contract.snapshot.json'));
    expect(snapshot.endpoints['GET /ping'].deprecatedAt).toBe('2026-01-02T03:04:05Z');
  });

  test('generate gives the same bytes when the committed file is deleted', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      ...aRoot({ lifecycle: 'deprecated', deprecatedAt: '2026-01-02T03:04:05Z' }),
    });
    cfLoom(project, 'generate');
    const first = read(project, 'contract.snapshot.json');
    rmSync(join(project, 'contract.snapshot.json'));

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    expect(read(project, 'contract.snapshot.json')).toBe(first);
    expect(JSON.parse(first).endpoints['GET /ping'].deprecatedAt).toBe('2026-01-02T03:04:05Z');
  });

  test('a Deprecated Endpoint with no deprecatedAt exits 1 with the line that asks for it', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      ...aRoot({ lifecycle: 'deprecated' }),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr:
        "groups.health.endpoints.GET /ping.deprecatedAt deprecated-at: A Deprecated Endpoint's deprecatedAt is a UTC instant to the second, such as 2026-11-01T00:00:00Z\n",
    });
    expect(existsSync(join(project, 'contract.snapshot.json'))).toBe(false);
  });

  test('generate overwrites a committed file that is no JSON', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      ...aRoot(),
      'contract.snapshot.json': '<<<<<<< HEAD\n',
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    expect(JSON.parse(read(project, 'contract.snapshot.json'))).toMatchObject({ kind: 'service' });
  });
});

/** A `cf-loom.config.ts` setting `layout` to the source text given, as its author wrote it. */
function aConfigWith(layout: string): string {
  return [
    "import { defineConfig } from '@cf-loom/cli';",
    '',
    `export const config = defineConfig({ layout: ${layout} });`,
    '',
  ].join('\n');
}

/** What `generate` ends with for a project whose config sets `layout` to the source text given. */
function generatedWithLayout(layout: string) {
  const project = aProject({ 'cf-loom.config.ts': aConfigWith(layout), ...aRoot() });
  return cfLoom(project, 'generate');
}

function refusedWith(line: string) {
  return { status: 3, stdout: '', stderr: `cf-loom.config.ts: ${line}\n` };
}

describe('cf-loom: the layout of cf-loom.config.ts', () => {
  test('a layout that is no object is a tooling error', () => {
    const ran = generatedWithLayout("'src'");

    expect(ran).toEqual(
      refusedWith(
        "layout is an object of paths, such as { endpoint: 'src/http/{group}/{name}.handler.ts' }",
      ),
    );
  });

  test('a layout field the layout does not take is a tooling error naming it', () => {
    const ran = generatedWithLayout("{ endpoints: 'src/billing/{name}.handler.ts' }");

    expect(ran).toEqual(
      refusedWith(
        'layout.endpoints is no field of layout: it takes endpoint, guard, command, subscription, handlerMap and readers',
      ),
    );
  });

  test('a layout field that is no string is a tooling error showing its default', () => {
    const ran = generatedWithLayout('{ guard: 7 }');

    expect(ran).toEqual(
      refusedWith("layout.guard is a path such as 'src/guards/{name}.handler.ts'"),
    );
  });

  test('a path outside src/ is a tooling error', () => {
    const ran = generatedWithLayout("{ guard: '/srv/{name}.handler.ts' }");

    expect(ran).toEqual(
      refusedWith(
        'layout.guard must be under src/ and outside src/contract/: /srv/{name}.handler.ts',
      ),
    );
  });

  test('a path under src/contract/ is a tooling error', () => {
    const ran = generatedWithLayout("{ endpoint: 'src/contract/{name}.handler.ts' }");

    expect(ran).toEqual(
      refusedWith(
        'layout.endpoint must be under src/ and outside src/contract/: src/contract/{name}.handler.ts',
      ),
    );
  });

  test.each([
    ['src/{group}/{name}.handler.ts', 'src/health/ping.handler.ts'],
    ['src/e{group}-x/{name}.handler.ts', 'src/ehealth-x/ping.handler.ts'],
  ])('a variable may stand in the first folder under src/, as %s', (path, filled) => {
    const project = aProject({
      'cf-loom.config.ts': aConfigWith(`{ endpoint: '${path}' }`),
      ...aRoot(),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    expect(existsSync(join(project, filled))).toBe(true);
  });

  test('a variable in the file name right under src/ is accepted', () => {
    const project = aProject({
      'cf-loom.config.ts': aConfigWith("{ endpoint: 'src/{name}.handler.ts' }"),
      ...aRoot(),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    expect(existsSync(join(project, 'src/ping.handler.ts'))).toBe(true);
  });

  test('a path with a .. segment is a tooling error', () => {
    const ran = generatedWithLayout("{ guard: 'src/../{name}.handler.ts' }");

    expect(ran).toEqual(
      refusedWith(
        'layout.guard has a segment that is empty, starts with a dot, or holds a character other than a-z, 0-9, -, _ and .: src/../{name}.handler.ts',
      ),
    );
  });

  test('a path with an empty segment is a tooling error', () => {
    const ran = generatedWithLayout("{ guard: 'src/guards//{name}.handler.ts' }");

    expect(ran).toEqual(
      refusedWith(
        'layout.guard has a segment that is empty, starts with a dot, or holds a character other than a-z, 0-9, -, _ and .: src/guards//{name}.handler.ts',
      ),
    );
  });

  test('a path with a segment that starts with a dot is a tooling error', () => {
    const ran = generatedWithLayout("{ guard: 'src/.hidden/{name}.handler.ts' }");

    expect(ran).toEqual(
      refusedWith(
        'layout.guard has a segment that is empty, starts with a dot, or holds a character other than a-z, 0-9, -, _ and .: src/.hidden/{name}.handler.ts',
      ),
    );
  });

  test('a path with a backslash is a tooling error', () => {
    const ran = generatedWithLayout("{ guard: 'src/guards\\\\old/{name}.handler.ts' }");

    expect(ran).toEqual(
      refusedWith(
        'layout.guard has a segment that is empty, starts with a dot, or holds a character other than a-z, 0-9, -, _ and .: src/guards\\old/{name}.handler.ts',
      ),
    );
  });

  test('a path with an upper-case letter is a tooling error', () => {
    const ran = generatedWithLayout("{ guard: 'src/Guards/{name}.handler.ts' }");

    expect(ran).toEqual(
      refusedWith(
        'layout.guard has a segment that is empty, starts with a dot, or holds a character other than a-z, 0-9, -, _ and .: src/Guards/{name}.handler.ts',
      ),
    );
  });

  test('a file name that holds .d. is a tooling error', () => {
    const ran = generatedWithLayout("{ guard: 'src/guards/{name}.d.handler.ts' }");

    expect(ran).toEqual(
      refusedWith(
        'layout.guard has a file name holding .d., which TypeScript reads as a declaration file: src/guards/{name}.d.handler.ts',
      ),
    );
  });

  test('a path with a brace that is no variable is a tooling error', () => {
    const ran = generatedWithLayout("{ guard: 'src/guards/{name.handler.ts' }");

    expect(ran).toEqual(
      refusedWith(
        'layout.guard has a segment that is empty, starts with a dot, or holds a character other than a-z, 0-9, -, _ and .: src/guards/{name.handler.ts',
      ),
    );
  });

  test.each([
    ['.handler.ts', 'src/old.handler.ts/{name}.handler.ts'],
    ['.generated.ts', 'src/old.generated.ts/{name}.handler.ts'],
  ])('a folder ending %s is a tooling error', (_ending, path) => {
    const ran = generatedWithLayout(`{ guard: '${path}' }`);

    expect(ran).toEqual(
      refusedWith(`layout.guard has a folder ending .handler.ts or .generated.ts: ${path}`),
    );
  });

  test('a variable the kind does not take is a tooling error naming it', () => {
    const ran = generatedWithLayout("{ guard: 'src/guards/{group}/{name}.handler.ts' }");

    expect(ran).toEqual(
      refusedWith(
        "layout.guard holds {group}, but a Guard's Handler path takes only {name}: src/guards/{group}/{name}.handler.ts",
      ),
    );
  });

  test('a variable a Command’s Handler path does not take is a tooling error listing the three it takes', () => {
    const ran = generatedWithLayout("{ command: 'src/{module}/{name}.v{version}.handler.ts' }");

    expect(ran).toEqual(
      refusedWith(
        "layout.command holds {module}, but a Command's Handler path takes only {group}, {name} and {version}: src/{module}/{name}.v{version}.handler.ts",
      ),
    );
  });

  test('a version in a Subscription’s Handler path is a tooling error listing the two it takes', () => {
    const ran = generatedWithLayout("{ subscription: 'src/{group}/{name}.v{version}.handler.ts' }");

    expect(ran).toEqual(
      refusedWith(
        "layout.subscription holds {version}, but a Subscription's Handler path takes only {group} and {name}: src/{group}/{name}.v{version}.handler.ts",
      ),
    );
  });

  test('a name in braces that is no variable is a tooling error naming it', () => {
    const ran = generatedWithLayout("{ endpoint: 'src/billing/{id}.handler.ts' }");

    expect(ran).toEqual(
      refusedWith(
        "layout.endpoint holds {id}, but an Endpoint's Handler path takes only {group} and {name}: src/billing/{id}.handler.ts",
      ),
    );
  });

  test('a variable in the path of the Handler map is a tooling error', () => {
    const ran = generatedWithLayout("{ handlerMap: 'src/generated/{name}.generated.ts' }");

    expect(ran).toEqual(
      refusedWith(
        "layout.handlerMap holds {name}, but the Handler map's path takes no variable: src/generated/{name}.generated.ts",
      ),
    );
  });

  test('a Handler path that does not end with .handler.ts, written without its types, is a tooling error', () => {
    const ran = generatedWithLayout("{ command: 'src/commands/{name}.ts' }");

    expect(ran).toEqual(
      refusedWith('layout.command must end with .handler.ts: src/commands/{name}.ts'),
    );
  });

  test('a generated file’s path that does not end with .generated.ts is a tooling error', () => {
    const ran = generatedWithLayout("{ readers: 'src/readers.ts' }");

    expect(ran).toEqual(refusedWith('layout.readers must end with .generated.ts: src/readers.ts'));
  });

  test('the Handler map and the readers at one path are a tooling error', () => {
    const ran = generatedWithLayout(
      "{ handlerMap: 'src/generated.generated.ts', readers: 'src/generated.generated.ts' }",
    );

    expect(ran).toEqual(
      refusedWith('layout.handlerMap and layout.readers are one file: src/generated.generated.ts'),
    );
  });

  test('the Handler map at the readers’ default path is a tooling error', () => {
    const ran = generatedWithLayout("{ handlerMap: 'src/readers.generated.ts' }");

    expect(ran).toEqual(
      refusedWith('layout.handlerMap and layout.readers are one file: src/readers.generated.ts'),
    );
  });

  test('a layout that spells every default is accepted', () => {
    const ran = generatedWithLayout(
      `{
        endpoint: 'src/endpoints/{group}/{name}.handler.ts',
        guard: 'src/guards/{name}.handler.ts',
        command: 'src/commands/{name}.v{version}.handler.ts',
        subscription: 'src/subscriptions/{name}.handler.ts',
        handlerMap: 'src/handlers.generated.ts',
        readers: 'src/readers.generated.ts',
      }`,
    );

    expect(ran).toMatchObject({ status: 0, stderr: '' });
  });

  test('a broken layout stops a command that writes no Handler too', () => {
    const project = aProject({
      'cf-loom.config.ts': aConfigWith("{ guard: '/srv/{name}.handler.ts' }"),
      ...aRoot(),
    });

    const ran = cfLoom(project, 'openapi');

    expect(ran).toEqual(
      refusedWith(
        'layout.guard must be under src/ and outside src/contract/: /srv/{name}.handler.ts',
      ),
    );
  });

  test.each([
    [
      'an Application',
      {
        'src/contract/index.ts': [
          "import { defineApplication } from '@cf-loom/contract';",
          "export const application = defineApplication({ name: 'orders-service', dependencies: [] });",
          '',
        ].join('\n'),
      },
      'an Application has no Handlers, so it takes no `layout`',
    ],
    [
      'a Definitions Package',
      {
        'src/definitions/index.ts': [
          "import { defineDefinitions } from '@cf-loom/contract';",
          'export const definitions = defineDefinitions({});',
          '',
        ].join('\n'),
      },
      'a Definitions Package has no Handlers, so it takes no `layout`',
    ],
  ])('%s whose config sets a layout is a tooling error', (_kind, files, line) => {
    const project = aProject({
      'cf-loom.config.ts': aConfigWith("{ endpoint: 'src/billing/{name}.handler.ts' }"),
      ...files,
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual(refusedWith(line));
  });
});

describe('cf-loom generate: what it refuses', () => {
  test('a Root whose name is not the unscoped name of package.json exits 1', () => {
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
        'name package-name: A Root is named as its package.json, without the scope: billing-service\n',
    });
  });

  test('a wrong Root name is reported with every other failure at once', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      ...aRoot({ body: 'z.object({ at: z.date() })' }),
      'package.json': JSON.stringify({ name: '@org/billing-service', type: 'module' }),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran.status).toBe(1);
    expect(ran.stderr.split('\n')).toEqual([
      'name package-name: A Root is named as its package.json, without the scope: billing-service',
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

  test.for([
    [
      'a Service’s Contract and an Application’s',
      'src/contract/index.ts',
      [
        "import { defineApplication, defineService } from '@cf-loom/contract';",
        "export const contract = defineService({ name: 'orders-service' });",
        "export const application = defineApplication({ name: 'orders-service' });",
        '',
      ].join('\n'),
      'application and contract',
    ],
    [
      'a Definitions Package and a second one',
      'src/definitions/index.ts',
      [
        "import { defineDefinitions } from '@cf-loom/contract';",
        'export const definitions = defineDefinitions({});',
        'export const other = defineDefinitions({});',
        '',
      ].join('\n'),
      'definitions and other',
    ],
    [
      'two Definitions Packages, one named outside the Basic Multilingual Plane',
      'src/definitions/index.ts',
      [
        "import { defineDefinitions } from '@cf-loom/contract';",
        'export const \u{1D44E} = defineDefinitions({});',
        'export const \uFF41 = defineDefinitions({});',
        '',
      ].join('\n'),
      '\uFF41 and \u{1D44E}',
    ],
  ] as const)(
    'a Root file that exports %s is a tooling error naming both exports',
    ([, file, text, names]) => {
      const project = aProject({ 'cf-loom.config.ts': config, [file]: text });

      const ran = cfLoom(project, 'generate');

      expect(ran).toEqual({
        status: 3,
        stdout: '',
        stderr: `${file} exports more than one Root: ${names}\n`,
      });
    },
  );

  test('a Service’s Root file that exports its Root under two names generates', () => {
    const project = aProject({ 'cf-loom.config.ts': config, ...aRoot() });
    edit(project, 'src/contract/index.ts', (text) =>
      text.concat('export const service = contract;\n'),
    );

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
  });

  test.for([
    ['again', 'definitions'],
    ['\uFF41', '\u{1D44E}'],
  ] as const)(
    'a Definitions Package’s Root file that exports its Definitions object as %s and %s fails definitions-export, naming the later name in code point order',
    ([first, later]) => {
      const project = aProject({
        'cf-loom.config.ts': config,
        'package.json': JSON.stringify({ name: '@org/definitions', type: 'module' }),
        'src/definitions/index.ts': [
          "import { defineDefinitions } from '@cf-loom/contract';",
          `export const ${later} = defineDefinitions({});`,
          `export const ${first} = ${later};`,
          '',
        ].join('\n'),
      });

      const ran = cfLoom(project, 'generate');

      expect(ran).toEqual({
        status: 1,
        stdout: '',
        stderr: `exports.${later} definitions-export: A Definitions Package's Root file exports only its definitions, Guards, Rejections and zod schemas: its definitions once, not as ${later}\n`,
      });
    },
  );

  test.each([
    [
      'a hand-built object of the kind service',
      "export const contract = { kind: 'service', name: 'orders-service' };\n",
    ],
    ['a value that is no declaration', 'export const contract = 1;\n'],
    ['nothing', 'export {};\n'],
  ])('a Root file that exports %s exports no Root, a tooling error', (_exports, text) => {
    const project = aProject({ 'cf-loom.config.ts': config, 'src/contract/index.ts': text });

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr:
        "src/contract/index.ts exports no Root: a Service's Contract, an Application's Contract or a Definitions Package, declared with defineService, defineApplication or defineDefinitions\n",
    });
  });

  test('a project with both Root files is a tooling error naming them', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      ...aRoot(),
      'src/definitions/index.ts': 'export {};\n',
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr:
        'A project has one Root: both src/contract/index.ts and src/definitions/index.ts exist\n',
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
    const throwing = "export const config = { get layout() { throw new Error('not yet'); } };\n";
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

  test('an imported Definitions Package is resolved from the Root file, not the working directory', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      ...aRoot(),
      ...installedDefinitions('src/contract/node_modules'),
    });
    takeStandardRejections(project);

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    const snapshot = JSON.parse(read(project, 'contract.snapshot.json'));
    expect(snapshot.codes.MISSING.origin).toBe('@org/definitions@4.2.0');
  });

  test('an imported Definitions Package whose package.json has no version is a tooling error once the Contract takes from it', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      ...aRoot(),
      ...installedDefinitions('node_modules', { version: undefined }),
    });
    takeStandardRejections(project);

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: '@org/definitions has no version in its package.json\n',
    });
  });
});

describe('cf-loom generate: what the user’s code throws', () => {
  test('a Root file that throws what is no Error reports its first line', () => {
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

  test.for(['\\r', '\\u0085', '\\u2028', '\\u2029'])(
    'a Root file that throws a text holding %s reports it as one line, with the line break written escaped',
    (visible) => {
      const project = aProject({
        'cf-loom.config.ts': config,
        'src/contract/index.ts': `throw 'first${visible}second';\n`,
      });

      const ran = cfLoom(project, 'generate');

      expect(ran).toEqual({
        status: 3,
        stdout: '',
        stderr: `src/contract/index.ts cannot be loaded: first${visible}second\n`,
      });
    },
  );

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

  test.skipIf(isRoot)(
    'a write that fails leaves the committed contract.snapshot.json as it was (skipped as root)',
    () => {
      const project = aProject({ 'cf-loom.config.ts': config, ...aRoot() });
      expect(cfLoom(project, 'generate').status).toBe(0);
      const committed = read(project, 'contract.snapshot.json');
      write(project, aRoot({ body: 'z.object({ ok: z.boolean(), at: z.iso.datetime() })' }));
      chmodSync(project, 0o555);

      const ran = cfLoom(project, 'generate');

      chmodSync(project, 0o755);
      expect(ran.status).toBe(3);
      expect(ran.stderr).toMatch(/^contract\.snapshot\.json cannot be written: [^\n]+\n$/);
      expect(read(project, 'contract.snapshot.json')).toBe(committed);
    },
  );
});

describe('cf-loom generate and verify: a contract.snapshot.json in a newer format', () => {
  const newer =
    'contract.snapshot.json is in format 2, newer than this cf-loom reads: upgrade @cf-loom/cli\n';

  test.each(['generate', 'verify'])(
    '%s stops with a tooling error and leaves the file as it is',
    (command) => {
      const committed = `${JSON.stringify({ format: 2, kind: 'service', name: 'orders-service' })}\n`;
      const project = aProject({
        'cf-loom.config.ts': config,
        ...aRoot(),
        'contract.snapshot.json': committed,
      });

      const ran = cfLoom(project, command);

      expect(ran).toEqual({ status: 3, stdout: '', stderr: newer });
      expect(read(project, 'contract.snapshot.json')).toBe(committed);
    },
  );
});

/** `aRoot` whose Success body holds a field nested in arrays that many times. */
function aRootNestedIn(arrays: number): Files {
  const nested = `${'z.array('.repeat(arrays)}z.boolean()${')'.repeat(arrays)}`;
  return aRoot({ body: `z.object({ a: ${nested} })` });
}

/** The levels the Snapshot of `aRootNestedIn` nests to: the body sits at level 5, its field at 8. */
const nestedBeyondArrays = 8;

describe('cf-loom generate: how deep a Snapshot nests', () => {
  test('a Contract whose Snapshot would nest past 256 levels fails generate, naming the path', () => {
    const project = aProject({ 'cf-loom.config.ts': config, ...aRootNestedIn(260) });

    const ran = cfLoom(project, 'generate');

    expect(ran.status).toBe(1);
    expect(ran.stderr).toMatch(
      /^endpoints\.GET \/ping\.success\.body\.fields\.a\.schema(\.items)+ not allowed: JSON nested deeper than the 256 levels a Snapshot holds\n$/,
    );
    expect(existsSync(join(project, 'contract.snapshot.json'))).toBe(false);
  });

  test.each([255, 256, 257])(
    'at %s levels, generate writes a Snapshot exactly when the decoder reads it back',
    (levels) => {
      const arrays = levels - nestedBeyondArrays;
      const project = aProject({ 'cf-loom.config.ts': config, ...aRootNestedIn(arrays) });

      const ran = cfLoom(project, 'generate');

      const fits = levels <= 256;
      expect(ran.status).toBe(fits ? 0 : 1);
      const written = fits ? read(project, 'contract.snapshot.json') : nestedOnceMore(levels);
      const decoded = decodeSnapshot(published(written));
      expect(decoded.kind).toBe(fits ? 'decoded' : 'malformed');
    },
  );

  /** The Snapshot one level shallower `generate` writes, its innermost node nested once more. */
  function nestedOnceMore(levels: number): string {
    const project = aProject({
      'cf-loom.config.ts': config,
      ...aRootNestedIn(levels - 1 - nestedBeyondArrays),
    });
    cfLoom(project, 'generate');
    const boolean = /\{\s*"type": "boolean"\s*\}/;
    return read(project, 'contract.snapshot.json').replace(
      boolean,
      '{ "type": "array", "items": { "type": "boolean" } }',
    );
  }

  /** The Snapshot as a publish would write it, which is what the decoder reads. */
  function published(snapshotJson: string): string {
    const heading = { version: '1.0.0', generator: `@cf-loom/cli@${cliVersion}` };
    return JSON.stringify({ ...JSON.parse(snapshotJson), ...heading });
  }
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
        "import { defineDefinitions, defineGuard } from '@cf-loom/contract';",
        "import { z } from 'zod';",
        'export const money = z.object({ amount: z.int() });',
        "export const apiKey = defineGuard({ name: 'apiKey', description: 'A key' });",
        'export const definitions = defineDefinitions({});',
        '',
      ].join('\n'),
      'src/contract/index.ts': [
        "import { defineService, defineEndpoint, defineGroup } from '@cf-loom/contract';",
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
        'export const contract = defineService({',
        "  name: 'orders-service',",
        '  standardRejections: definitions,',
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

describe('cf-loom generate: a Definitions Package’s Root', () => {
  test('a Definitions Package writes every Guard, Rejection and schema its Root file exports under exports', () => {
    const project = aProject({
      'package.json': JSON.stringify({ name: '@org/definitions', type: 'module' }),
      'src/definitions/index.ts': [
        "import { defineDefinitions, defineGuard, defineRejection } from '@cf-loom/contract';",
        "import { z } from 'zod';",
        '',
        "export const apiKey = defineGuard({ name: 'apiKey', description: 'A key' });",
        "export const gone = defineRejection({ code: 'GONE', status: 410, message: 'Gone' });",
        'export const money = z.object({ amount: z.int() });',
        'export const definitions = defineDefinitions({});',
        '',
      ].join('\n'),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    const snapshot = JSON.parse(read(project, 'contract.snapshot.json'));
    expect(Object.keys(snapshot.exports)).toEqual(['apiKey', 'gone', 'money']);
    expect(snapshot.exports.money.kind).toBe('schema');
    expect(Object.keys(snapshot.guards)).toEqual(['apiKey']);
    expect(snapshot).not.toHaveProperty('schemas');
  });

  test('a list on defineDefinitions fails generate with the field rule', () => {
    const project = aProject({
      'package.json': JSON.stringify({ name: '@org/definitions', type: 'module' }),
      'src/definitions/index.ts': [
        "import { defineDefinitions } from '@cf-loom/contract';",
        'export const definitions = defineDefinitions({ guards: [] } as never);',
        '',
      ].join('\n'),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran.status).toBe(1);
    expect(ran.stderr).toMatch(/^guards undeclared-field: [^\n]+\n$/);
  });

  test('a helper the Root file exports fails generate with one line, and nothing is written', () => {
    const project = aProject({
      'package.json': JSON.stringify({ name: '@org/definitions', type: 'module' }),
      'src/definitions/index.ts': [
        "import { defineDefinitions } from '@cf-loom/contract';",
        'export function isMoney(value: unknown): boolean {',
        "  return typeof value === 'object';",
        '}',
        'export const definitions = defineDefinitions({});',
        '',
      ].join('\n'),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr:
        "exports.isMoney definitions-export: A Definitions Package's Root file exports only its definitions, Guards, Rejections and zod schemas: isMoney is none of them\n",
    });
    expect(existsSync(join(project, 'contract.snapshot.json'))).toBe(false);
  });

  test('a shared schema with an id on no cycle fails generate', () => {
    const project = aProject({
      'package.json': JSON.stringify({ name: '@org/definitions', type: 'module' }),
      'cf-loom.config.ts': config,
      'src/definitions/index.ts': [
        "import { defineDefinitions } from '@cf-loom/contract';",
        "import { z } from 'zod';",
        '',
        "export const money = z.object({ amount: z.int() }).meta({ id: 'money' });",
        'export const definitions = defineDefinitions({});',
        '',
      ].join('\n'),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr:
        'exports.money not allowed: .meta({ id: "money" }) on a schema that lies on no cycle (use .meta({ id }) only on a recursive schema)\n',
    });
  });
});

/** A package installed under `node_modules/<name>`, its package.json named and versioned, with its files. */
function anInstalledPackage(
  name: string,
  manifest: Readonly<Record<string, unknown>>,
  files: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const at = `node_modules/${name}`;
  const written = Object.entries(files).map(([path, text]) => [`${at}/${path}`, text]);
  const packageJson = JSON.stringify({ name, version: '1.2.3', type: 'module', ...manifest });
  return { [`${at}/package.json`]: packageJson, ...Object.fromEntries(written) };
}

/** A module declaring a Definitions Package with a Guard, whose not-found code is `code`, so a Snapshot tells which module the Root holds. */
function definitionsModuleOf(code: string): string {
  return [
    "import { defineDefinitions, defineGuard } from '@cf-loom/contract';",
    "export const apiKey = defineGuard({ name: 'apiKey', description: 'A key' });",
    'export const definitions = defineDefinitions({',
    `  standardRejections: { notFound: { code: '${code}', status: 404, message: 'Missing' } },`,
    '});',
    '',
  ].join('\n');
}

/** A Service's Root, named `name`, that imports `imports` and takes its Standard Rejections from `source`. */
function aServiceTaking(
  imports: readonly string[],
  source: string,
  name = 'orders-service',
): Readonly<Record<string, string>> {
  return {
    'src/contract/index.ts': [
      "import { defineService } from '@cf-loom/contract';",
      ...imports,
      '',
      `export const contract = defineService({ name: '${name}', standardRejections: ${source} });`,
      '',
    ].join('\n'),
  };
}

/** A Service’s Root that lists `definitions` and attaches its Guard `apiKey`, imported from `from`. */
function aServiceGuardedFrom(
  definitionsFrom: string,
  guardFrom: string,
): Readonly<Record<string, string>> {
  return {
    'src/contract/index.ts': [
      "import { defineService, defineEndpoint, defineGroup } from '@cf-loom/contract';",
      "import { z } from 'zod';",
      `import { definitions } from '${definitionsFrom}';`,
      `import { apiKey } from '${guardFrom}';`,
      '',
      'export const ping = defineEndpoint({',
      "  name: 'ping',",
      "  method: 'GET',",
      "  path: '/ping',",
      "  visibility: 'public',",
      "  description: 'Answers',",
      '  guards: [apiKey],',
      '  success: { status: 200, body: z.object({ ok: z.boolean() }) },',
      '});',
      "const health = defineGroup({ name: 'health', description: 'Health', endpoints: [ping] });",
      'export const contract = defineService({',
      "  name: 'orders-service',",
      '  standardRejections: definitions,',
      '  groups: [health],',
      '});',
      '',
    ].join('\n'),
  };
}

/** The files of a Definitions Package whose Guard `apiKey` sits in `guards.js`, exported at `./guards` and by its Root file. */
const guardsModules: Readonly<Record<string, string>> = {
  'guards.js': [
    "import { defineGuard } from '@cf-loom/contract';",
    "export const apiKey = defineGuard({ name: 'apiKey', description: 'A key' });",
    '',
  ].join('\n'),
  'index.js': [
    "import { defineDefinitions } from '@cf-loom/contract';",
    "import { apiKey } from './guards.js';",
    'export const definitions = defineDefinitions({});',
    'export { apiKey };',
    '',
  ].join('\n'),
};

/** Runs the CLI with `NODE_OPTIONS` set, as a user's shell may set it. */
function cfLoomWithNodeOptions(project: string, nodeOptions: string, ...args: string[]) {
  const env = Object.fromEntries([...Object.entries(process.env), ['NODE_OPTIONS', nodeOptions]]);
  const ran = spawnSync(process.execPath, [bin, ...args], { cwd: project, env, encoding: 'utf8' });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

describe('cf-loom generate: the Definitions Packages the Contract imports', () => {
  test('a Service of one scope takes its Standard Rejections from a Definitions Package of another, named after its package.json', () => {
    const project = aProject({
      'package.json': JSON.stringify({ name: '@payments/svc', type: 'module' }),
      ...aServiceTaking(
        ["import { definitions } from '@platform/definitions';"],
        'definitions',
        'svc',
      ),
      ...anInstalledPackage(
        '@platform/definitions',
        { exports: './index.js' },
        {
          'index.js': definitionsModuleOf('MISSING'),
        },
      ),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    const snapshot = JSON.parse(read(project, 'contract.snapshot.json'));
    expect(snapshot.codes.MISSING.origin).toBe('@platform/definitions@1.2.3');
  });

  const conditionFiles: Readonly<Record<string, string>> = Object.fromEntries(
    ['sync', 'node', 'import', 'development', 'other', 'default'].map((file) => [
      `${file}.js`,
      definitionsModuleOf(`MISSING_${file.toUpperCase()}`),
    ]),
  );

  test.each([
    {
      maps: 'module-sync, which Node imports with no flags',
      nodeOptions: '',
      entry: { 'module-sync': './sync.js', default: './default.js' } as unknown,
      code: 'MISSING_SYNC',
    },
    {
      maps: 'node alone',
      nodeOptions: '',
      entry: { node: './node.js', default: './default.js' } as unknown,
      code: 'MISSING_NODE',
    },
    {
      maps: 'import alone',
      nodeOptions: '',
      entry: { import: './import.js', default: './default.js' } as unknown,
      code: 'MISSING_IMPORT',
    },
    {
      maps: 'default alone',
      nodeOptions: '',
      entry: { default: './default.js' } as unknown,
      code: 'MISSING_DEFAULT',
    },
    {
      maps: 'a condition NODE_OPTIONS adds',
      nodeOptions: '--conditions=development',
      entry: { development: './development.js', default: './default.js' } as unknown,
      code: 'MISSING_DEVELOPMENT',
    },
    {
      maps: 'an array whose first target matches no condition',
      nodeOptions: '',
      entry: [{ worker: './other.js' }, './default.js'] as unknown,
      code: 'MISSING_DEFAULT',
    },
  ])(
    'a package whose "." maps $maps is read from the module the Root holds',
    ({ nodeOptions, entry, code }) => {
      const project = aProject({
        'cf-loom.config.ts': config,
        ...aServiceTaking(["import { definitions } from '@org/definitions';"], 'definitions'),
        ...anInstalledPackage('@org/definitions', { exports: { '.': entry } }, conditionFiles),
      });

      const ran = cfLoomWithNodeOptions(project, nodeOptions, 'generate');

      expect(ran).toMatchObject({ status: 0, stderr: '' });
      const snapshot = JSON.parse(read(project, 'contract.snapshot.json'));
      expect(snapshot.standardRejections.notFound).toBe(code);
      expect(snapshot.codes[code].origin).toBe('@org/definitions@1.2.3');
    },
  );

  test('a Definitions object and its Guard imported from two entries of one package are one package, and the stub imports the Guard from the first entry exporting it', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      ...aServiceGuardedFrom('@platform/definitions', '@platform/definitions/guards'),
      ...anInstalledPackage(
        '@platform/definitions',
        { exports: { '.': './index.js', './guards': './guards.js' } },
        guardsModules,
      ),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    const snapshot = JSON.parse(read(project, 'contract.snapshot.json'));
    expect(snapshot.guards.apiKey.origin).toBe('@platform/definitions@1.2.3');
    expect(read(project, 'src/guards/api-key.handler.ts')).toContain(
      "import { apiKey } from '@platform/definitions';",
    );
  });

  test('a Definitions Package reached through a linked alias is named after its package.json, and the stub imports from the alias', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      ...aServiceGuardedFrom('@alias/definitions', '@alias/definitions'),
      'store/definitions/package.json': JSON.stringify({
        name: '@org/definitions',
        version: '4.2.0',
        type: 'module',
        exports: './index.js',
      }),
      'store/definitions/guards.js': guardsModules['guards.js'] ?? '',
      'store/definitions/index.js': guardsModules['index.js'] ?? '',
    });
    link(join(project, 'store/definitions'), join(project, 'node_modules/@alias/definitions'));

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    const snapshot = JSON.parse(read(project, 'contract.snapshot.json'));
    expect(snapshot.guards.apiKey.origin).toBe('@org/definitions@4.2.0');
    expect(read(project, 'src/guards/api-key.handler.ts')).toContain(
      "import { apiKey } from '@alias/definitions';",
    );
  });

  test('a standardRejections no imported package exports is a tooling error', () => {
    const project = aProject({
      ...aServiceTaking(["import { definitions } from './definitions.ts';"], 'definitions'),
      'src/contract/definitions.ts': definitionsModuleOf('MISSING'),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr:
        "standardRejections is exported by no package the Contract's files import: name the definitions a Definitions Package exports\n",
    });
  });

  test('a standardRejections two packages export, each importing the other, is a tooling error naming both', () => {
    const project = aProject({
      ...aServiceTaking(["import { definitions } from '@org/definitions';"], 'definitions'),
      ...anInstalledPackage(
        '@org/definitions',
        { exports: './index.js' },
        {
          'index.js': `import '@org/other';\n${definitionsModuleOf('MISSING')}`,
        },
      ),
      ...anInstalledPackage(
        '@org/other',
        { exports: './index.js' },
        {
          'index.js': "export { definitions } from '@org/definitions';\n",
        },
      ),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr:
        'standardRejections is exported by both @org/definitions and @org/other, and neither imports it from the other: import it from one package\n',
    });
  });

  test('a standardRejections reached only through a package re-exporting it belongs to the package it comes from', () => {
    const project = aProject({
      ...aServiceTaking(["import { definitions } from '@w/wrapper';"], 'definitions'),
      ...anInstalledPackage(
        '@org/definitions',
        { exports: './index.js' },
        {
          'index.js': definitionsModuleOf('MISSING'),
        },
      ),
      ...anInstalledPackage(
        '@w/wrapper',
        { exports: './index.js' },
        {
          'index.js': "export { definitions } from '@org/definitions';\n",
        },
      ),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    const snapshot = JSON.parse(read(project, 'contract.snapshot.json'));
    expect(snapshot.codes.MISSING.origin).toBe('@org/definitions@1.2.3');
  });

  test('Guards of two Definitions Packages of two scopes take each its own package’s origin', () => {
    const project = aProject({
      'src/contract/index.ts': [
        "import { defineService, defineEndpoint, defineGroup } from '@cf-loom/contract';",
        "import { z } from 'zod';",
        "import { apiKey } from '@org/definitions';",
        "import { gate } from '@platform/definitions';",
        '',
        'export const ping = defineEndpoint({',
        "  name: 'ping',",
        "  method: 'GET',",
        "  path: '/ping',",
        "  visibility: 'public',",
        "  description: 'Answers',",
        '  guards: [apiKey, gate],',
        '  success: { status: 200, body: z.object({ ok: z.boolean() }) },',
        '});',
        "const health = defineGroup({ name: 'health', description: 'Health', endpoints: [ping] });",
        "export const contract = defineService({ name: 'orders-service', groups: [health] });",
        '',
      ].join('\n'),
      ...anInstalledPackage(
        '@org/definitions',
        { exports: './index.js' },
        {
          'index.js': definitionsModuleOf('MISSING'),
        },
      ),
      ...anInstalledPackage(
        '@platform/definitions',
        { exports: './index.js' },
        {
          'index.js': [
            "import { defineDefinitions, defineGuard } from '@cf-loom/contract';",
            "export const gate = defineGuard({ name: 'gate', description: 'A gate' });",
            'export const definitions = defineDefinitions({});',
            '',
          ].join('\n'),
        },
      ),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    const snapshot = JSON.parse(read(project, 'contract.snapshot.json'));
    expect([snapshot.guards.apiKey.origin, snapshot.guards.gate.origin]).toEqual([
      '@org/definitions@1.2.3',
      '@platform/definitions@1.2.3',
    ]);
    expect(snapshot).not.toHaveProperty('definitions');
  });

  test('a Guard one package re-exports from another belongs to the other, and its stub imports it from the package the project imports', () => {
    const project = aProject({
      ...aServiceGuardedFrom('@p1/defs', '@p1/defs'),
      ...anInstalledPackage(
        '@p2/defs',
        { exports: './index.js' },
        {
          'index.js': [
            "import { defineDefinitions, defineGuard } from '@cf-loom/contract';",
            "export const apiKey = defineGuard({ name: 'apiKey', description: 'A key' });",
            'export const definitions = defineDefinitions({});',
            '',
          ].join('\n'),
        },
      ),
      ...anInstalledPackage(
        '@p1/defs',
        { exports: './index.js' },
        {
          'index.js': [
            "import { defineDefinitions } from '@cf-loom/contract';",
            "export { apiKey } from '@p2/defs';",
            'export const definitions = defineDefinitions({});',
            '',
          ].join('\n'),
        },
      ),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    const snapshot = JSON.parse(read(project, 'contract.snapshot.json'));
    expect(snapshot.guards.apiKey.origin).toBe('@p2/defs@1.2.3');
    expect(read(project, 'src/guards/api-key.handler.ts')).toContain(
      "import { apiKey } from '@p1/defs';",
    );
  });

  test('a Guard a package re-exports through a plain package that imports it from another belongs to the other', () => {
    const project = aProject({
      ...aServiceGuardedFrom('@p1/defs', '@p1/defs'),
      ...anInstalledPackage(
        '@p2/defs',
        { exports: './index.js' },
        {
          'index.js': [
            "import { defineDefinitions, defineGuard } from '@cf-loom/contract';",
            "export const apiKey = defineGuard({ name: 'apiKey', description: 'A key' });",
            'export const definitions = defineDefinitions({});',
            '',
          ].join('\n'),
        },
      ),
      ...anInstalledPackage(
        'plain-lib',
        { exports: './index.js' },
        {
          'index.js': "export { apiKey } from '@p2/defs';\n",
        },
      ),
      ...anInstalledPackage(
        '@p1/defs',
        { exports: './index.js' },
        {
          'index.js': [
            "import { defineDefinitions } from '@cf-loom/contract';",
            "export { apiKey } from 'plain-lib';",
            'export const definitions = defineDefinitions({});',
            '',
          ].join('\n'),
        },
      ),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    const snapshot = JSON.parse(read(project, 'contract.snapshot.json'));
    expect(snapshot.guards.apiKey.origin).toBe('@p2/defs@1.2.3');
  });

  test('a reached packaged Guard no module the project imports exports exits 1 with the stub line', () => {
    const project = aProject({
      'src/contract/index.ts': [
        "import { defineService, defineEndpoint, defineGroup } from '@cf-loom/contract';",
        "import { z } from 'zod';",
        "import { permission } from '@p1/defs';",
        '',
        'export const ping = defineEndpoint({',
        "  name: 'ping',",
        "  method: 'GET',",
        "  path: '/ping',",
        "  visibility: 'public',",
        "  description: 'Answers',",
        '  guards: [permission.guards[0], permission],',
        '  success: { status: 200, body: z.object({ ok: z.boolean() }) },',
        '});',
        "const health = defineGroup({ name: 'health', description: 'Health', endpoints: [ping] });",
        "export const contract = defineService({ name: 'orders-service', groups: [health] });",
        '',
      ].join('\n'),
      ...anInstalledPackage(
        '@p2/defs',
        { exports: './index.js' },
        {
          'index.js': [
            "import { defineDefinitions, defineGuard } from '@cf-loom/contract';",
            "export const apiKey = defineGuard({ name: 'apiKey', description: 'A key' });",
            'export const definitions = defineDefinitions({});',
            '',
          ].join('\n'),
        },
      ),
      ...anInstalledPackage(
        '@p1/defs',
        { exports: './index.js' },
        {
          'index.js': [
            "import { defineDefinitions, defineGuard } from '@cf-loom/contract';",
            "import { apiKey } from '@p2/defs';",
            "export const permission = defineGuard({ name: 'permission', description: 'A permission', guards: [apiKey] });",
            'export const definitions = defineDefinitions({});',
            '',
          ].join('\n'),
        },
      ),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr:
        "guards.apiKey is exported by no package the Contract's files import: import it from @p2/defs\n",
    });
  });

  test('a code two imported Definitions Packages each declare, both reached, exits 1 naming both, and nothing is written', () => {
    const packageOf = (name: string, guard: string, message: string) =>
      anInstalledPackage(
        name,
        { exports: './index.js' },
        {
          'index.js': [
            "import { defineDefinitions, defineGuard, defineRejection } from '@cf-loom/contract';",
            `export const forbidden = defineRejection({ code: 'FORBIDDEN', status: 403, message: '${message}' });`,
            `export const ${guard} = defineGuard({ name: '${guard}', description: 'A guard', rejections: [forbidden] });`,
            'export const definitions = defineDefinitions({});',
            '',
          ].join('\n'),
        },
      );
    const project = aProject({
      'src/contract/index.ts': [
        "import { defineService, defineEndpoint, defineGroup } from '@cf-loom/contract';",
        "import { z } from 'zod';",
        "import { auth } from '@org/auth-definitions';",
        "import { billing } from '@org/billing-definitions';",
        '',
        'export const ping = defineEndpoint({',
        "  name: 'ping',",
        "  method: 'GET',",
        "  path: '/ping',",
        "  visibility: 'public',",
        "  description: 'Answers',",
        '  guards: [auth, billing],',
        '  success: { status: 200, body: z.object({ ok: z.boolean() }) },',
        '});',
        "const health = defineGroup({ name: 'health', description: 'Health', endpoints: [ping] });",
        "export const contract = defineService({ name: 'orders-service', groups: [health] });",
        '',
      ].join('\n'),
      ...packageOf('@org/auth-definitions', 'auth', 'Not allowed'),
      ...packageOf('@org/billing-definitions', 'billing', 'Forbidden by billing'),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr:
        'rejections.FORBIDDEN code-once: A code is declared once: FORBIDDEN (@org/auth-definitions@1.2.3 and @org/billing-definitions@1.2.3)\n',
    });
    expect(existsSync(join(project, 'contract.snapshot.json'))).toBe(false);
  });

  test('two installed copies of one Definitions Package, both reached, are two origins', () => {
    const copyOf = (version: string, code: string) => ({
      name: '@org/definitions',
      version,
      files: { 'index.js': definitionsModuleOf(code) },
    });
    const older = copyOf('1.0.0', 'MISSING_OLD');
    const newer = copyOf('2.0.0', 'MISSING_NEW');
    const project = aProject({
      'src/contract/index.ts': [
        "import { defineService, defineEndpoint, defineGroup } from '@cf-loom/contract';",
        "import { z } from 'zod';",
        "import { apiKey } from '@p1/defs';",
        "import { definitions } from '@org/definitions';",
        '',
        'export const ping = defineEndpoint({',
        "  name: 'ping',",
        "  method: 'GET',",
        "  path: '/ping',",
        "  visibility: 'public',",
        "  description: 'Answers',",
        '  guards: [apiKey],',
        '  success: { status: 200, body: z.object({ ok: z.boolean() }) },',
        '});',
        "const health = defineGroup({ name: 'health', description: 'Health', endpoints: [ping] });",
        'export const contract = defineService({',
        "  name: 'orders-service',",
        '  standardRejections: definitions,',
        '  groups: [health],',
        '});',
        '',
      ].join('\n'),
      ...anInstalledPackage(
        newer.name,
        { version: newer.version, exports: './index.js' },
        newer.files,
      ),
      ...anInstalledPackage(
        '@p1/defs',
        { exports: './index.js' },
        {
          'index.js': [
            "import { defineDefinitions } from '@cf-loom/contract';",
            "export { apiKey } from '@org/definitions';",
            'export const definitions = defineDefinitions({});',
            '',
          ].join('\n'),
          'node_modules/@org/definitions/package.json': JSON.stringify({
            name: older.name,
            version: older.version,
            type: 'module',
            exports: './index.js',
          }),
          'node_modules/@org/definitions/index.js': older.files['index.js'],
        },
      ),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    const snapshot = JSON.parse(read(project, 'contract.snapshot.json'));
    expect(snapshot.guards.apiKey.origin).toBe('@org/definitions@1.0.0');
    expect(snapshot.codes.MISSING_NEW.origin).toBe('@org/definitions@2.0.0');
    expect(snapshot).not.toHaveProperty('definitions');
  });
});

/** A Definitions Package exporting `definitions` with a not-found code and the Guard `apiKey`, under `name`. */
function aDefinitionsPackage(
  name: string,
  manifest: Readonly<Record<string, unknown>> = { exports: './index.js' },
  files: Readonly<Record<string, string>> = { 'index.js': definitionsModuleOf('MISSING') },
): Readonly<Record<string, string>> {
  return anInstalledPackage(name, manifest, files);
}

describe('cf-loom generate: the package a module belongs to', () => {
  test('a Definitions Package whose built folder holds a package.json of its own is still the package', () => {
    const project = aProject({
      ...aServiceGuardedFrom('@org/definitions', '@org/definitions'),
      ...aDefinitionsPackage(
        '@org/definitions',
        { exports: './dist/index.js' },
        {
          'dist/package.json': JSON.stringify({ type: 'module' }),
          'dist/index.js': definitionsModuleOf('MISSING'),
        },
      ),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    const snapshot = JSON.parse(read(project, 'contract.snapshot.json'));
    expect(snapshot.guards.apiKey.origin).toBe('@org/definitions@1.2.3');
  });

  test('a Service with a package.json of its own under src/ imports its packages as the project', () => {
    const project = aProject({
      ...aServiceGuardedFrom('@org/definitions', '@org/definitions'),
      'src/contract/package.json': JSON.stringify({ type: 'module' }),
      ...aDefinitionsPackage('@org/definitions'),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    expect(read(project, 'src/guards/api-key.handler.ts')).toContain(
      "import { apiKey } from '@org/definitions';",
    );
  });

  test('two entries of one package that both export its Definitions object are one package', () => {
    const project = aProject({
      ...aServiceGuardedFrom('@org/definitions', '@org/definitions/all'),
      ...aDefinitionsPackage(
        '@org/definitions',
        { exports: { '.': './index.js', './all': './all.js' } },
        {
          'index.js': definitionsModuleOf('MISSING'),
          'all.js': "export * from './index.js';\n",
        },
      ),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    const snapshot = JSON.parse(read(project, 'contract.snapshot.json'));
    expect(snapshot.guards.apiKey.origin).toBe('@org/definitions@1.2.3');
  });

  test('an imported Definitions Package with no version the Contract uses nothing of is not refused', () => {
    const project = aProject({
      ...aServiceGuardedFrom('@org/definitions', '@org/definitions'),
      'src/contract/other.ts': "import '@org/other';\n",
      ...aDefinitionsPackage('@org/definitions'),
      ...aDefinitionsPackage(
        '@org/other',
        { exports: './index.js', version: undefined },
        {
          'index.js': [
            "import { defineDefinitions } from '@cf-loom/contract';",
            'export const definitions = defineDefinitions({});',
            '',
          ].join('\n'),
        },
      ),
    });
    edit(project, 'src/contract/index.ts', (text) => `import './other.ts';\n${text}`);

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
  });

  test('a Guard of an imported package.json with no name is refused, and no path reaches the Snapshot', () => {
    const project = aProject({
      ...aServiceGuardedFrom('@org/definitions', 'nameless-defs'),
      ...aDefinitionsPackage('@org/definitions'),
      'node_modules/nameless-defs/package.json': JSON.stringify({
        version: '1.0.0',
        type: 'module',
        exports: './index.js',
      }),
      'node_modules/nameless-defs/index.js': definitionsModuleOf('OTHER'),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr:
        'guards.apiKey definitions-unidentified: A Definitions Package a declaration comes from has a name and a version: node_modules/nameless-defs/package.json has no name\n',
    });
    expect(existsSync(join(project, 'contract.snapshot.json'))).toBe(false);
  });

  test('a Guard an imported package re-exports from one whose package.json has no version belongs to that one, and is refused', () => {
    const project = aProject({
      ...aServiceGuardedFrom('@org/definitions', '@org/definitions'),
      ...aDefinitionsPackage(
        '@org/definitions',
        { exports: './index.js' },
        {
          'index.js': `export { apiKey } from '@org/base';\n${definitionsModuleOf('MISSING').replace(/export const apiKey.*\n/, '')}`,
        },
      ),
      ...aDefinitionsPackage('@org/base', { exports: './index.js', version: undefined }),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr:
        'guards.apiKey definitions-unidentified: A Definitions Package a declaration comes from has a name and a version: @org/base has no version in its package.json\n',
    });
  });

  test('a Guard an imported package and one whose package.json has no version both export, neither importing the other, is ambiguous', () => {
    const shared = [
      "import { defineGuard } from '@cf-loom/contract';",
      "export const apiKey = defineGuard({ name: 'apiKey', description: 'A key' });",
      '',
    ].join('\n');
    const reexporting = `export { apiKey } from '@org/shared';\n${definitionsModuleOf('MISSING').replace(/export const apiKey.*\n/, '')}`;
    const project = aProject({
      ...aServiceGuardedFrom('@org/definitions', '@org/definitions'),
      'src/contract/other.ts': "import '@org/other';\n",
      ...anInstalledPackage('@org/shared', { exports: './index.js' }, { 'index.js': shared }),
      ...aDefinitionsPackage(
        '@org/definitions',
        { exports: './index.js' },
        { 'index.js': reexporting },
      ),
      ...aDefinitionsPackage(
        '@org/other',
        { exports: './index.js', version: undefined },
        { 'index.js': reexporting },
      ),
    });
    edit(project, 'src/contract/index.ts', (text) => `import './other.ts';\n${text}`);

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr:
        'guards.apiKey definitions-ambiguous: A declaration belongs to one Definitions Package: exported by both @org/definitions and @org/other, and neither imports it from the other\n',
    });
  });

  test('a standardRejections an imported package re-exports from one whose package.json has no version is a tooling error naming that one', () => {
    const project = aProject({
      ...aServiceTaking(["import { definitions } from '@org/definitions';"], 'definitions'),
      ...aDefinitionsPackage(
        '@org/definitions',
        { exports: './index.js' },
        { 'index.js': "export { definitions } from '@org/base';\n" },
      ),
      ...aDefinitionsPackage('@org/base', { exports: './index.js', version: undefined }),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: '@org/base has no version in its package.json\n',
    });
  });

  test('a Guard of a scoped package whose package.json has no name is refused, naming that package.json', () => {
    const project = aProject({
      ...aServiceGuardedFrom('@org/definitions', '@x/defs'),
      ...aDefinitionsPackage('@org/definitions'),
      'node_modules/@x/defs/package.json': JSON.stringify({
        version: '1.0.0',
        type: 'module',
        exports: './index.js',
      }),
      'node_modules/@x/defs/index.js': definitionsModuleOf('OTHER'),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr:
        'guards.apiKey definitions-unidentified: A Definitions Package a declaration comes from has a name and a version: node_modules/@x/defs/package.json has no name\n',
    });
  });

  test('a Definitions Package imported through the package.json imports field is found as Node resolves it', () => {
    const project = aProject({
      ...aServiceGuardedFrom('#defs', '#defs'),
      'package.json': JSON.stringify({
        name: '@org/orders-service',
        type: 'module',
        imports: { '#defs': '@org/definitions' },
      }),
      ...aDefinitionsPackage('@org/definitions'),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    const snapshot = JSON.parse(read(project, 'contract.snapshot.json'));
    expect(snapshot.standardRejections.notFound).toBe('MISSING');
    expect(read(project, 'src/guards/api-key.handler.ts')).toContain(
      "import { apiKey } from '#defs';",
    );
  });

  test('a Guard a Service imports from a package re-exporting it and from its own package gets a stub importing from its own package', () => {
    const project = aProject({
      ...aServiceGuardedFrom('@p2/defs', '@p1/defs'),
      ...aDefinitionsPackage('@p2/defs'),
      ...anInstalledPackage(
        '@p1/defs',
        { exports: './index.js' },
        {
          'index.js': "export { apiKey } from '@p2/defs';\n",
        },
      ),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    const snapshot = JSON.parse(read(project, 'contract.snapshot.json'));
    expect(snapshot.guards.apiKey.origin).toBe('@p2/defs@1.2.3');
    expect(read(project, 'src/guards/api-key.handler.ts')).toContain(
      "import { apiKey } from '@p2/defs';",
    );
  });

  test('a package the project imports under two names gets stubs importing from the first in code point order', () => {
    const project = aProject({
      ...aServiceGuardedFrom('@zz/definitions', '@aa/definitions'),
      'store/definitions/package.json': JSON.stringify({
        name: '@org/definitions',
        version: '4.2.0',
        type: 'module',
        exports: './index.js',
      }),
      'store/definitions/index.js': definitionsModuleOf('MISSING'),
    });
    link(join(project, 'store/definitions'), join(project, 'node_modules/@zz/definitions'));
    link(join(project, 'store/definitions'), join(project, 'node_modules/@aa/definitions'));

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    expect(read(project, 'src/guards/api-key.handler.ts')).toContain(
      "import { apiKey } from '@aa/definitions';",
    );
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

  test('verify exits 1 for a committed file that still names a generator', () => {
    const project = aProject({ 'cf-loom.config.ts': config, ...aRoot() });
    expect(cfLoom(project, 'generate').status).toBe(0);
    edit(project, 'contract.snapshot.json', (text) =>
      text.replace('"kind"', `"generator": "@cf-loom/cli@${cliVersion}",\n  "kind"`),
    );

    const ran = cfLoom(project, 'verify');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr: 'contract.snapshot.json was edited or is out of date: run cf-loom generate\n',
    });
  });

  test('verify exits 1 when a deprecatedAt was edited into no instant', () => {
    const project = aProject({
      'cf-loom.config.ts': config,
      ...aRoot({ lifecycle: 'deprecated', deprecatedAt: '2026-10-17T09:30:00Z' }),
    });
    expect(cfLoom(project, 'generate').status).toBe(0);
    edit(project, 'contract.snapshot.json', (text) =>
      text.replace(/"deprecatedAt": "[^"]+"/, '"deprecatedAt": "yesterday"'),
    );

    const ran = cfLoom(project, 'verify');

    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain(
      'contract.snapshot.json was edited or is out of date: run cf-loom generate\n',
    );
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

type Files = Readonly<Record<string, string>>;

const checkTimeout = 60_000;
const checkedAgainstOrders = `Checked against ${ordersPackage}@1.0.0`;
const staleSnapshot = 'contract.snapshot.json is missing or out of date: run cf-loom generate';
const nothingToPublish = (packageVersion: string) =>
  `Nothing to publish: the Snapshot and peer ranges are those of ${packageVersion}`;
const approvalNeededLine =
  '1 Breaking Change(s) need a Breaking Change Approval: your review process enforces it';
const refusedLine = 'The check failed: 1 Change(s) refused';
const openEnumHint = 'declare it with openEnum, so readers take values added later';
const deletedHint =
  'retire it instead, deprecating it first if it is not, and delete it once the Baseline has it Retired';

type MessagingOptions = {
  readonly body?: string;
  readonly eventBody?: string;
  readonly eventVersions?: readonly number[];
  readonly commandLifecycle?: 'active' | 'deprecated' | 'retired';
  readonly status?: number;
};

/** `aRoot` with an Event, in the versions given, and a Command, whose lifecycle is given. */
function aMessagingRoot({
  body,
  status,
  eventBody = 'z.object({ id: z.string() })',
  eventVersions = [1],
  commandLifecycle = 'deprecated',
}: MessagingOptions = {}): Files {
  const root = aRoot({
    ...(body === undefined ? {} : { body }),
    ...(status === undefined ? {} : { status }),
  });
  const events = eventVersions.map((version) =>
    [
      `export const orderCreatedV${version} = defineEvent({`,
      `  name: 'OrderCreated', version: ${version}, visibility: 'internal',`,
      `  description: 'Created', body: ${eventBody},`,
      '});',
    ].join('\n'),
  );
  const messages = [
    "import { defineCommand, defineEvent } from '@cf-loom/contract';",
    "import { z } from 'zod';",
    ...events,
    'export const chargeCardV1 = defineCommand({',
    "  name: 'ChargeCard', version: 1, description: 'Charge',",
    `  lifecycle: '${commandLifecycle}', body: z.object({ card: z.string() }),`,
    '});',
    '',
  ].join('\n');
  const listed = eventVersions.map((version) => `orderCreatedV${version}`).join(', ');
  const index = (root['src/contract/index.ts'] ?? '')
    .replace(
      "import { ping } from './ping.endpoint.ts';",
      `import { ping } from './ping.endpoint.ts';\nimport { chargeCardV1, ${listed} } from './messages.ts';`,
    )
    .replace(
      'endpoints: [ping] }',
      `endpoints: [ping], events: [${listed}], commands: [chargeCardV1] }`,
    );
  return { ...root, 'src/contract/index.ts': index, 'src/contract/messages.ts': messages };
}

/** `aRoot` also subscribing, as `notifyOnSettled`, to `PaymentSettled@1` of its Dependency `payments-service`. */
function aSubscribingRoot(): Files {
  const root = aRoot();
  const index = [
    "import { defineService, defineDependency, defineGroup, defineSubscription } from '@cf-loom/contract';",
    "import { ping } from './ping.endpoint.ts';",
    "import { payments } from './payments.ts';",
    '',
    'export const notifyOnSettled = defineSubscription({',
    "  name: 'notifyOnSettled',",
    "  description: 'Notify on settled',",
    '  event: payments.events.paymentSettledV1,',
    '});',
    '',
    "const health = defineGroup({ name: 'health', description: 'Health', endpoints: [ping], subscriptions: [notifyOnSettled] });",
    '',
    'export const contract = defineService({',
    "  name: 'orders-service',",
    '  groups: [health],',
    '  dependencies: [defineDependency({ provider: payments })],',
    '});',
    '',
  ].join('\n');
  return { ...root, 'src/contract/index.ts': index, 'src/contract/payments.ts': payments };
}

/** The Definitions Package `@org/definitions`, whose Root declares nothing. */
const aDefinitionsRoot: Files = {
  'package.json': JSON.stringify({ name: '@org/definitions', type: 'module' }),
  'src/definitions/index.ts': [
    "import { defineDefinitions } from '@cf-loom/contract';",
    'export const definitions = defineDefinitions({});',
    '',
  ].join('\n'),
};

/** The Definitions Package `@org/definitions`, with a Rejection, a Guard and a shared schema. */
const aDefinitionsRootOfEverySite: Files = {
  'package.json': JSON.stringify({ name: '@org/definitions', type: 'module' }),
  'src/definitions/index.ts': [
    "import { defineDefinitions, defineGuard, defineRejection } from '@cf-loom/contract';",
    "import { z } from 'zod';",
    "export const apiKey = defineGuard({ name: 'apiKey', description: 'A key' });",
    "export const gone = defineRejection({ code: 'GONE', status: 410, message: 'Gone' });",
    'export const money = z.object({ amount: z.number() });',
    'export const definitions = defineDefinitions({});',
    '',
  ].join('\n'),
};

/** The Application `@org/web-admin`, whose Root lists no Dependency. */
const anApplicationRoot: Files = {
  'package.json': JSON.stringify({ name: '@org/web-admin', type: 'module' }),
  'src/contract/index.ts': [
    "import { defineApplication } from '@cf-loom/contract';",
    "export const application = defineApplication({ name: 'web-admin', dependencies: [] });",
    '',
  ].join('\n'),
};

/** Runs `generate` in a project of the lab, as a developer does before committing. */
async function generateIn(lab: Lab, project: string): Promise<void> {
  const ran = await cfLoomWith(project, lab.anNpmEnvironment(), 'generate');
  expect(ran).toMatchObject({ status: 0, stderr: '' });
}

/** A project of the lab with the files given and `generate` run on them. */
async function aGeneratedProject(lab: Lab, files: Files): Promise<string> {
  const project = installedIn(lab.aFolder(), { 'cf-loom.config.ts': config, ...files });
  await generateIn(lab, project);
  return project;
}

/** The peer ranges `publish` stamps on a package built with the zod and the contract the lab installs. */
const installedPeers = { '@cf-loom/contract': `^${contractVersion}`, zod: `^${zodVersion}` };

/** The Snapshot `generate` wrote, as a registry serves it once published as `version`. */
function publishedAs(
  project: string,
  version: string,
  more: Readonly<Record<string, unknown>> = {},
): ServedVersion {
  const snapshot = JSON.parse(read(project, 'contract.snapshot.json'));
  const published = { ...snapshot, ...more, version, generator: '@cf-loom/cli@0.0.0' };
  const declared = { kind: snapshot.kind, name: snapshot.name };
  const snapshotJson = canonicalTextOf(published);
  return aVersion(version, { declared, snapshotJson, peers: installedPeers });
}

function servedAs(packageName: string, ...versions: readonly ServedVersion[]): RegistryOptions {
  return { packages: { [packageName]: { versions } } };
}

/** A served version whose package.json declares the peer ranges given, as published by a project that installed other versions. */
function withPeers(served: ServedVersion, peers: Readonly<Record<string, string>>): ServedVersion {
  return { ...served, manifest: { ...served.manifest, peerDependencies: peers } };
}

/** A project and what the registry it is checked against serves. */
type Checkable = { readonly project: string; readonly served: RegistryOptions };

/** Runs a command against a registry that serves what is given, with the login of the lab. */
async function ranAgainst(lab: Lab, changed: Checkable, ...args: string[]) {
  const { project, served } = changed;
  const registry = await lab.aRegistry(served);
  const env = lab.anNpmEnvironment({ userConfig: loginTo(registry) });
  const ran = await cfLoomWith(project, env, ...args);
  return { ran, registry, env };
}

function checkedAgainst(lab: Lab, changed: Checkable, ...args: string[]) {
  return ranAgainst(lab, changed, 'check', ...args);
}

/** A project whose Root `before` was published as the versions given, then became `after` and was generated. */
async function aChangedProjectListing(
  lab: Lab,
  { before, after }: { before: Files; after: Files },
  versions: readonly string[],
) {
  const project = await aGeneratedProject(lab, before);
  const served = servedAs(
    ordersPackage,
    ...versions.map((version) => publishedAs(project, version)),
  );
  write(project, after);
  withoutRetiredHandlers(project);
  await generateIn(lab, project);
  return { project, served };
}

/** Deletes the Endpoint and Command Handlers `generate` wrote, as a developer deletes those of the Elements a change retires. */
function withoutRetiredHandlers(project: string): void {
  for (const folder of ['endpoints', 'commands']) {
    rmSync(join(project, 'src', folder), { recursive: true, force: true });
  }
}

/** A project whose Root `before` was published as 1.0.0, and as the other versions given, then became `after` and was generated. */
function aChangedProject(
  lab: Lab,
  roots: { before: Files; after: Files },
  alsoListed: readonly string[] = [],
) {
  return aChangedProjectListing(lab, roots, ['1.0.0', ...alsoListed]);
}

/** A project that was published as 1.0.0 with a Success field, then as 1.1.0 without it, and has not changed since. */
async function aProjectPublishedTwice(lab: Lab, distTags?: Readonly<Record<string, string>>) {
  const project = await aGeneratedProject(lab, removedSuccessField.before);
  const first = publishedAs(project, '1.0.0');
  write(project, removedSuccessField.after);
  await generateIn(lab, project);
  const versions = [first, publishedAs(project, '1.1.0')];
  const served = { packages: { [ordersPackage]: { versions, ...(distTags ? { distTags } : {}) } } };
  return { project, served };
}

/** A project whose Baseline holds a copy of an entry of `section` under `key`, which the project lacks. */
async function aBaselineWithExtraKey(lab: Lab, section: string, key: string) {
  const project = await aGeneratedProject(lab, aMessagingRoot());
  const snapshot = JSON.parse(read(project, 'contract.snapshot.json'));
  const [declared] = Object.values(snapshot[section]);
  const more = { [section]: { ...snapshot[section], [key]: declared } };
  return { project, served: servedAs(ordersPackage, publishedAs(project, '1.0.0', more)) };
}

const removedSuccessField = {
  before: aRoot({ body: 'z.object({ ok: z.boolean(), total: z.number() })' }),
  after: aRoot(),
};

const retiredCommand = {
  before: aMessagingRoot({ commandLifecycle: 'deprecated' }),
  after: aMessagingRoot({ commandLifecycle: 'retired' }),
};

const removedEventField = {
  before: aMessagingRoot({ eventBody: 'z.object({ id: z.string(), placedAt: z.number() })' }),
  after: aMessagingRoot(),
};

const removedFieldOfEach = {
  before: aMessagingRoot({
    body: 'z.object({ ok: z.boolean(), total: z.number() })',
    eventBody: 'z.object({ id: z.string(), placedAt: z.number() })',
  }),
  after: aMessagingRoot(),
};

const changedInEveryWay = {
  before: aMessagingRoot({
    body: "z.object({ ok: z.boolean(), total: z.number(), kind: z.enum(['a', 'b']), code: z.literal(1) })",
  }),
  after: aMessagingRoot({
    body: "z.object({ ok: z.boolean(), kind: z.enum(['a', 'b', 'c']), code: z.literal('1') })",
    status: 201,
    eventVersions: [1, 2],
    commandLifecycle: 'retired',
  }),
};

describe.concurrent('cf-loom check', { timeout: checkTimeout }, () => {
  test('check fails when contract.snapshot.json is missing, before it reads the registry', async ({
    lab,
  }) => {
    const project = installedIn(lab.aFolder(), { 'cf-loom.config.ts': config, ...aRoot() });

    const { ran, registry } = await checkedAgainst(lab, { project, served: {} });

    expect(ran).toEqual({ status: 1, stdout: '', stderr: `${staleSnapshot}\n` });
    expect(registry.requests).toEqual([]);
  });

  test('check fails when contract.snapshot.json is out of date, before it reads the registry', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aRoot());
    write(project, aRoot({ body: 'z.object({ ok: z.boolean(), at: z.iso.datetime() })' }));

    const { ran, registry } = await checkedAgainst(lab, { project, served: {} });

    expect(ran).toEqual({ status: 1, stdout: '', stderr: `${staleSnapshot}\n` });
    expect(registry.requests).toEqual([]);
  });

  test('a Root that breaks a rule fails check with generate’s lines', async ({ lab }) => {
    const broken = {
      'package.json': JSON.stringify({ name: '@org/billing-service', type: 'module' }),
    };
    const project = installedIn(lab.aFolder(), {
      'cf-loom.config.ts': config,
      ...aRoot(),
      ...broken,
    });

    const { ran, registry } = await checkedAgainst(lab, { project, served: {} });

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr:
        'name package-name: A Root is named as its package.json, without the scope: billing-service\n',
    });
    expect(registry.requests).toEqual([]);
  });

  test('a contract.snapshot.json that is no JSON is a tooling error', async ({ lab }) => {
    const committed = { 'contract.snapshot.json': '<<<<<<< HEAD\n' };
    const project = installedIn(lab.aFolder(), {
      'cf-loom.config.ts': config,
      ...aRoot(),
      ...committed,
    });

    const { ran, registry } = await checkedAgainst(lab, { project, served: {} });

    expect(ran.status).toBe(3);
    expect(ran.stdout).toBe('');
    expect(ran.stderr).toMatch(
      /^contract\.snapshot\.json is no JSON \([^\n]+\): run cf-loom generate\n$/,
    );
    expect(registry.requests).toEqual([]);
  });

  test('a Service is checked against the highest published version of its Contract Package, which check names', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, removedSuccessField.before);
    const older = publishedAs(project, '1.0.0');
    write(project, removedSuccessField.after);
    await generateIn(lab, project);
    const newer = publishedAs(project, '1.1.0');

    const { ran } = await checkedAgainst(lab, {
      project,
      served: servedAs(ordersPackage, older, newer),
    });

    expect(ran.status).toBe(0);
    expect(ran.stdout.split('\n')[0]).toBe(`Checked against ${ordersPackage}@1.1.0`);
    expect(ran.stdout).toContain(nothingToPublish(`${ordersPackage}@1.1.0`));
  });

  test('a Definitions Package is checked against the package its package.json names', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aDefinitionsRoot);
    const served = servedAs('@org/definitions', publishedAs(project, '1.0.0'));

    const { ran } = await checkedAgainst(lab, { project, served });

    expect(ran).toEqual({
      status: 0,
      stdout: `Checked against @org/definitions@1.0.0\n${nothingToPublish('@org/definitions@1.0.0')}\n`,
      stderr: '',
    });
  });

  test('an Application is checked against its Contract Package and reports its Dependencies as Neutral Changes', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, anApplicationRoot);
    const dependency = {
      'orders-service': {
        against: '1.0.0',
        endpoints: [{ id: 'GET /orders/{}', name: 'getOrder' }],
      },
    };
    const published = publishedAs(project, '1.0.0', { dependencies: dependency });
    const served = servedAs('@org/contract-web-admin', published);

    const { ran } = await checkedAgainst(lab, { project, served });

    const checked = 'Checked against @org/contract-web-admin@1.0.0';
    expect(ran).toEqual({
      status: 0,
      stdout: [
        checked,
        'dependencies.orders-service removed: Neutral',
        'No Change needs a Breaking Change Approval',
        'Would publish @org/contract-web-admin@1.0.1 (patch)',
        '',
      ].join('\n'),
      stderr: '',
    });
  });

  test('a package npm cannot find has no Baseline: check names the registry and the npm user, and exits 0', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aRoot());

    const { ran, registry } = await checkedAgainst(lab, { project, served: {} });

    const why = `it is not in ${registry.url}/ for the npm user tester: never published, or that login cannot read it`;
    expect(ran).toEqual({
      status: 0,
      stdout: `${ordersPackage} has no Baseline: ${why}\nWould publish ${ordersPackage}@1.0.0 (first version)\n`,
      stderr: '',
    });
  });

  test('with no Baseline, a Message Version numbered after a gap is refused: check prints it and exits 1', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aMessagingRoot({ eventVersions: [1, 3] }));

    const { ran, registry } = await checkedAgainst(lab, { project, served: {} });

    const [noBaseline, gap, ...others] = ran.stdout.split('\n');
    expect(noBaseline).toBe(neverPublished(registry));
    expect(gap).toMatch(
      /^events\.OrderCreated@3 version-gap missing=OrderCreated@2: Additive, refused/,
    );
    expect(others).toEqual(['']);
    expect(ran).toMatchObject({ status: 1, stderr: 'The check failed: 1 Change(s) refused\n' });
  });

  test('with no Baseline, check --json lists the refused gap', async ({ lab }) => {
    const project = await aGeneratedProject(lab, aMessagingRoot({ eventVersions: [2] }));

    const { ran } = await checkedAgainst(lab, { project, served: {} }, '--json');

    const document = JSON.parse(ran.stdout);
    expect(ran.status).toBe(1);
    expect(document).toMatchObject({ status: 1, baseline: null });
    expect(document.changes).toMatchObject([
      {
        site: { kind: 'event', identity: 'OrderCreated@2' },
        difference: { kind: 'version-gap', missing: 'OrderCreated@1' },
        verdict: 'refused',
      },
    ]);
  });

  test('an unscoped Contract Package npm cannot find is read from npm’s registry, and has no Baseline', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, {
      ...aRoot(),
      'package.json': JSON.stringify({ name: 'orders-service', type: 'module' }),
    });
    const registry = await lab.aRegistry({});
    const env = lab.anNpmEnvironment({ userConfig: defaultLoginTo(registry) });

    const ran = await cfLoomWith(project, env, 'check');

    const why = `it is not in ${registry.url}/ for the npm user tester: never published, or that login cannot read it`;
    expect(ran).toEqual({
      status: 0,
      stdout: `contract-orders-service has no Baseline: ${why}\nWould publish contract-orders-service@1.0.0 (first version)\n`,
      stderr: '',
    });
  });

  test('--against on a package npm cannot find is a tooling error, as for any version the package does not list', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aRoot());

    const { ran } = await checkedAgainst(lab, { project, served: {} }, '--against', '1.0.0');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: `${ordersPackage} lists no version or dist-tag 1.0.0: --against takes one of them\n`,
    });
  });

  test('a package with only prereleases is checked against the highest one, and the line says there is no stable version', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aRoot());
    const served = servedAs(
      ordersPackage,
      publishedAs(project, '1.0.0-rc.2'),
      publishedAs(project, '1.0.0-rc.1'),
    );

    const { ran } = await checkedAgainst(lab, { project, served });

    const checked = `${ordersPackage}@1.0.0-rc.2`;
    expect(ran).toEqual({
      status: 0,
      stdout: `Checked against ${checked} (no stable version: the first is 1.0.0)\nWould publish ${ordersPackage}@1.0.0 (promotes 1.0.0-rc.2)\n`,
      stderr: '',
    });
  });

  test('a Breaking Change against a package with only prereleases needs an Approval, as against any version', async ({
    lab,
  }) => {
    const changed = await aChangedProjectListing(lab, removedSuccessField, ['1.0.0-0', '1.0.0-1']);

    const { ran } = await checkedAgainst(lab, changed);

    expect(ran).toEqual({
      status: 2,
      stdout: [
        `Checked against ${ordersPackage}@1.0.0-1 (no stable version: the first is 1.0.0)`,
        'endpoints.GET /ping (ping) schema field-removed at success.body.total: Breaking, needs a Breaking Change Approval',
        `Would publish ${ordersPackage}@1.0.0 (major)`,
        '',
      ].join('\n'),
      stderr: `${approvalNeededLine}\n`,
    });
  });

  test('retiring an Endpoint that was never Deprecated is Not allowed against a prerelease', async ({
    lab,
  }) => {
    const roots = {
      before: aRoot({ lifecycle: 'active' }),
      after: aRoot({ lifecycle: 'retired' }),
    };
    const changed = await aChangedProjectListing(lab, roots, ['1.0.0-0']);

    const { ran } = await checkedAgainst(lab, changed);

    expect(ran.status).toBe(1);
    expect(ran.stdout).toContain('retired-before-deprecated');
    expect(ran.stderr).toBe(`${refusedLine}\n`);
  });

  test('a prerelease above the highest stable version is the Baseline, and the line says which version it derives from', async ({
    lab,
  }) => {
    const changed = await aChangedProject(lab, { before: aRoot(), after: aRoot() }, ['1.1.0-0']);

    const { ran } = await checkedAgainst(lab, changed);

    const checked = `${ordersPackage}@1.1.0-0`;
    expect(ran).toEqual({
      status: 0,
      stdout: `Checked against ${checked} (version from 1.0.0)\nWould publish ${ordersPackage}@1.1.0 (promotes 1.1.0-0)\n`,
      stderr: '',
    });
  });

  test('a prerelease below the highest stable version is not the Baseline', async ({ lab }) => {
    const changed = await aChangedProject(lab, { before: aRoot(), after: aRoot() }, ['0.9.0-rc.1']);

    const { ran } = await checkedAgainst(lab, changed);

    expect(ran.stdout.split('\n')[0]).toBe(checkedAgainstOrders);
  });

  test('--against compares with the version named, and the line says so', async ({ lab }) => {
    const changed = await aProjectPublishedTwice(lab);

    const { ran } = await checkedAgainst(lab, changed, '--against', '1.0.0');

    expect(ran).toEqual({
      status: 2,
      stdout: [
        `Checked against ${ordersPackage}@1.0.0 (--against)`,
        'endpoints.GET /ping (ping) schema field-removed at success.body.total: Breaking, needs a Breaking Change Approval',
        '',
      ].join('\n'),
      stderr: `${approvalNeededLine}\n`,
    });
  });

  test('without --against the same project is compared with its highest version', async ({
    lab,
  }) => {
    const changed = await aProjectPublishedTwice(lab);

    const { ran } = await checkedAgainst(lab, changed);

    const checked = `${ordersPackage}@1.1.0`;
    expect(ran).toEqual({
      status: 0,
      stdout: `Checked against ${checked}\n${nothingToPublish(checked)}\n`,
      stderr: '',
    });
  });

  test('--against compares with the version a dist-tag points at', async ({ lab }) => {
    const changed = await aProjectPublishedTwice(lab, { latest: '1.1.0', next: '1.0.0' });

    const { ran } = await checkedAgainst(lab, changed, '--against', 'next');

    expect(ran.status).toBe(2);
    expect(ran.stdout.split('\n')[0]).toBe(`Checked against ${ordersPackage}@1.0.0 (--against)`);
  });

  test.for([
    ['a version it does not list', '9.9.9'],
    ['a dist-tag it does not have', 'beta'],
  ] as const)('--against %s is a tooling error naming it', async ([, name], { lab }) => {
    const changed = await aProjectPublishedTwice(lab, { latest: '1.1.0' });

    const { ran } = await checkedAgainst(lab, changed, '--against', name);

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: `${ordersPackage} lists no version or dist-tag ${name}: --against takes one of them\n`,
    });
  });

  test('--against a dist-tag that points at a version the package does not list is a tooling error', async ({
    lab,
  }) => {
    const changed = await aProjectPublishedTwice(lab, { latest: '1.1.0', next: '3.0.0' });

    const { ran } = await checkedAgainst(lab, changed, '--against', 'next');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: `${ordersPackage} lists no version or dist-tag next: --against takes one of them\n`,
    });
  });

  test('check --json names the Baseline and the highest stable version', async ({ lab }) => {
    const changed = await aChangedProject(lab, { before: aRoot(), after: aRoot() }, ['1.1.0-0']);

    const { ran } = await checkedAgainst(lab, changed, '--json');

    expect(JSON.parse(ran.stdout)).toMatchObject({ baseline: '1.1.0-0', stable: '1.0.0' });
  });

  test('check --json has no highest stable version when only prereleases are listed', async ({
    lab,
  }) => {
    const changed = await aChangedProjectListing(lab, { before: aRoot(), after: aRoot() }, [
      '1.0.0-0',
    ]);

    const { ran } = await checkedAgainst(lab, changed, '--json');

    expect(JSON.parse(ran.stdout)).toMatchObject({ baseline: '1.0.0-0', stable: null });
  });

  test('check --json of a package never published has no Baseline and no stable version', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aRoot());

    const { ran } = await checkedAgainst(lab, { project, served: {} }, '--json');

    expect(JSON.parse(ran.stdout)).toMatchObject({ baseline: null, stable: null });
  });

  test('a registry check cannot read is a tooling error with its one line', async ({ lab }) => {
    const project = await aGeneratedProject(lab, aRoot());
    const packument = `/${ordersPackage.replace('/', '%2f')}`;
    const answers = { [packument]: { status: 500, body: 'a plain text body' } };

    const { ran } = await checkedAgainst(lab, { project, served: { answers } });

    expect(ran.status).toBe(3);
    expect(ran.stdout).toBe('');
    expect(ran.stderr).toMatch(
      new RegExp(`^npm view ${ordersPackage} failed \\(E500: [^\\n]+\\)\\n$`),
    );
  });

  test('check reads the registry with the login of the environment it runs in', async ({ lab }) => {
    const project = await aGeneratedProject(lab, aRoot());
    const registry = await lab.aRegistry(servedAs(ordersPackage, publishedAs(project, '1.0.0')));
    const userConfig = `@org:registry=${registry.url}/\n//${registry.host}/:_authToken=${token}-mine\n`;
    const env = lab.anNpmEnvironment({ userConfig });

    const ran = await cfLoomWith(project, env, 'check');

    expect(ran.status).toBe(0);
    const logins = new Set(registry.requests.map((request) => request.authorization));
    expect(logins).toEqual(new Set([`Bearer ${token}-mine`]));
  });

  test('a Snapshot with no Change against its Baseline says so and exits 0', async ({ lab }) => {
    const changed = await aChangedProject(lab, { before: aRoot(), after: aRoot() });

    const { ran } = await checkedAgainst(lab, changed);

    expect(ran).toEqual({
      status: 0,
      stdout: `${checkedAgainstOrders}\n${nothingToPublish(`${ordersPackage}@1.0.0`)}\n`,
      stderr: '',
    });
  });

  test('every Change is printed on its own line in the report’s order, with its site, kinds, path, Position, fields and class', async ({
    lab,
  }) => {
    const changed = await aChangedProject(lab, changedInEveryWay);

    const { ran } = await checkedAgainst(lab, changed);

    const approval = 'Breaking, needs a Breaking Change Approval';
    const schema = 'endpoints.GET /ping (ping) schema';
    expect(ran.stdout.split('\n')).toEqual([
      checkedAgainstOrders,
      `endpoints.GET /ping (ping) status-changed from=200 to=201: ${approval}`,
      `${schema} value-added at success.body.code value="1" enum=closed: ${approval}; ${openEnumHint}`,
      `${schema} value-removed at success.body.code value=1: Additive`,
      `${schema} value-added at success.body.kind value="c" enum=closed: ${approval}; ${openEnumHint}`,
      `${schema} field-removed at success.body.total: ${approval}`,
      'events.OrderCreated@2 added: Additive',
      'commands.ChargeCard@1 retired: Breaking, needs no Approval',
      `Would publish ${ordersPackage}@2.0.0 (major)`,
      '',
    ]);
  });

  test('a field key holding a line break is written as JSON, so the Change stays on one line', async ({
    lab,
  }) => {
    const changed = await aChangedProject(lab, {
      before: aRoot({ body: "z.object({ ok: z.boolean(), 'odd\\nkey': z.number() })" }),
      after: aRoot(),
    });

    const { ran } = await checkedAgainst(lab, changed);

    const approval = 'Breaking, needs a Breaking Change Approval';
    expect(ran.stdout.split('\n')).toEqual([
      checkedAgainstOrders,
      `endpoints.GET /ping (ping) schema field-removed at success.body."odd\\nkey": ${approval}`,
      `Would publish ${ordersPackage}@2.0.0 (major)`,
      '',
    ]);
  });

  test('a discriminator holding a line break is written as JSON, so the Change stays on one line', async ({
    lab,
  }) => {
    const union = (discriminator: string) =>
      [
        `z.object({ shape: z.discriminatedUnion('${discriminator}', [`,
        `z.object({ '${discriminator}': z.literal('a') }),`,
        `z.object({ '${discriminator}': z.literal('b') }),`,
        '])})',
      ].join(' ');
    const changed = await aChangedProject(lab, {
      before: aRoot({ body: union('odd\\nkind') }),
      after: aRoot({ body: union('kind') }),
    });

    const { ran } = await checkedAgainst(lab, changed);

    const approval = 'Breaking, needs a Breaking Change Approval';
    const change = 'endpoints.GET /ping (ping) schema discriminator-changed at success.body.shape';
    expect(ran.stdout.split('\n')).toEqual([
      checkedAgainstOrders,
      `${change} from="odd\\nkind" to=kind: ${approval}`,
      `Would publish ${ordersPackage}@2.0.0 (major)`,
      '',
    ]);
  });

  test.for([
    ['U+2028', '\\u2028'],
    ['U+2029', '\\u2029'],
    ['U+0085', '\\u0085'],
  ] as const)(
    'a field key holding %s is written escaped, so no reader splits the line there',
    async ([, sequence], { lab }) => {
      const changed = await aChangedProject(lab, {
        before: aRoot({ body: `z.object({ ok: z.boolean(), 'odd${sequence}key': z.number() })` }),
        after: aRoot(),
      });

      const { ran } = await checkedAgainst(lab, changed);

      const approval = 'Breaking, needs a Breaking Change Approval';
      const key = `"odd${sequence}key"`;
      expect(ran.stdout.split('\n')).toEqual([
        checkedAgainstOrders,
        `endpoints.GET /ping (ping) schema field-removed at success.body.${key}: ${approval}`,
        `Would publish ${ordersPackage}@2.0.0 (major)`,
        '',
      ]);
    },
  );

  test.for([
    ['U+2028', '\\u2028'],
    ['U+2029', '\\u2029'],
    ['U+0085', '\\u0085'],
  ] as const)(
    'an enum value holding %s is written escaped, so no reader splits the line there',
    async ([, sequence], { lab }) => {
      const body = (values: string) => `z.object({ kind: z.enum([${values}]) })`;
      const changed = await aChangedProject(lab, {
        before: aRoot({ body: body("'a'") }),
        after: aRoot({ body: body(`'a', 'b${sequence}c'`) }),
      });

      const { ran } = await checkedAgainst(lab, changed);

      const approval = 'Breaking, needs a Breaking Change Approval';
      const change = 'endpoints.GET /ping (ping) schema value-added at success.body.kind';
      expect(ran.stdout.split('\n')).toEqual([
        checkedAgainstOrders,
        `${change} value="b${sequence}c" enum=closed: ${approval}; ${openEnumHint}`,
        `Would publish ${ordersPackage}@2.0.0 (major)`,
        '',
      ]);
    },
  );

  test.for(['codes', 'guards', 'exports'] as const)(
    'a Baseline whose %s hold a name with a line break is written as JSON, so the Change stays on one line',
    async (section, { lab }) => {
      const project = await aGeneratedProject(lab, aDefinitionsRootOfEverySite);
      const snapshot = JSON.parse(read(project, 'contract.snapshot.json'));
      const [declared] = Object.values(snapshot[section]);
      const more = { [section]: { ...snapshot[section], 'odd\nname': declared } };
      const served = servedAs('@org/definitions', publishedAs(project, '1.0.0', more));

      const { ran } = await checkedAgainst(lab, { project, served });

      const approval = 'Breaking, needs a Breaking Change Approval';
      expect(ran.stdout.split('\n')).toEqual([
        'Checked against @org/definitions@1.0.0',
        `${section}."odd\\nname" removed: ${approval}`,
        'Would publish @org/definitions@2.0.0 (major)',
        '',
      ]);
    },
  );

  test.for([
    ['events', 'Order\nX@1', 'events.Order\\nX@1'],
    ['commands', 'Cmd\rX@1', 'commands.Cmd\\rX@1'],
    ['endpoints', 'GET /a\u0085b', 'endpoints.GET /a\\u0085b (ping)'],
  ] as const)(
    'a Baseline whose %s hold an identity with a line break is printed escaped, so the Change stays on one line',
    async ([section, key, site], { lab }) => {
      const changed = await aBaselineWithExtraKey(lab, section, key);

      const { ran } = await checkedAgainst(lab, changed);

      expect(ran.stdout.split('\n')).toEqual([
        checkedAgainstOrders,
        `${site} deleted: Breaking, refused; ${deletedHint}`,
        '',
      ]);
      expect(ran.stderr).toBe(`${refusedLine}\n`);
      expect(ran.status).toBe(1);
    },
  );

  test.for([
    ['U+2028', '\u2028', '\\u2028'],
    ['U+2029', '\u2029', '\\u2029'],
    ['U+0085', '\u0085', '\\u0085'],
  ] as const)(
    '--json writes a site holding %s escaped, so the document stays one line',
    async ([, character, visible], { lab }) => {
      const changed = await aBaselineWithExtraKey(lab, 'events', `Order${character}X@1`);

      const { ran } = await checkedAgainst(lab, changed, '--json');

      const [document, ...rest] = ran.stdout.split('\n');
      expect(rest).toEqual(['']);
      expect(document).toContain(`"identity":"Order${visible}X@1"`);
      expect(JSON.parse(document ?? '').changes).toEqual([
        expect.objectContaining({
          site: expect.objectContaining({ identity: `Order${character}X@1` }),
        }),
      ]);
      expect(ran.stderr).toBe(`${refusedLine}\n`);
    },
  );

  test('a Change that needs a Breaking Change Approval exits 2, saying how many', async ({
    lab,
  }) => {
    const changed = await aChangedProject(lab, removedSuccessField);

    const { ran } = await checkedAgainst(lab, changed);

    expect(ran).toEqual({
      status: 2,
      stdout: [
        checkedAgainstOrders,
        'endpoints.GET /ping (ping) schema field-removed at success.body.total: Breaking, needs a Breaking Change Approval',
        `Would publish ${ordersPackage}@2.0.0 (major)`,
        '',
      ].join('\n'),
      stderr: `${approvalNeededLine}\n`,
    });
  });

  test('a Breaking Change that needs no Approval exits 0', async ({ lab }) => {
    const changed = await aChangedProject(lab, retiredCommand);

    const { ran } = await checkedAgainst(lab, changed);

    expect(ran).toEqual({
      status: 0,
      stdout: [
        checkedAgainstOrders,
        'commands.ChargeCard@1 retired: Breaking, needs no Approval',
        'No Change needs a Breaking Change Approval',
        `Would publish ${ordersPackage}@1.0.1 (patch)`,
        '',
      ].join('\n'),
      stderr: '',
    });
  });

  test('a refused Change exits 1 and says the check failed', async ({ lab }) => {
    const changed = await aChangedProject(lab, removedEventField);

    const { ran } = await checkedAgainst(lab, changed);

    expect(ran).toEqual({
      status: 1,
      stdout: [
        checkedAgainstOrders,
        'events.OrderCreated@1 schema field-removed at body.placedAt (message): Breaking, refused; make the change in a new Message Version',
        '',
      ].join('\n'),
      stderr: `${refusedLine}\n`,
    });
  });

  test('a refused Change exits 1 even when another Change needs an Approval', async ({ lab }) => {
    const changed = await aChangedProject(lab, removedFieldOfEach);

    const { ran } = await checkedAgainst(lab, changed);

    expect(ran.status).toBe(1);
    expect(ran.stderr).toBe(`${refusedLine}\n`);
    expect(ran.stdout).toContain(
      'endpoints.GET /ping (ping) schema field-removed at success.body.total',
    );
  });

  test.for([
    ['retiring a Command', retiredCommand, 0, ''],
    ['removing an Event field', removedEventField, 1, `${refusedLine}\n`],
    ['removing a Success field', removedSuccessField, 2, `${approvalNeededLine}\n`],
  ] as const)(
    '--json writes exactly one line to stdout, the document, when %s',
    async ([, roots, status, stderr], { lab }) => {
      const changed = await aChangedProject(lab, roots);

      const { ran } = await checkedAgainst(lab, changed, '--json');

      expect(ran.status).toBe(status);
      expect(ran.stdout.split('\n')).toHaveLength(2);
      expect(ran.stderr).toBe(stderr);
      const document = JSON.parse(ran.stdout);
      expect(document).toMatchObject({
        status,
        package: ordersPackage,
        baseline: '1.0.0',
        reason: null,
      });
      expect(document.changes).toHaveLength(1);
    },
  );

  test('--json writes the Baseline and every Change', async ({ lab }) => {
    const changed = await aChangedProject(lab, removedSuccessField);

    const { ran } = await checkedAgainst(lab, changed, '--json');

    expect(JSON.parse(ran.stdout)).toEqual({
      format: 1,
      status: 2,
      errors: [
        '1 Breaking Change(s) need a Breaking Change Approval: your review process enforces it',
      ],
      package: ordersPackage,
      baseline: '1.0.0',
      stable: '1.0.0',
      reason: null,
      changes: [
        {
          site: { kind: 'endpoint', identity: 'GET /ping', name: 'ping', visibility: 'public' },
          difference: {
            kind: 'schema',
            position: 'success',
            at: ['success', 'body', 'fields', 'total'],
            shape: { kind: 'field-removed' },
          },
          path: 'success.body.total',
          class: 'breaking',
          verdict: 'approval-needed',
          hint: null,
        },
      ],
      peers: [],
      bump: 'major',
      version: '2.0.0',
      tag: 'latest',
    });
  });

  test('--json writes a Change with no path or hint as null', async ({ lab }) => {
    const changed = await aChangedProject(lab, retiredCommand);

    const { ran } = await checkedAgainst(lab, changed, '--json');

    expect(JSON.parse(ran.stdout).changes).toEqual([
      {
        site: { kind: 'command', identity: 'ChargeCard@1', visibility: 'private' },
        difference: { kind: 'retired' },
        path: null,
        class: 'breaking',
        verdict: 'allowed',
        hint: null,
      },
    ]);
  });

  test('--json without a Baseline gives the reason', async ({ lab }) => {
    const project = await aGeneratedProject(lab, aRoot());

    const { ran, registry } = await checkedAgainst(lab, { project, served: {} }, '--json');

    const reason = `it is not in ${registry.url}/ for the npm user tester: never published, or that login cannot read it`;
    expect(ran.status).toBe(0);
    expect(JSON.parse(ran.stdout)).toEqual({
      format: 1,
      status: 0,
      package: ordersPackage,
      baseline: null,
      stable: null,
      reason,
      changes: [],
      peers: [],
      bump: null,
      version: '1.0.0',
      tag: 'latest',
    });
  });

  test.for([
    [
      'a Root that breaks a rule',
      1,
      { 'package.json': JSON.stringify({ name: '@org/billing-service', type: 'module' }) },
    ],
    ['a contract.snapshot.json that is no JSON', 3, { 'contract.snapshot.json': '<<<<<<< HEAD\n' }],
  ] as const)(
    '--json gives the errors of %s, and stderr still carries their lines',
    async ([, status, broken], { lab }) => {
      const project = installedIn(lab.aFolder(), {
        'cf-loom.config.ts': config,
        ...aRoot(),
        ...broken,
      });

      const { ran } = await checkedAgainst(lab, { project, served: {} }, '--json');

      const lines = ran.stderr.trimEnd().split('\n');
      expect(ran.status).toBe(status);
      expect(ran.stdout.split('\n')).toHaveLength(2);
      expect(JSON.parse(ran.stdout)).toEqual({ format: 1, status, errors: lines });
      expect(lines.every((line) => line !== '')).toBe(true);
    },
  );
});

/** The sections of a Snapshot, as `publishedAs` takes them. */
type Sections = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

/** A project of `aMessagingRoot` whose Baseline holds the sections `more` makes of its Snapshot's. */
async function aMessagingProjectBaselinedAs(
  lab: Lab,
  more: (sections: Sections) => Sections,
): Promise<Checkable> {
  const project = await aGeneratedProject(lab, aMessagingRoot());
  const sections: Sections = JSON.parse(read(project, 'contract.snapshot.json'));
  return {
    project,
    served: servedAs(ordersPackage, publishedAs(project, '1.0.0', more(sections))),
  };
}

/** `aRoot` as a POST that reads `input`, for a Change an Input part makes. */
function aRootReading(input: string): Files {
  const root = aRoot();
  const endpoint = (root['src/contract/ping.endpoint.ts'] ?? '')
    .replace("method: 'GET'", "method: 'POST'")
    .replace('  success:', `  input: ${input},\n  success:`);
  return { ...root, 'src/contract/ping.endpoint.ts': endpoint };
}

/** `aRoot` whose Endpoint answers the Rejections of the codes given. */
function aRootAnswering(codes: readonly string[]): Files {
  const root = aRoot();
  const message = (code: string) => `{ code: '${code}', status: 409, message: '${code}' }`;
  const declared = codes.map((code) => `const reject${code} = defineRejection(${message(code)});`);
  const listed = codes.map((code) => `reject${code}`).join(', ');
  const endpoint = (root['src/contract/ping.endpoint.ts'] ?? '')
    .replace('import { defineEndpoint }', 'import { defineEndpoint, defineRejection }')
    .replace('export const ping', `${declared.join('\n')}\nexport const ping`)
    .replace('  success:', `  rejections: [${listed}],\n  success:`);
  return { ...root, 'src/contract/ping.endpoint.ts': endpoint };
}

/** `aRoot` with the Endpoint's declaration edited, as a Visibility change is. */
function aRootEdited(from: string, to: string): Files {
  const root = aRoot();
  const endpoint = (root['src/contract/ping.endpoint.ts'] ?? '').replace(from, to);
  return { ...root, 'src/contract/ping.endpoint.ts': endpoint };
}

/** `aRoot` with the Endpoint named and exported as `pong`. */
function aRootRenamed(): Files {
  const root = aRoot();
  const endpoint = (root['src/contract/ping.endpoint.ts'] ?? '')
    .replace("name: 'ping'", "name: 'pong'")
    .replace('export const ping', 'export const pong');
  const index = (root['src/contract/index.ts'] ?? '')
    .replace('{ ping }', '{ pong }')
    .replace('[ping]', '[pong]');
  return { ...root, 'src/contract/ping.endpoint.ts': endpoint, 'src/contract/index.ts': index };
}

/** A project whose Private Endpoint `ping` was published, then became the Public Endpoint `pong`. */
async function aRenamedAndWidenedProject(lab: Lab): Promise<Checkable> {
  const before = aRootEdited("visibility: 'public'", "visibility: 'private'");
  const project = await aGeneratedProject(lab, before);
  const served = servedAs(ordersPackage, publishedAs(project, '1.0.0'));
  rmSync(join(project, 'src/endpoints/health/ping.handler.ts'));
  write(project, aRootRenamed());
  await generateIn(lab, project);
  return { project, served };
}

const nestedVariants = (variants: string) =>
  [
    'z.object({ orders: z.array(z.object({ lines: z.array(z.object({',
    `kind: z.discriminatedUnion('type', [${variants}]) })) })) })`,
  ].join(' ');

const needsApproval = 'Breaking, needs a Breaking Change Approval';

/** A Change as `check --json` prints it, as far as the lines are compared with it. */
type JsonChange = {
  readonly difference: { readonly shape?: Record<string, unknown> } & Record<string, unknown>;
  readonly path: string | null;
};

/** The fields a Change line prints as `name=value`, before its class; a `value` stays the JSON it is printed as. */
function printedFieldsOf(line: string): readonly (readonly [string, string])[] {
  const described = line.slice(0, line.lastIndexOf(': '));
  const printed = described.matchAll(/ ([A-Za-z]+)=("(?:[^"\\]|\\.)*"|[^\s:]+)/g);
  return [...printed].map(([, name = '', text = '']) => {
    const isQuoted = text.startsWith('"') && name !== 'value';
    return [name, isQuoted ? JSON.parse(text) : text];
  });
}

/** The same fields as the JSON of a Change holds them. */
function jsonFieldsOf({ difference }: JsonChange): readonly (readonly [string, string])[] {
  const { shape, ...own } = difference;
  const named = [...Object.entries(own), ...Object.entries(shape ?? {})];
  const unworded = named.filter(([name]) => !['kind', 'at', 'position'].includes(name));
  return unworded.map(([name, value]) => [
    name,
    name === 'value' ? JSON.stringify(value) : String(value),
  ]);
}

/** The path a Change line prints after `at`, or null when it prints none. */
function printedPathOf(line: string): string | null {
  return / at (\S+?)(?::| |$)/.exec(line)?.[1] ?? null;
}

describe.concurrent('cf-loom check, a Change in the author’s terms', {
  timeout: checkTimeout,
}, () => {
  test('a difference in a variant inside nested arrays is at a path in the author’s terms', async ({
    lab,
  }) => {
    const variants = (fields: string) =>
      `z.object({ type: z.literal('a')${fields} }), z.object({ type: z.literal('b') })`;
    const changed = await aChangedProject(lab, {
      before: aRoot({ body: nestedVariants(variants(', x: z.number()')) }),
      after: aRoot({ body: nestedVariants(variants('')) }),
    });

    const { ran } = await checkedAgainst(lab, changed);

    expect(ran.stdout.split('\n')).toEqual([
      checkedAgainstOrders,
      `endpoints.GET /ping (ping) schema field-removed at success.body.orders[].lines[].kind<type="a">.x: ${needsApproval}`,
      `Would publish ${ordersPackage}@2.0.0 (major)`,
      '',
    ]);
  });

  test.for([
    [
      'a record’s value',
      'z.object({ prices: z.record(z.string(), z.object({ amount: z.number(), note: z.string() })) })',
      'z.object({ prices: z.record(z.string(), z.object({ amount: z.number() })) })',
      'schema field-removed at success.body.prices{}.note',
    ],
    [
      'a record’s key',
      'z.object({ prices: z.record(z.string().min(1), z.number()) })',
      'z.object({ prices: z.record(z.string(), z.number()) })',
      'schema constraint-relaxed at success.body.prices{key} constraint=lower-bound',
    ],
    [
      'a tuple’s rest',
      'z.object({ pair: z.tuple([z.string()]) })',
      'z.object({ pair: z.tuple([z.string()]).rest(z.number()) })',
      'schema rest-added at success.body.pair[...]',
    ],
  ] as const)(
    '%s is written in the notation of a record and a tuple',
    async ([, before, after, change], { lab }) => {
      const changed = await aChangedProject(lab, {
        before: aRoot({ body: before }),
        after: aRoot({ body: after }),
      });

      const { ran } = await checkedAgainst(lab, changed);

      expect(ran.stdout.split('\n')).toEqual([
        checkedAgainstOrders,
        `endpoints.GET /ping (ping) ${change}: ${needsApproval}`,
        `Would publish ${ordersPackage}@2.0.0 (major)`,
        '',
      ]);
    },
  );

  test('a Guard’s demand is written with the Position it is read in', async ({ lab }) => {
    const project = await aGeneratedProject(lab, aDefinitionsRootOfEverySite);
    const snapshot = JSON.parse(read(project, 'contract.snapshot.json'));
    const token = {
      type: 'object',
      fields: { token: { required: true, schema: { type: 'string' } } },
    };
    const guards = {
      apiKey: {
        ...snapshot.guards.apiKey,
        demands: { headers: { type: 'object', fields: {} }, query: token },
      },
    };
    const served = servedAs('@org/definitions', publishedAs(project, '1.0.0', { guards }));

    const { ran } = await checkedAgainst(lab, { project, served });

    expect(ran.stdout.split('\n')).toEqual([
      'Checked against @org/definitions@1.0.0',
      'guards.apiKey schema field-removed at demands.query.token (input): Additive',
      'No Change needs a Breaking Change Approval',
      'Would publish @org/definitions@1.1.0 (minor)',
      '',
    ]);
  });

  test('an exported schema’s root difference has no path, and says it is judged as a Message', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aDefinitionsRootOfEverySite);
    const { exports } = JSON.parse(read(project, 'contract.snapshot.json'));
    const money = { kind: 'schema', schema: { type: 'string' } };
    const served = servedAs(
      '@org/definitions',
      publishedAs(project, '1.0.0', { exports: { ...exports, money } }),
    );
    const changed = { project, served };

    const lines = await checkedAgainst(lab, changed);
    const json = await checkedAgainst(lab, changed, '--json');

    expect(lines.ran.stdout.split('\n')[1]).toBe(
      `exports.money schema type-changed (message) from=string to=object: ${needsApproval}`,
    );
    expect(JSON.parse(json.ran.stdout).changes[0].path).toBeNull();
  });

  test('check --json gives a renamed export’s Changes sites of kind export', async ({ lab }) => {
    const project = await aGeneratedProject(lab, aDefinitionsRootOfEverySite);
    const { exports } = JSON.parse(read(project, 'contract.snapshot.json'));
    const { money, ...others } = exports;
    const served = servedAs(
      '@org/definitions',
      publishedAs(project, '1.0.0', { exports: { ...others, amount: money } }),
    );

    const { ran } = await checkedAgainst(lab, { project, served }, '--json');

    const sites = JSON.parse(ran.stdout).changes.map(({ site }: { site: unknown }) => site);
    expect(sites).toEqual([
      { kind: 'export', name: 'amount', visibility: 'public' },
      { kind: 'export', name: 'money', visibility: 'public' },
    ]);
  });

  test('two Rejections removed from an Endpoint are two Changes, each naming its code', async ({
    lab,
  }) => {
    const changed = await aChangedProject(lab, {
      before: aRootAnswering(['A', 'D']),
      after: aRootAnswering([]),
    });

    const { ran } = await checkedAgainst(lab, changed, '--json');

    const differences = JSON.parse(ran.stdout).changes.map(
      (change: { difference: unknown }) => change.difference,
    );
    expect(differences).toEqual([
      { kind: 'rejection-removed', code: 'A' },
      { kind: 'rejection-removed', code: 'D' },
    ]);
  });

  test('--json writes a changed status with its from and to', async ({ lab }) => {
    const changed = await aChangedProject(lab, { before: aRoot(), after: aRoot({ status: 201 }) });

    const { ran } = await checkedAgainst(lab, changed, '--json');

    const [change] = JSON.parse(ran.stdout).changes;
    expect(change.difference).toEqual({ kind: 'status-changed', from: 200, to: 201 });
  });

  test('renaming an Endpoint while widening its Visibility is a Neutral rename of the Baseline’s Visibility', async ({
    lab,
  }) => {
    const changed = await aRenamedAndWidenedProject(lab);

    const { ran } = await checkedAgainst(lab, changed);

    expect(ran.stdout.split('\n')).toEqual([
      checkedAgainstOrders,
      'endpoints.GET /ping (pong) visibility-widened from=private to=public: Additive',
      'endpoints.GET /ping (pong) renamed from=ping to=pong baselineVisibility=private: Neutral',
      'No Change needs a Breaking Change Approval',
      `Would publish ${ordersPackage}@1.1.0 (minor)`,
      '',
    ]);
  });

  test('a Message Version added past a gap is Additive and refused, so check exits 1', async ({
    lab,
  }) => {
    const changed = await aChangedProject(lab, {
      before: aMessagingRoot({ eventVersions: [1] }),
      after: aMessagingRoot({ eventVersions: [1, 3] }),
    });

    const { ran } = await checkedAgainst(lab, changed);

    expect(ran).toEqual({
      status: 1,
      stdout: [
        checkedAgainstOrders,
        'events.OrderCreated@3 added: Additive',
        'events.OrderCreated@3 version-gap missing=OrderCreated@2: Additive, refused',
        '',
      ].join('\n'),
      stderr: 'The check failed: 1 Change(s) refused\n',
    });
  });

  const hintRows = [
    [
      'deleting an Event, which also fits a new Message Version',
      (lab: Lab) => aBaselineWithExtraKey(lab, 'events', 'OrderPlaced@1'),
      'events.OrderPlaced@1 deleted: Breaking, refused',
      'retire it instead, deprecating it first if it is not, and delete it once the Baseline has it Retired',
    ],
    [
      'retiring an Endpoint that is not Deprecated',
      (lab: Lab) =>
        aChangedProject(lab, { before: aRoot(), after: aRoot({ lifecycle: 'retired' }) }),
      'endpoints.GET /ping (ping) retired-before-deprecated: Breaking, refused',
      'deprecate it in one publish and retire it in a later one',
    ],
    [
      'adding an optional header that refuses some text',
      (lab: Lab) =>
        aChangedProject(lab, {
          before: aRootReading('{ headers: z.object({}) }'),
          after: aRootReading('{ headers: z.object({ "x-trace": z.string().min(3).optional() }) }'),
        }),
      `endpoints.POST /ping (ping) header-refuses-text at input.headers.x-trace: ${needsApproval}`,
      'accept any text',
    ],
    [
      'adding a value to a closed enum',
      (lab: Lab) =>
        aChangedProject(lab, {
          before: aRoot({ body: "z.object({ kind: z.enum(['a']) })" }),
          after: aRoot({ body: "z.object({ kind: z.enum(['a', 'b']) })" }),
        }),
      `endpoints.GET /ping (ping) schema value-added at success.body.kind value="b" enum=closed: ${needsApproval}`,
      openEnumHint,
    ],
    [
      'adding a required field to an Input body',
      (lab: Lab) =>
        aChangedProject(lab, {
          before: aRootReading('{ body: z.object({ a: z.string() }) }'),
          after: aRootReading('{ body: z.object({ a: z.string(), b: z.string() }) }'),
        }),
      `endpoints.POST /ping (ping) schema field-added at input.body.b required=true: ${needsApproval}`,
      'make it optional',
    ],
    [
      'removing a field from an Event’s body',
      (lab: Lab) => aChangedProject(lab, removedEventField),
      'events.OrderCreated@1 schema field-removed at body.placedAt (message): Breaking, refused',
      'make the change in a new Message Version',
    ],
    [
      'adding a value to a closed enum of an Event’s body, which openEnum would not allow either',
      (lab: Lab) =>
        aChangedProject(lab, {
          before: aMessagingRoot({ eventBody: "z.object({ kind: z.enum(['a']) })" }),
          after: aMessagingRoot({ eventBody: "z.object({ kind: z.enum(['a', 'b']) })" }),
        }),
      'events.OrderCreated@1 schema value-added at body.kind (message) value="b" enum=closed: Breaking, refused',
      'make the change in a new Message Version',
    ],
    [
      'declaring a Retired Message Version again',
      (lab: Lab) =>
        aMessagingProjectBaselinedAs(lab, ({ events = {} }) => ({
          events: { ...events, 'OrderCreated@1': { lifecycle: 'retired', retiredIn: '0.9.0' } },
        })),
      'events.OrderCreated@1 identity-reused: Breaking, refused',
      'make the change in a new Message Version',
    ],
    [
      'declaring a Command under the name of an Event',
      (lab: Lab) =>
        aMessagingProjectBaselinedAs(lab, ({ events = {} }) => ({
          events: { ...events, 'ChargeCard@1': Object.values(events)[0] ?? {} },
          commands: {},
        })),
      'commands.ChargeCard@1 name-kind-changed from=event: Breaking, refused',
      'declare it under a new name',
    ],
  ] as const;

  test.for(hintRows)(
    '%s ends the line with its hint, and the JSON carries it',
    async ([, setup, line, hint], { lab }) => {
      const changed = await setup(lab);

      const lines = await checkedAgainst(lab, changed);
      const json = await checkedAgainst(lab, changed, '--json');

      expect(lines.ran.stdout.split('\n')).toContain(`${line}; ${hint}`);
      expect(
        JSON.parse(json.ran.stdout).changes.map((change: { hint: string }) => change.hint),
      ).toContain(hint);
    },
  );

  const drifting = [
    ['a Service changed in every way', (lab: Lab) => aChangedProject(lab, changedInEveryWay)],
    ['an Endpoint renamed while it is widened', aRenamedAndWidenedProject],
    ...hintRows.map(([name, setup]) => [name, setup] as const),
  ] as const;

  test.for(drifting)(
    'every name=value a Change line prints is in its JSON, and so is its path: %s',
    async ([, setup], { lab }) => {
      const changed = await setup(lab);

      const lines = await checkedAgainst(lab, changed);
      const json = await checkedAgainst(lab, changed, '--json');

      const printed = lines.ran.stdout.split('\n').filter((line) => line.includes(': '));
      const changes: JsonChange[] = JSON.parse(json.ran.stdout).changes;
      expect(printed.map(printedPathOf)).toEqual(changes.map((change) => change.path));
      expect(printed.map(printedFieldsOf)).toEqual(changes.map(jsonFieldsOf));
    },
  );

  test.for([
    ['a document with a Baseline', true],
    ['a document without one', false],
  ] as const)('--json writes %s with its format', async ([, hasBaseline], { lab }) => {
    const project = await aGeneratedProject(lab, aRoot());
    const published = servedAs(ordersPackage, publishedAs(project, '1.0.0'));
    const served = hasBaseline ? published : {};

    const { ran } = await checkedAgainst(lab, { project, served }, '--json');

    expect(JSON.parse(ran.stdout).format).toBe(1);
  });
});

const publishTimeout = 120_000;
const stagingFolder = 'node_modules/.cache/cf-loom';

/** The Roots of `removedSuccessField` the other way round: a Success field added. */
const addedSuccessField = {
  before: removedSuccessField.after,
  after: removedSuccessField.before,
};

/** A Service that declares no Endpoint, Event or Command. */
const aRootWithoutEndpoints: Files = {
  'src/contract/index.ts': [
    "import { defineService } from '@cf-loom/contract';",
    "export const contract = defineService({ name: 'orders-service', groups: [] });",
    '',
  ].join('\n'),
};

/** The Root file of a Definitions Package, which exports what is given besides `definitions`. */
function aDefinitionsModule(exported: readonly string[] = []): string {
  const imports =
    "import { defineDefinitions, defineGuard, defineRejection } from '@cf-loom/contract';";
  return [imports, ...exported, 'export const definitions = defineDefinitions({});', ''].join('\n');
}

const aMoney = [
  "import { z } from 'zod';",
  'export const money = z.object({ amount: z.number() });',
].join('\n');
const anApiKey = "export const apiKey = defineGuard({ name: 'apiKey', description: 'A key' });";
const aGone =
  "export const gone = defineRejection({ code: 'GONE', status: 410, message: 'Gone' });";
const aGuardNamedWithAnUnderscore =
  "export const apiKey = defineGuard({ name: 'api_key', description: 'A key' });";

/**
 * The Definitions Package `@org/definitions` as its author left it once built: its `dist` is the
 * JavaScript of `source` unless `built` says it was built from other source.
 */
function aBuiltDefinitions(
  manifest: Readonly<Record<string, unknown>> = {},
  { source = aDefinitionsModule(), built = source }: { source?: string; built?: string } = {},
): Files {
  return {
    ...aDefinitionsRoot,
    'package.json': JSON.stringify({
      name: '@org/definitions',
      version: '0.0.0',
      type: 'module',
      exports: './dist/index.js',
      files: ['dist'],
      ...manifest,
    }),
    'src/definitions/index.ts': source,
    'dist/index.js': built,
    'dist/index.d.ts': 'export {};\n',
  };
}

/** Runs `publish` against a registry that serves what is given, with the login of the lab. */
function publishedAgainst(lab: Lab, changed: Checkable, ...args: string[]) {
  return ranAgainst(lab, changed, 'publish', ...args);
}

/** What npm put to the registry, without the bytes of the tarballs. */
function putsOf(registry: Registry) {
  return registry.published.map(({ name, version, distTags }) => ({ name, version, distTags }));
}

/** Every `PUT` the registry was sent, whether it took it or not. */
function putRequestsOf(registry: Registry) {
  return registry.requests.filter((request) => request.method === 'PUT');
}

/** The files of the one version npm put to the registry, by path. */
function publishedFilesOf(registry: Registry): Readonly<Record<string, string>> {
  const [put] = registry.published;
  return entriesOf(put!.tarball);
}

/** The entries of a project's top level that `generate` and the test's own files make. */
const projectEntries = [
  'cf-loom.config.ts',
  'contract.snapshot.json',
  'dist',
  'node_modules',
  'package.json',
  'src',
];

/** What `publish` left behind: the folders in its staging place, and any entry at the project's top level that is not the project's. */
function leftBehindIn(project: string): string[] {
  const folder = join(project, stagingFolder);
  const staged = existsSync(folder) ? readdirSync(folder) : [];
  const strays = readdirSync(project).filter((name) => !projectEntries.includes(name));
  return [...staged, ...strays];
}

/** Puts a package named typescript in the project, whose `tsc` runs the script given and is called with `-p <folder>`. */
function withTsc(project: string, script: string): void {
  rmSync(join(project, 'node_modules/typescript'));
  const manifest = { name: 'typescript', version: '7.0.0', bin: { tsc: './bin/tsc' } };
  write(project, {
    'node_modules/typescript/package.json': JSON.stringify(manifest),
    'node_modules/typescript/bin/tsc': script,
  });
}

/** A `tsc` that writes a built package, makes the folder it stages packages in read-only, then runs `ending`. */
function aTscThatLocksItsStaging(ending: string): string {
  return [
    "const { chmodSync, mkdirSync, writeFileSync } = require('node:fs');",
    "const { basename, dirname, join } = require('node:path');",
    'const folder = process.argv[3];',
    "mkdirSync(join(folder, 'dist'), { recursive: true });",
    "writeFileSync(join(folder, 'dist/index.js'), 'export {};\\n');",
    "writeFileSync(join(folder, 'dist/index.d.ts'), 'export {};\\n');",
    'let place = folder;',
    "while (basename(place) !== 'cf-loom') place = dirname(place);",
    'chmodSync(place, 0o555);',
    ending,
  ].join('\n');
}

/** The line that names a staging folder `publish` could not remove. */
const leftBehindLine =
  /^node_modules\/\.cache\/cf-loom\/publish-\w+ was left behind: [^\n]+: delete it\n$/;

/** The SHA-256 of a Snapshot's canonical text without its version and generator, as `cfLoom` records it. */
function snapshotHashOf(snapshotJson: string): string {
  const { generator: _generator, version: _version, ...hashed } = JSON.parse(snapshotJson);
  return createHash('sha256').update(canonicalTextOf(hashed), 'utf8').digest('hex');
}

function neverPublished(registry: Registry, packageName = ordersPackage): string {
  const why = `it is not in ${registry.url}/ for the npm user tester: never published, or that login cannot read it`;
  return `${packageName} has no Baseline: ${why}`;
}

const anotherPeer = '^2.0.0';
const otherPeerMeta = { '@org/other': { optional: true } };

/** The manifest fields of a Definitions Package with the peer `@org/other` at `range`, and the two cf-loom peers as a monorepo writes them. */
function withOtherPeer(range: string): Readonly<Record<string, unknown>> {
  const peerDependencies = {
    '@cf-loom/contract': 'workspace:^',
    zod: 'catalog:',
    '@org/other': range,
  };
  return { peerDependencies, peerDependenciesMeta: otherPeerMeta };
}

/** A version of `@org/definitions` as its project would publish it with the peer `@org/other` at `range`. */
function publishedWithOtherPeer(project: string, range: string): ServedVersion {
  const baseline = publishedAs(project, '1.0.0');
  const peerDependencies = { ...installedPeers, '@org/other': range };
  return { ...baseline, manifest: { ...baseline.manifest, peerDependencies } };
}

describe.concurrent('cf-loom check, the version publish would take', {
  timeout: checkTimeout,
}, () => {
  const wouldPublish = (version: string, why: string) =>
    `Would publish ${ordersPackage}@${version} (${why})`;
  const neutralLine = 'endpoints.GET /ping (ping) description-changed: Neutral';
  const noApprovalNeeded = 'No Change needs a Breaking Change Approval';
  const reworded = { before: aRoot(), after: aRoot({ description: 'Reads' }) };
  const refusedGap = { before: aMessagingRoot(), after: aMessagingRoot({ eventVersions: [1, 3] }) };
  const zodLine = Number(zodVersion.split('.')[0]);

  test('a Neutral Change is printed, and check closes with the patch publish would take', async ({
    lab,
  }) => {
    const changed = await aChangedProject(lab, reworded);

    const { ran } = await checkedAgainst(lab, changed);

    expect(ran).toEqual({
      status: 0,
      stdout: [
        checkedAgainstOrders,
        neutralLine,
        noApprovalNeeded,
        wouldPublish('1.0.1', 'patch'),
        '',
      ].join('\n'),
      stderr: '',
    });
  });

  test('a moved deprecatedAt is a Neutral Change, and check closes with the patch publish would take', async ({
    lab,
  }) => {
    const changed = await aChangedProject(lab, {
      before: aRoot({ lifecycle: 'deprecated', deprecatedAt: '2026-01-01T00:00:00Z' }),
      after: aRoot({ lifecycle: 'deprecated', deprecatedAt: '2026-06-01T00:00:00Z' }),
    });

    const { ran } = await checkedAgainst(lab, changed);

    expect(ran).toEqual({
      status: 0,
      stdout: [
        checkedAgainstOrders,
        'endpoints.GET /ping (ping) deprecation-moved from="2026-01-01T00:00:00Z" to="2026-06-01T00:00:00Z": Neutral',
        noApprovalNeeded,
        wouldPublish('1.0.1', 'patch'),
        '',
      ].join('\n'),
      stderr: '',
    });
  });

  test('a changed Group description is a Neutral Change at the Group, and check closes with the patch publish would take', async ({
    lab,
  }) => {
    const changed = await aChangedProject(lab, {
      before: aRoot(),
      after: aRoot({ groupDescription: 'Whether the Service is up' }),
    });

    const { ran } = await checkedAgainst(lab, changed);

    expect(ran).toEqual({
      status: 0,
      stdout: [
        checkedAgainstOrders,
        'groups.health description-changed: Neutral',
        noApprovalNeeded,
        wouldPublish('1.0.1', 'patch'),
        '',
      ].join('\n'),
      stderr: '',
    });
  });

  test('check --json of a Neutral Change has the bump, the version and the dist-tag publish would take', async ({
    lab,
  }) => {
    const changed = await aChangedProject(lab, reworded);

    const { ran } = await checkedAgainst(lab, changed, '--json');

    expect(JSON.parse(ran.stdout)).toMatchObject({
      status: 0,
      peers: [],
      bump: 'patch',
      version: '1.0.1',
      tag: 'latest',
    });
  });

  test('a Breaking Change that needs an Approval still closes with the major publish would take', async ({
    lab,
  }) => {
    const changed = await aChangedProject(lab, removedSuccessField);

    const { ran } = await checkedAgainst(lab, changed);

    expect(ran.status).toBe(2);
    expect(ran.stdout.split('\n').slice(-3)).toEqual([
      'endpoints.GET /ping (ping) schema field-removed at success.body.total: Breaking, needs a Breaking Change Approval',
      wouldPublish('2.0.0', 'major'),
      '',
    ]);
    expect(ran.stderr).toBe(`${approvalNeededLine}\n`);
  });

  test('a refused Change closes with no version: check exits 1 and its --json nulls them', async ({
    lab,
  }) => {
    const changed = await aChangedProject(lab, refusedGap);

    const lines = await checkedAgainst(lab, changed);
    const json = await checkedAgainst(lab, changed, '--json');

    expect(lines.ran.status).toBe(1);
    expect(lines.ran.stdout).not.toContain('Would publish');
    expect(JSON.parse(json.ran.stdout)).toMatchObject({
      status: 1,
      bump: null,
      version: null,
      tag: null,
    });
    const kinds = JSON.parse(json.ran.stdout).changes.map(
      ({ difference }: { difference: { kind: string } }) => difference.kind,
    );
    expect(kinds).toContain('version-gap');
  });

  test('a Standard Rejection that resolved to another code in the Baseline is a Neutral Change at its own site', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aRoot());
    const snapshot = JSON.parse(read(project, 'contract.snapshot.json'));
    const { NOT_FOUND: standard, ...others } = snapshot.codes;
    const resolved = { ...snapshot.standardRejections, notFound: 'ORDER_GONE' };
    const codes = { ...others, ['ORDER_GONE']: standard };
    const more = { standardRejections: resolved, codes };
    const served = servedAs(ordersPackage, publishedAs(project, '1.0.0', more));

    const lines = await checkedAgainst(lab, { project, served });
    const json = await checkedAgainst(lab, { project, served }, '--json');

    expect(lines.ran).toEqual({
      status: 0,
      stdout: [
        checkedAgainstOrders,
        'standardRejections.notFound code-changed from=ORDER_GONE to=NOT_FOUND: Neutral',
        noApprovalNeeded,
        wouldPublish('1.0.1', 'patch'),
        '',
      ].join('\n'),
      stderr: '',
    });
    expect(JSON.parse(json.ran.stdout).changes).toMatchObject([
      {
        site: { kind: 'standard-rejection', name: 'notFound', visibility: 'private' },
        difference: { kind: 'code-changed', from: 'ORDER_GONE', to: 'NOT_FOUND' },
        class: 'neutral',
      },
    ]);
  });

  test('a Snapshot and peer ranges equal to the Baseline’s are nothing to publish, with no --force clause', async ({
    lab,
  }) => {
    const changed = await aChangedProject(lab, { before: aRoot(), after: aRoot() });

    const lines = await checkedAgainst(lab, changed);
    const json = await checkedAgainst(lab, changed, '--json');

    const same = `${ordersPackage}@1.0.0`;
    expect(lines.ran).toEqual({
      status: 0,
      stdout: `${checkedAgainstOrders}\nNothing to publish: the Snapshot and peer ranges are those of ${same}\n`,
      stderr: '',
    });
    expect(JSON.parse(json.ran.stdout)).toMatchObject({ bump: null, version: null, tag: null });
  });

  test('a peer moving to a new major is printed and derives a major with no Change line', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aRoot());
    const older = withPeers(publishedAs(project, '1.0.0'), {
      ...installedPeers,
      zod: `^${zodLine - 1}.0.0`,
    });

    const lines = await checkedAgainst(lab, { project, served: servedAs(ordersPackage, older) });
    const json = await checkedAgainst(
      lab,
      { project, served: servedAs(ordersPackage, older) },
      '--json',
    );

    const move = `Peer zod moves from ^${zodLine - 1}.0.0 to ^${zodVersion}: major`;
    expect(lines.ran).toEqual({
      status: 0,
      stdout: [checkedAgainstOrders, move, wouldPublish('2.0.0', 'major'), ''].join('\n'),
      stderr: '',
    });
    expect(JSON.parse(json.ran.stdout)).toMatchObject({
      changes: [],
      peers: [{ name: 'zod', from: `^${zodLine - 1}.0.0`, to: `^${zodVersion}`, bump: 'major' }],
      bump: 'major',
      version: '2.0.0',
    });
  });

  test('a peer moving within its line is printed as minor and derives a minor', async ({ lab }) => {
    const project = await aGeneratedProject(lab, aRoot());
    const older = withPeers(publishedAs(project, '1.0.0'), {
      ...installedPeers,
      zod: `^${zodLine}.0.0`,
    });

    const { ran } = await checkedAgainst(lab, { project, served: servedAs(ordersPackage, older) });

    const move = `Peer zod moves from ^${zodLine}.0.0 to ^${zodVersion}: minor`;
    expect(ran.stdout).toBe(
      [checkedAgainstOrders, move, wouldPublish('1.1.0', 'minor'), ''].join('\n'),
    );
  });

  test('check --prerelease derives the prerelease publish --prerelease would take, tagged next over a stable version', async ({
    lab,
  }) => {
    const changed = await aChangedProject(lab, addedSuccessField);

    const stable = await checkedAgainst(lab, changed, '--json');
    const prerelease = await checkedAgainst(lab, changed, '--prerelease', '--json');

    expect(JSON.parse(stable.ran.stdout)).toMatchObject({ version: '1.1.0', tag: 'latest' });
    expect(JSON.parse(prerelease.ran.stdout)).toMatchObject({ version: '1.1.0-0', tag: 'next' });
  });

  test('check --prerelease over only prereleases is tagged latest', async ({ lab }) => {
    const changed = await aChangedProjectListing(lab, addedSuccessField, ['1.0.0-0']);

    const { ran } = await checkedAgainst(lab, changed, '--prerelease', '--json');

    expect(JSON.parse(ran.stdout)).toMatchObject({ version: '1.0.0-1', tag: 'latest' });
  });

  test('--against closes with no version, with --prerelease too', async ({ lab }) => {
    const changed = await aProjectPublishedTwice(lab);

    const plain = await checkedAgainst(lab, changed, '--against', '1.0.0');
    const prerelease = await checkedAgainst(
      lab,
      changed,
      '--against',
      '1.0.0',
      '--prerelease',
      '--json',
    );

    expect(plain.ran.stdout).not.toContain('Would publish');
    expect(JSON.parse(prerelease.ran.stdout)).toMatchObject({
      peers: [],
      bump: null,
      version: null,
      tag: null,
    });
  });

  test('a package never published closes with 1.0.0 as its first version, or 1.0.0-0 with --prerelease', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aRoot());

    const first = await checkedAgainst(lab, { project, served: {} });
    const prerelease = await checkedAgainst(lab, { project, served: {} }, '--prerelease');

    expect(first.ran).toEqual({
      status: 0,
      stdout: `${neverPublished(first.registry)}\n${wouldPublish('1.0.0', 'first version')}\n`,
      stderr: '',
    });
    expect(prerelease.ran.stdout.split('\n')[1]).toBe(wouldPublish('1.0.0-0', 'first version'));
  });

  test('a package never published with a Message Version after a gap prints the refused Change and no version', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aMessagingRoot({ eventVersions: [1, 3] }));

    const { ran } = await checkedAgainst(lab, { project, served: {} }, '--json');

    expect(ran.status).toBe(1);
    expect(JSON.parse(ran.stdout)).toMatchObject({ bump: null, version: null, tag: null });
  });

  test('an unchanged package whose Baseline is a prerelease closes with the promotion', async ({
    lab,
  }) => {
    const changed = await aChangedProject(lab, { before: aRoot(), after: aRoot() }, ['1.1.0-0']);

    const plain = await checkedAgainst(lab, changed);
    const prerelease = await checkedAgainst(lab, changed, '--prerelease');

    expect(plain.ran.stdout.split('\n').at(-2)).toBe(wouldPublish('1.1.0', 'promotes 1.1.0-0'));
    expect(prerelease.ran.stdout.split('\n').at(-2)).toBe(
      `Nothing to publish: the Snapshot and peer ranges are those of ${ordersPackage}@1.1.0-0`,
    );
  });

  test('--prerelease over a hand-published prerelease the derived one would not be above exits 3, as publish does', async ({
    lab,
  }) => {
    const changed = await aChangedProject(lab, addedSuccessField, ['1.1.0-rc.1']);

    const { ran } = await checkedAgainst(lab, changed, '--prerelease');

    expect(ran.status).toBe(3);
    expect(ran.stdout).not.toContain('Would publish');
    expect(ran.stderr).toBe(
      `${ordersPackage}@1.1.0-0 would not be above the Baseline 1.1.0-rc.1: publish a version above it by hand\n`,
    );
  });
});

describe.concurrent('cf-loom publish', { timeout: publishTimeout }, () => {
  test('publish fails when contract.snapshot.json is out of date, before it reads the registry', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aRoot());
    write(project, aRoot({ body: 'z.object({ ok: z.boolean(), at: z.iso.datetime() })' }));

    const { ran, registry } = await publishedAgainst(lab, { project, served: {} });

    expect(ran).toEqual({ status: 1, stdout: '', stderr: `${staleSnapshot}\n` });
    expect(registry.requests).toEqual([]);
  });

  test('a Root that breaks a rule fails publish with generate’s lines, and nothing is published', async ({
    lab,
  }) => {
    const broken = {
      'package.json': JSON.stringify({ name: '@org/billing-service', type: 'module' }),
    };
    const files = { 'cf-loom.config.ts': config, ...aRoot(), ...broken };
    const project = installedIn(lab.aFolder(), files);

    const { ran, registry } = await publishedAgainst(lab, { project, served: {} });

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr:
        'name package-name: A Root is named as its package.json, without the scope: billing-service\n',
    });
    expect(registry.requests).toEqual([]);
  });

  test('a Service never published whose Message Versions leave a gap publishes nothing and exits 1', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aMessagingRoot({ eventVersions: [1, 3] }));

    const { ran, registry } = await publishedAgainst(lab, { project, served: {} });

    expect(ran.status).toBe(1);
    expect(ran.stdout).toContain(`${neverPublished(registry)}\nevents.OrderCreated@3 version-gap`);
    expect(ran.stderr).toBe('The check failed: 1 Change(s) refused\n');
    expect(putsOf(registry)).toEqual([]);
  });

  test('a Service never published publishes 1.0.0 with the latest dist-tag, with the login of its environment, and check reads it back', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aRoot());

    const { ran, registry, env } = await publishedAgainst(lab, { project, served: {} });

    const published = `Published ${ordersPackage}@1.0.0`;
    expect(ran).toEqual({
      status: 0,
      stdout: `${neverPublished(registry)}\n${published}\n`,
      stderr: '',
    });
    const distTags = { latest: '1.0.0' };
    expect(putsOf(registry)).toEqual([{ name: ordersPackage, version: '1.0.0', distTags }]);
    const put = registry.requests.find((request) => request.method === 'PUT');
    expect(put?.authorization).toBe(`Bearer ${token}`);
    const checked = await cfLoomWith(project, env, 'check');
    expect(checked).toEqual({
      status: 0,
      stdout: `${checkedAgainstOrders}\n${nothingToPublish(`${ordersPackage}@1.0.0`)}\n`,
      stderr: '',
    });
    expect(leftBehindIn(project)).toEqual([]);
  });

  test('with --prerelease a package never published publishes 1.0.0-0, and a changed one after it 1.0.0-1, both tagged latest', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, addedSuccessField.before);
    const first = await publishedAgainst(lab, { project, served: {} }, '--prerelease');
    write(project, addedSuccessField.after);
    await generateIn(lab, project);

    const second = await cfLoomWith(project, first.env, 'publish', '--prerelease');

    expect(first.ran.status).toBe(0);
    expect(first.ran.stdout.split('\n').at(-2)).toBe(`Published ${ordersPackage}@1.0.0-0`);
    const checked = `Checked against ${ordersPackage}@1.0.0-0 (no stable version: the first is 1.0.0)`;
    expect(second).toEqual({
      status: 0,
      stdout: [
        checked,
        'endpoints.GET /ping (ping) schema field-added at success.body.total required=true: Additive',
        `Published ${ordersPackage}@1.0.0-1`,
        '',
      ].join('\n'),
      stderr: '',
    });
    expect(putsOf(first.registry)).toEqual([
      { name: ordersPackage, version: '1.0.0-0', distTags: { latest: '1.0.0-0' } },
      { name: ordersPackage, version: '1.0.0-1', distTags: { latest: '1.0.0-1' } },
    ]);
  });

  test('an unchanged package with only prereleases publishes nothing with --prerelease', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aRoot());
    const served = servedAs(ordersPackage, publishedAs(project, '1.0.0-rc.1'));

    const { ran, registry } = await publishedAgainst(lab, { project, served }, '--prerelease');

    const same = `${ordersPackage}@1.0.0-rc.1`;
    expect(ran).toEqual({
      status: 0,
      stdout: [
        `Checked against ${same} (no stable version: the first is 1.0.0)`,
        `Nothing to publish: the Snapshot and peer ranges are those of ${same}; --force publishes anyway`,
        '',
      ].join('\n'),
      stderr: '',
    });
    expect(putRequestsOf(registry)).toEqual([]);
  });

  test('--force publishes the next prerelease of an unchanged package with only prereleases', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aRoot());
    const versions = ['1.0.0-0', '1.0.0-1'].map((version) => publishedAs(project, version));
    const served = servedAs(ordersPackage, ...versions);

    const { registry } = await publishedAgainst(
      lab,
      { project, served },
      '--prerelease',
      '--force',
    );

    const distTags = { latest: '1.0.0-2' };
    expect(putsOf(registry)).toEqual([{ name: ordersPackage, version: '1.0.0-2', distTags }]);
  });

  test('an unchanged package whose highest version is a prerelease publishes that version’s numbers, promoting it', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aRoot());
    const versions = ['1.0.0', '1.1.0-0'].map((version) => publishedAs(project, version));
    const served = servedAs(ordersPackage, ...versions);

    const { ran, registry } = await publishedAgainst(lab, { project, served });

    expect(ran).toEqual({
      status: 0,
      stdout: [
        `Checked against ${ordersPackage}@1.1.0-0 (version from 1.0.0)`,
        `Published ${ordersPackage}@1.1.0`,
        '',
      ].join('\n'),
      stderr: '',
    });
    expect(putsOf(registry)).toEqual([
      { name: ordersPackage, version: '1.1.0', distTags: { latest: '1.1.0' } },
    ]);
  });

  test('a package with only prereleases publishes 1.0.0, checked against the highest one', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aRoot());
    const served = servedAs(ordersPackage, publishedAs(project, '1.0.0-rc.1'));

    const { ran, registry } = await publishedAgainst(lab, { project, served });

    const checked = `Checked against ${ordersPackage}@1.0.0-rc.1 (no stable version: the first is 1.0.0)`;
    expect(ran).toEqual({
      status: 0,
      stdout: `${checked}\nPublished ${ordersPackage}@1.0.0\n`,
      stderr: '',
    });
    const distTags = { latest: '1.0.0' };
    expect(putsOf(registry)).toEqual([{ name: ordersPackage, version: '1.0.0', distTags }]);
  });

  test('a Breaking Change against a package with only prereleases still publishes 1.0.0, the first version that is not a prerelease', async ({
    lab,
  }) => {
    const changed = await aChangedProjectListing(lab, removedSuccessField, ['1.0.0-0']);

    const { ran } = await publishedAgainst(lab, changed);

    expect(ran.status).toBe(0);
    expect(ran.stdout.split('\n').at(-2)).toBe(`Published ${ordersPackage}@1.0.0`);
  });

  test('a Not allowed Change against a package with only prereleases exits 1, and nothing is put', async ({
    lab,
  }) => {
    const roots = {
      before: aRoot({ lifecycle: 'active' }),
      after: aRoot({ lifecycle: 'retired' }),
    };
    const changed = await aChangedProjectListing(lab, roots, ['1.0.0-0']);

    const { ran, registry } = await publishedAgainst(lab, changed);

    expect(ran.status).toBe(1);
    expect(ran.stderr).toBe(`${refusedLine}\n`);
    expect(putRequestsOf(registry)).toEqual([]);
  });

  test('an Additive Change on a Public Endpoint publishes a minor above the Baseline', async ({
    lab,
  }) => {
    const changed = await aChangedProject(lab, addedSuccessField);

    const { ran, registry } = await publishedAgainst(lab, changed);

    expect(ran).toEqual({
      status: 0,
      stdout: [
        checkedAgainstOrders,
        'endpoints.GET /ping (ping) schema field-added at success.body.total required=true: Additive',
        `Published ${ordersPackage}@1.1.0`,
        '',
      ].join('\n'),
      stderr: '',
    });
    const distTags = { latest: '1.1.0' };
    expect(putsOf(registry)).toEqual([{ name: ordersPackage, version: '1.1.0', distTags }]);
  });

  test('a Breaking Change that needs an Approval publishes a major and exits 0, printing its Change line', async ({
    lab,
  }) => {
    const changed = await aChangedProject(lab, removedSuccessField);

    const { ran, registry } = await publishedAgainst(lab, changed);

    expect(ran).toEqual({
      status: 0,
      stdout: [
        checkedAgainstOrders,
        'endpoints.GET /ping (ping) schema field-removed at success.body.total: Breaking, needs a Breaking Change Approval',
        `Published ${ordersPackage}@2.0.0`,
        '',
      ].join('\n'),
      stderr: '',
    });
    expect(putsOf(registry)).toHaveLength(1);
  });

  test('a peer moving to a new major publishes a major although the Snapshot did not change', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aRoot());
    const baseline = publishedAs(project, '1.0.0');
    const peerDependencies = { ...installedPeers, zod: '^3.0.0' };
    const older = { ...baseline, manifest: { ...baseline.manifest, peerDependencies } };

    const { ran } = await publishedAgainst(lab, {
      project,
      served: servedAs(ordersPackage, older),
    });

    const move = `Peer zod moves from ^3.0.0 to ^${zodVersion}: major`;
    expect(ran).toEqual({
      status: 0,
      stdout: `${checkedAgainstOrders}\n${move}\nPublished ${ordersPackage}@2.0.0\n`,
      stderr: '',
    });
  });

  test('with a Baseline and --prerelease the bumped version’s prerelease is published with the next dist-tag, and check then compares with it', async ({
    lab,
  }) => {
    const changed = await aChangedProject(lab, addedSuccessField);

    const { ran, registry, env } = await publishedAgainst(lab, changed, '--prerelease');

    expect(ran.status).toBe(0);
    expect(ran.stdout.split('\n').at(-2)).toBe(`Published ${ordersPackage}@1.1.0-0`);
    const distTags = { next: '1.1.0-0' };
    expect(putsOf(registry)).toEqual([{ name: ordersPackage, version: '1.1.0-0', distTags }]);
    const checked = await cfLoomWith(changed.project, env, 'check');
    const checkedAgainstPrerelease = `Checked against ${ordersPackage}@1.1.0-0 (version from 1.0.0)`;
    expect(checked.stdout.split('\n')[0]).toBe(checkedAgainstPrerelease);
  });

  test('with --prerelease above a Baseline the counter is one above the highest prerelease listed of the version it derives', async ({
    lab,
  }) => {
    const listed = ['1.1.0-0', '1.1.0-3', '1.0.1-7'];
    const changed = await aChangedProject(lab, addedSuccessField, listed);

    const { ran, registry } = await publishedAgainst(lab, changed, '--prerelease');

    expect(ran.status).toBe(0);
    expect(ran.stdout.split('\n').at(-2)).toBe(`Published ${ordersPackage}@1.1.0-4`);
    const distTags = { next: '1.1.0-4' };
    expect(putsOf(registry)).toEqual([{ name: ordersPackage, version: '1.1.0-4', distTags }]);
  });

  test('a prerelease that would not be above a hand-numbered prerelease Baseline fails publish with exit 3, and nothing is put', async ({
    lab,
  }) => {
    const changed = await aChangedProject(lab, addedSuccessField, ['1.1.0-rc.1']);

    const { ran, registry } = await publishedAgainst(lab, changed, '--prerelease');

    expect(ran).toEqual({
      status: 3,
      stdout: `Checked against ${ordersPackage}@1.1.0-rc.1 (version from 1.0.0)\nendpoints.GET /ping (ping) schema field-added at success.body.total required=true: Additive\n`,
      stderr: `${ordersPackage}@1.1.0-0 would not be above the Baseline 1.1.0-rc.1: publish a version above it by hand\n`,
    });
    expect(putRequestsOf(registry)).toEqual([]);
    expect(leftBehindIn(changed.project)).toEqual([]);
  });

  test('a prerelease that would move latest below hand-numbered prereleases fails publish with exit 3, and nothing is put', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aRoot());
    const versions = ['1.0.0-rc.1', '1.0.0-rc.2'].map((version) => publishedAs(project, version));

    const { ran, registry } = await publishedAgainst(
      lab,
      { project, served: servedAs(ordersPackage, ...versions) },
      '--prerelease',
      '--force',
    );

    expect(ran).toEqual({
      status: 3,
      stdout: `Checked against ${ordersPackage}@1.0.0-rc.2 (no stable version: the first is 1.0.0)\n`,
      stderr: `${ordersPackage}@1.0.0-0 would not be above the Baseline 1.0.0-rc.2: publish a version above it by hand\n`,
    });
    expect(putRequestsOf(registry)).toEqual([]);
  });

  test('a package whose only prerelease is 2.0.0-rc.1 publishes 2.0.0, and the line names it as the first version', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aRoot());
    const served = servedAs(ordersPackage, publishedAs(project, '2.0.0-rc.1'));

    const { ran, registry } = await publishedAgainst(lab, { project, served });

    const checked = `Checked against ${ordersPackage}@2.0.0-rc.1 (no stable version: the first is 2.0.0)`;
    expect(ran).toEqual({
      status: 0,
      stdout: `${checked}\nPublished ${ordersPackage}@2.0.0\n`,
      stderr: '',
    });
    expect(putsOf(registry)).toEqual([
      { name: ordersPackage, version: '2.0.0', distTags: { latest: '2.0.0' } },
    ]);
  });

  test('--force on a package never published publishes 1.0.0 with the latest dist-tag, as without it', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aRoot());

    const { ran, registry } = await publishedAgainst(lab, { project, served: {} }, '--force');

    expect(ran.stdout.split('\n').at(-2)).toBe(`Published ${ordersPackage}@1.0.0`);
    const distTags = { latest: '1.0.0' };
    expect(putsOf(registry)).toEqual([{ name: ordersPackage, version: '1.0.0', distTags }]);
  });

  test('an unchanged Snapshot and unchanged peers publish nothing, say so and exit 0', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aRoot());
    const served = servedAs(ordersPackage, publishedAs(project, '1.0.0'));

    const { ran, registry } = await publishedAgainst(lab, { project, served });

    const nothing = `Nothing to publish: the Snapshot and peer ranges are those of ${ordersPackage}@1.0.0; --force publishes anyway`;
    expect(ran).toEqual({ status: 0, stdout: `${checkedAgainstOrders}\n${nothing}\n`, stderr: '' });
    expect(putRequestsOf(registry)).toEqual([]);
  });

  test('--force publishes a patch when nothing changed', async ({ lab }) => {
    const project = await aGeneratedProject(lab, aRoot());
    const served = servedAs(ordersPackage, publishedAs(project, '1.0.0'));

    const { ran, registry } = await publishedAgainst(lab, { project, served }, '--force');

    expect(ran).toEqual({
      status: 0,
      stdout: `${checkedAgainstOrders}\nPublished ${ordersPackage}@1.0.1\n`,
      stderr: '',
    });
    const distTags = { latest: '1.0.1' };
    expect(putsOf(registry)).toEqual([{ name: ordersPackage, version: '1.0.1', distTags }]);
  });

  test('a refused Change exits 1 with every Change line, and nothing is put', async ({ lab }) => {
    const changed = await aChangedProject(lab, removedEventField);

    const { ran, registry } = await publishedAgainst(lab, changed);

    expect(ran).toEqual({
      status: 1,
      stdout: [
        checkedAgainstOrders,
        'events.OrderCreated@1 schema field-removed at body.placedAt (message): Breaking, refused; make the change in a new Message Version',
        '',
      ].join('\n'),
      stderr: `${refusedLine}\n`,
    });
    expect(putRequestsOf(registry)).toEqual([]);
  });

  test('a registry publish cannot read the Baseline of is a tooling error, and nothing is put', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aRoot());
    const packument = `/${ordersPackage.replace('/', '%2f')}`;
    const answers = { [packument]: { status: 500, body: 'a plain text body' } };

    const { ran, registry } = await publishedAgainst(lab, { project, served: { answers } });

    expect(ran.status).toBe(3);
    expect(ran.stdout).toBe('');
    expect(ran.stderr).toMatch(
      new RegExp(`^npm view ${ordersPackage} failed \\(E500: [^\\n]+\\)\\n$`),
    );
    expect(putRequestsOf(registry)).toEqual([]);
  });

  test('the published snapshot.json carries the version and the Baseline’s history: a deleted Retired Endpoint stays as a tombstone that keeps its retiredIn', async ({
    lab,
  }) => {
    const retired = await aGeneratedProject(lab, aRoot({ lifecycle: 'retired' }));
    const ping = JSON.parse(read(retired, 'contract.snapshot.json')).endpoints['GET /ping'];
    const endpoints = { 'GET /ping': { ...ping, retiredIn: '1.0.0' } };
    const baseline = publishedAs(retired, '1.0.0', { endpoints });
    const project = await aGeneratedProject(lab, aRootWithoutEndpoints);

    const { registry } = await publishedAgainst(lab, {
      project,
      served: servedAs(ordersPackage, baseline),
    });

    const published = JSON.parse(publishedFilesOf(registry)['snapshot.json']!);
    expect(published.version).toBe('1.0.1');
    expect(published.endpoints).toEqual({
      'GET /ping': { lifecycle: 'retired', name: 'ping', retiredIn: '1.0.0' },
    });
  });

  test('the published snapshot.json names the CLI that runs publish, after the version in its heading', async ({
    lab,
  }) => {
    const changed = await aChangedProject(lab, addedSuccessField);

    const { registry } = await publishedAgainst(lab, changed);

    const text = publishedFilesOf(registry)['snapshot.json']!;
    const published = JSON.parse(text);
    expect(published.generator).toBe(`@cf-loom/cli@${cliVersion}`);
    expect(Object.keys(published).slice(0, 5)).toEqual([
      'format',
      'kind',
      'name',
      'version',
      'generator',
    ]);
    expect(text).toBe(canonicalTextOf(published));
  });

  test('the published snapshot.json carries the deprecatedAt the declaration states, not the Baseline’s', async ({
    lab,
  }) => {
    const changed = await aChangedProject(lab, {
      before: aRoot({ lifecycle: 'deprecated', deprecatedAt: '2026-01-01T00:00:00Z' }),
      after: aRoot({ lifecycle: 'deprecated', deprecatedAt: '2026-06-01T00:00:00Z' }),
    });

    const { registry } = await publishedAgainst(lab, changed);

    const published = JSON.parse(publishedFilesOf(registry)['snapshot.json']!);
    expect(published.endpoints['GET /ping'].deprecatedAt).toBe('2026-06-01T00:00:00Z');
  });

  test('publish --prerelease over a prerelease Baseline merges its history: a deleted Retired Endpoint stays as a tombstone that keeps its retiredIn', async ({
    lab,
  }) => {
    const retired = await aGeneratedProject(lab, aRoot({ lifecycle: 'retired' }));
    const ping = JSON.parse(read(retired, 'contract.snapshot.json')).endpoints['GET /ping'];
    const endpoints = { 'GET /ping': { ...ping, retiredIn: '1.0.0-0' } };
    const baseline = publishedAs(retired, '1.0.0-0', { endpoints });
    const project = await aGeneratedProject(lab, aRootWithoutEndpoints);

    const { registry } = await publishedAgainst(
      lab,
      { project, served: servedAs(ordersPackage, baseline) },
      '--prerelease',
    );

    const published = JSON.parse(publishedFilesOf(registry)['snapshot.json']!);
    expect(published.version).toBe('1.0.0-1');
    expect(published.endpoints).toEqual({
      'GET /ping': { lifecycle: 'retired', name: 'ping', retiredIn: '1.0.0-0' },
    });
  });

  test('a version published between the Baseline read and npm publish fails publish with exit 3, and nothing is put', async ({
    lab,
  }) => {
    const changed = await aChangedProject(lab, addedSuccessField);
    const meanwhile = {
      afterRequestFor: tarballPathOf(ordersPackage, '1.0.0'),
      packages: { [ordersPackage]: { versions: [publishedAs(changed.project, '1.2.0')] } },
    };

    const { ran, registry } = await publishedAgainst(lab, {
      project: changed.project,
      served: { ...changed.served, later: meanwhile },
    });

    expect(ran).toEqual({
      status: 3,
      stdout: `${checkedAgainstOrders}\nendpoints.GET /ping (ping) schema field-added at success.body.total required=true: Additive\n`,
      stderr: `${ordersPackage} lists 1.2.0, published while publish ran: rerun publish, which reads the registry again\n`,
    });
    expect(putRequestsOf(registry)).toEqual([]);
    expect(leftBehindIn(changed.project)).toEqual([]);
  });

  test('a package npm could not find before the Check and lists after it fails publish with exit 3, and nothing is put', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aRoot());
    const meanwhile = {
      afterRequestFor: '/-/whoami',
      packages: { [ordersPackage]: { versions: [publishedAs(project, '1.0.0')] } },
    };

    const { ran, registry } = await publishedAgainst(lab, {
      project,
      served: { later: meanwhile },
    });

    expect(ran).toEqual({
      status: 3,
      stdout: `${neverPublished(registry)}\n`,
      stderr: `${ordersPackage} lists 1.0.0, published while publish ran: rerun publish, which reads the registry again\n`,
    });
    expect(putRequestsOf(registry)).toEqual([]);
  });

  test('the published package.json carries the version, the peers as carets and cfLoom with the hash of the published Snapshot, and the built entry carries the version', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aRoot());

    const { registry } = await publishedAgainst(lab, { project, served: {} });

    const files = publishedFilesOf(registry);
    const cfLoomMetadata = {
      format: 1,
      snapshotHash: snapshotHashOf(files['snapshot.json']!),
      kind: 'service',
      dependencies: {},
    };
    expect(JSON.parse(files['package.json']!)).toEqual({
      name: ordersPackage,
      version: '1.0.0',
      type: 'module',
      exports: {
        '.': { types: './dist/index.d.ts', default: './dist/index.js' },
        './package.json': './package.json',
        './snapshot.json': './snapshot.json',
      },
      files: ['dist', 'snapshot.json'],
      sideEffects: false,
      peerDependencies: installedPeers,
      cfLoom: cfLoomMetadata,
    });
    expect(registry.published[0]?.manifest).toMatchObject({ cfLoom: cfLoomMetadata });
    expect(files['dist/index.js']).toMatch(/version: ['"]1\.0\.0['"]/);
  });

  test('cfLoom.dependencies leaves out the Event of a Subscription the published Snapshot keeps as removed', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aSubscribingRoot());
    const { subscriptions } = JSON.parse(read(project, 'contract.snapshot.json'));
    const removed = {
      group: 'health',
      description: 'Legacy',
      event: 'payments-service:PaymentRefunded@1',
    };
    const baseline = { subscriptions: { ...subscriptions, legacySync: removed } };
    const served = servedAs(ordersPackage, publishedAs(project, '1.0.0', baseline));

    const { ran, registry } = await publishedAgainst(lab, { project, served });

    expect(ran.status).toBe(0);
    const files = publishedFilesOf(registry);
    expect(JSON.parse(files['snapshot.json']!).subscriptions.legacySync).toEqual({
      event: 'payments-service:PaymentRefunded@1',
      removedIn: '1.0.1',
    });
    expect(JSON.parse(files['package.json']!).cfLoom.dependencies).toEqual({
      'payments-service': { against: '5.1.0', endpoints: [], events: ['PaymentSettled@1'] },
    });
  });

  test('the published tarball holds dist built by tsc with its declarations, and no src', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aRoot());

    const { registry } = await publishedAgainst(lab, { project, served: {} });

    const paths = Object.keys(publishedFilesOf(registry));
    expect(paths).toEqual(
      expect.arrayContaining([
        'package.json',
        'snapshot.json',
        'dist/index.js',
        'dist/index.d.ts',
        'dist/endpoints/ping.js',
        'dist/endpoints/ping.d.ts',
      ]),
    );
    expect(paths.filter((path) => path.startsWith('src/') || path === 'tsconfig.json')).toEqual([]);
  });

  test('an Application publishes its package.json and snapshot.json alone, with no peers, and builds nothing', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, anApplicationRoot);
    withTsc(project, "console.error('tsc must not run'); process.exit(1);");

    const { ran, registry } = await publishedAgainst(lab, { project, served: {} });

    const published = 'Published @org/contract-web-admin@1.0.0';
    expect(ran.stdout.split('\n').at(-2)).toBe(published);
    const files = publishedFilesOf(registry);
    expect(Object.keys(files).sort()).toEqual(['package.json', 'snapshot.json']);
    expect(JSON.parse(files['snapshot.json']!)).toMatchObject({
      kind: 'application',
      name: 'web-admin',
      version: '1.0.0',
    });
    expect(Object.keys(JSON.parse(files['package.json']!))).not.toContain('peerDependencies');
    expect(leftBehindIn(project)).toEqual([]);
  });

  test('a Definitions Package publishes its own package.json and built files, with snapshot.json, cfLoom and the version written in, and snapshot.json added to files', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aBuiltDefinitions({ description: 'Shared' }));

    const { ran, registry } = await publishedAgainst(lab, { project, served: {} });

    expect(ran).toEqual({
      status: 0,
      stdout: `${neverPublished(registry, '@org/definitions')}\nPublished @org/definitions@1.0.0\n`,
      stderr: '',
    });
    const files = publishedFilesOf(registry);
    expect(Object.keys(files).sort()).toEqual([
      'dist/index.d.ts',
      'dist/index.js',
      'package.json',
      'snapshot.json',
    ]);
    expect(files['dist/index.js']).toBe(aDefinitionsModule());
    expect(JSON.parse(files['snapshot.json']!)).toMatchObject({
      kind: 'definitions',
      version: '1.0.0',
    });
    expect(JSON.parse(files['package.json']!)).toEqual({
      name: '@org/definitions',
      version: '1.0.0',
      type: 'module',
      exports: './dist/index.js',
      files: ['dist', 'snapshot.json'],
      description: 'Shared',
      peerDependencies: installedPeers,
      cfLoom: {
        format: 1,
        snapshotHash: snapshotHashOf(files['snapshot.json']!),
        kind: 'definitions',
        dependencies: {},
      },
    });
    expect(leftBehindIn(project)).toEqual([]);
  });

  test('a Definitions Package built from its source publishes, and one that imports another Definitions Package too', async ({
    lab,
  }) => {
    const source = aDefinitionsModule([anApiKey, "export { gone } from '@org/definitions';"]);
    const files = {
      ...installedDefinitions('node_modules'),
      ...aBuiltDefinitions({ name: '@other/definitions' }, { source }),
    };
    const project = await aGeneratedProject(lab, files);
    const registry = await lab.aRegistry({});
    const env = lab.anNpmEnvironment({ userConfig: defaultLoginTo(registry) });

    const ran = await cfLoomWith(project, env, 'publish');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    const distTags = { latest: '1.0.0' };
    expect(putsOf(registry)).toEqual([{ name: '@other/definitions', version: '1.0.0', distTags }]);
    expect(leftBehindIn(project)).toEqual([]);
  });

  test.for([
    [
      'still exports a schema removed from src',
      { source: aDefinitionsModule(), built: aDefinitionsModule([aMoney]) },
    ],
    [
      'lacks a Guard added to src',
      { source: aDefinitionsModule([anApiKey]), built: aDefinitionsModule() },
    ],
    [
      'lacks a schema added to src',
      { source: aDefinitionsModule([aMoney]), built: aDefinitionsModule() },
    ],
    [
      'still exports a Guard removed from src',
      { source: aDefinitionsModule(), built: aDefinitionsModule([anApiKey]) },
    ],
    [
      'still exports a Rejection removed from src',
      { source: aDefinitionsModule(), built: aDefinitionsModule([aGone]) },
    ],
    [
      'lacks a Rejection added to src',
      { source: aDefinitionsModule([aGone]), built: aDefinitionsModule() },
    ],
    [
      'declares a Guard that breaks a rule of the Contract',
      {
        source: aDefinitionsModule([anApiKey]),
        built: aDefinitionsModule([aGuardNamedWithAnUnderscore]),
      },
    ],
  ] as const)(
    'a Definitions Package whose dist %s is refused, and nothing is put or left behind',
    async ([, sources], { lab }) => {
      const project = await aGeneratedProject(lab, aBuiltDefinitions({}, sources));

      const { ran, registry } = await publishedAgainst(lab, { project, served: {} });

      const refused = `@org/definitions's built files are not what contract.snapshot.json describes: build, then publish`;
      const checked = `${neverPublished(registry, '@org/definitions')}\n`;
      expect(ran).toEqual({ status: 3, stdout: checked, stderr: `${refused}\n` });
      expect(putRequestsOf(registry)).toEqual([]);
      expect(leftBehindIn(project)).toEqual([]);
    },
  );

  test.for([
    ['has no dist', {}, false, 'Cannot find module'],
    [
      'exports its TypeScript source',
      { exports: './src/definitions/index.ts', files: ['src'] },
      true,
      'files under node_modules',
    ],
    ['has no entry Node can resolve', { exports: undefined }, true, 'Cannot find package'],
  ] as const)(
    'a Definitions Package that %s cannot be imported as installed, and nothing is put or left behind',
    async ([, manifest, hasDist, reason], { lab }) => {
      const built = aBuiltDefinitions(manifest);
      const { 'dist/index.js': _js, 'dist/index.d.ts': _declarations, ...files } = built;
      const project = await aGeneratedProject(lab, hasDist ? built : files);

      const { ran, registry } = await publishedAgainst(lab, { project, served: {} });

      expect(ran.status).toBe(3);
      expect(ran.stdout).toBe(`${neverPublished(registry, '@org/definitions')}\n`);
      expect(ran.stderr).toMatch(
        /^@org\/definitions cannot be imported as installed: [^\n]+: build, then publish\n$/,
      );
      expect(ran.stderr).toContain(reason);
      expect(putRequestsOf(registry)).toEqual([]);
      expect(leftBehindIn(project)).toEqual([]);
    },
  );

  test.for([
    [
      'exports no Root',
      aDefinitionsModule().replace('export const definitions =', 'const unexported ='),
    ],
    ['exports two Roots', aDefinitionsModule(['export const other = defineDefinitions({});'])],
  ] as const)(
    'a Definitions Package whose entry %s cannot be imported as installed, and nothing is put or left behind',
    async ([, built], { lab }) => {
      const project = await aGeneratedProject(
        lab,
        aBuiltDefinitions({}, { source: aDefinitionsModule(), built }),
      );

      const { ran, registry } = await publishedAgainst(lab, { project, served: {} });

      expect(ran.status).toBe(3);
      expect(ran.stdout).toBe(`${neverPublished(registry, '@org/definitions')}\n`);
      expect(ran.stderr).toMatch(
        /^@org\/definitions cannot be imported as installed: its entry exports (no|more than one) Root: [^\n]+: build, then publish\n$/,
      );
      expect(putRequestsOf(registry)).toEqual([]);
      expect(leftBehindIn(project)).toEqual([]);
    },
  );

  test('a Definitions Package with a main and no exports is imported as installed and publishes', async ({
    lab,
  }) => {
    const manifest = { exports: undefined, main: './dist/index.js' };
    const project = await aGeneratedProject(lab, aBuiltDefinitions(manifest));

    const { ran, registry } = await publishedAgainst(lab, { project, served: {} });

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    expect(putsOf(registry)).toHaveLength(1);
  });

  test('a Definitions Package’s publishConfig.tag is left out of what is published, and the rest of publishConfig is kept', async ({
    lab,
  }) => {
    const publishConfig = { tag: 'beta', access: 'restricted' };
    const project = await aGeneratedProject(lab, aBuiltDefinitions({ publishConfig }));

    const { registry } = await publishedAgainst(lab, { project, served: {} });

    expect(JSON.parse(publishedFilesOf(registry)['package.json']!).publishConfig).toEqual({
      access: 'restricted',
    });
    const distTags = { latest: '1.0.0' };
    expect(putsOf(registry)).toEqual([{ name: '@org/definitions', version: '1.0.0', distTags }]);
  });

  test('a Definitions Package publishes under the name its package.json gives, whatever its scope', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aBuiltDefinitions({ name: '@other/definitions' }));
    const registry = await lab.aRegistry({});
    const env = lab.anNpmEnvironment({ userConfig: defaultLoginTo(registry) });

    const ran = await cfLoomWith(project, env, 'publish');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    const distTags = { latest: '1.0.0' };
    expect(putsOf(registry)).toEqual([{ name: '@other/definitions', version: '1.0.0', distTags }]);
  });

  test('a Definitions Package’s peers besides zod and @cf-loom/contract are published as written, and the two are set to carets', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aBuiltDefinitions(withOtherPeer(anotherPeer)));

    const { registry } = await publishedAgainst(lab, { project, served: {} });

    expect(registry.published[0]?.manifest).toMatchObject({
      peerDependencies: { ...installedPeers, '@org/other': '^2.0.0' },
      peerDependenciesMeta: otherPeerMeta,
    });
  });

  test('a Definitions Package with a peer besides zod and @cf-loom/contract and nothing changed publishes nothing', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aBuiltDefinitions(withOtherPeer(anotherPeer)));
    const served = servedAs('@org/definitions', publishedWithOtherPeer(project, '^2.0.0'));

    const { ran, registry } = await publishedAgainst(lab, { project, served });

    const nothing =
      'Nothing to publish: the Snapshot and peer ranges are those of @org/definitions@1.0.0; --force publishes anyway';
    const checked = 'Checked against @org/definitions@1.0.0';
    expect(ran).toEqual({ status: 0, stdout: `${checked}\n${nothing}\n`, stderr: '' });
    expect(putRequestsOf(registry)).toEqual([]);
  });

  test('a peer of a Definitions Package besides zod and @cf-loom/contract moving to a new major publishes a major although the Snapshot did not change', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aBuiltDefinitions(withOtherPeer('^3.0.0')));
    const served = servedAs('@org/definitions', publishedWithOtherPeer(project, '^2.0.0'));

    const { ran, registry } = await publishedAgainst(lab, { project, served });

    const checked = 'Checked against @org/definitions@1.0.0';
    const move = 'Peer @org/other moves from ^2.0.0 to ^3.0.0: major';
    expect(ran).toEqual({
      status: 0,
      stdout: `${checked}\n${move}\nPublished @org/definitions@2.0.0\n`,
      stderr: '',
    });
    expect(registry.published[0]?.manifest).toMatchObject({
      peerDependencies: { ...installedPeers, '@org/other': '^3.0.0' },
    });
  });

  test('a Definitions Package’s catalog: and workspace: peers are published as carets of the installed versions', async ({
    lab,
  }) => {
    const peerDependencies = { '@cf-loom/contract': 'workspace:^', zod: 'catalog:' };
    const project = await aGeneratedProject(lab, aBuiltDefinitions({ peerDependencies }));

    const { registry } = await publishedAgainst(lab, { project, served: {} });

    expect(registry.published[0]?.manifest).toMatchObject({ peerDependencies: installedPeers });
  });

  test.for([
    [
      'lists a workspace: range in dependencies',
      { dependencies: { '@org/shared': 'workspace:*' } },
      'package.json lists @org/shared in dependencies as workspace:*, which npm cannot install from the registry',
    ],
    [
      'lists a catalog: range in dependencies',
      { dependencies: { left: 'catalog:' } },
      'package.json lists left in dependencies as catalog:, which npm cannot install from the registry',
    ],
    [
      'lists a workspace: range in optionalDependencies',
      { optionalDependencies: { '@org/shared': 'workspace:^' } },
      'package.json lists @org/shared in optionalDependencies as workspace:^, which npm cannot install from the registry',
    ],
    [
      'lists a catalog: range in optionalDependencies',
      { optionalDependencies: { left: 'catalog:' } },
      'package.json lists left in optionalDependencies as catalog:, which npm cannot install from the registry',
    ],
    [
      'lists a file: range in dependencies',
      { dependencies: { '@org/shared': 'file:../shared' } },
      'package.json lists @org/shared in dependencies as file:../shared, which npm cannot install from the registry',
    ],
    [
      'lists a link: range in dependencies',
      { dependencies: { '@org/shared': 'link:../shared' } },
      'package.json lists @org/shared in dependencies as link:../shared, which npm cannot install from the registry',
    ],
    [
      'lists a file: range in optionalDependencies',
      { optionalDependencies: { left: 'file:./vendor/left.tgz' } },
      'package.json lists left in optionalDependencies as file:./vendor/left.tgz, which npm cannot install from the registry',
    ],
    [
      'lists a link: range in optionalDependencies',
      { optionalDependencies: { left: 'link:./vendor/left' } },
      'package.json lists left in optionalDependencies as link:./vendor/left, which npm cannot install from the registry',
    ],
    [
      'lists a workspace: range in peerDependencies',
      { peerDependencies: { '@org/shared': 'workspace:*' } },
      'package.json lists @org/shared in peerDependencies as workspace:*, which npm cannot install from the registry',
    ],
    [
      'lists a catalog: range in peerDependencies',
      { peerDependencies: { left: 'catalog:' } },
      'package.json lists left in peerDependencies as catalog:, which npm cannot install from the registry',
    ],
  ] as const)(
    'a Definitions Package whose package.json %s is a tooling error, and nothing is put or left behind',
    async ([, manifest, line], { lab }) => {
      const project = await aGeneratedProject(lab, aBuiltDefinitions());
      write(project, {
        'package.json': JSON.stringify({
          ...JSON.parse(read(project, 'package.json')),
          ...manifest,
        }),
      });

      const { ran, registry } = await publishedAgainst(lab, { project, served: {} });

      const checked = `${neverPublished(registry, '@org/definitions')}\n`;
      expect(ran).toEqual({ status: 3, stdout: checked, stderr: `${line}\n` });
      expect(putRequestsOf(registry)).toEqual([]);
      expect(leftBehindIn(project)).toEqual([]);
    },
  );

  test('a Definitions Package’s own lifecycle scripts do not run', async ({ lab }) => {
    const scripts = {
      prepack: 'exit 1',
      prepare: 'exit 1',
      prepublishOnly: 'exit 1',
      postpack: 'exit 1',
      publish: 'exit 1',
      postpublish: 'exit 1',
    };
    const project = await aGeneratedProject(lab, aBuiltDefinitions({ scripts }));

    const { ran, registry } = await publishedAgainst(lab, { project, served: {} });

    expect(ran.status).toBe(0);
    expect(putsOf(registry)).toHaveLength(1);
  });

  test('npm refusing the publish is a tooling error with the first line of its summary after the lines of the Check, and nothing is put or left behind', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aBuiltDefinitions({ private: true }));

    const { ran, registry } = await publishedAgainst(lab, { project, served: {} });

    const refused =
      'npm publish @org/definitions@1.0.0 failed (EPRIVATE: This package has been marked as private)';
    const checked = `${neverPublished(registry, '@org/definitions')}\n`;
    expect(ran).toEqual({ status: 3, stdout: checked, stderr: `${refused}\n` });
    expect(putRequestsOf(registry)).toEqual([]);
    expect(leftBehindIn(project)).toEqual([]);
  });

  test('a project without typescript is a tooling error, and nothing is put or left behind', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aRoot());
    rmSync(join(project, 'node_modules/typescript'));

    const { ran, registry } = await publishedAgainst(lab, { project, served: {} });

    expect(ran).toEqual({
      status: 3,
      stdout: `${neverPublished(registry)}\n`,
      stderr: 'typescript is not installed: publish builds the Contract Package with its tsc\n',
    });
    expect(putRequestsOf(registry)).toEqual([]);
    expect(leftBehindIn(project)).toEqual([]);
  });

  test('a Definitions Package without zod installed is a tooling error naming the peer, and nothing is put or left behind', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aBuiltDefinitions());
    rmSync(join(project, 'node_modules/zod'));

    const { ran, registry } = await publishedAgainst(lab, { project, served: {} });

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: "zod is not installed: the package's peer range is taken from it\n",
    });
    expect(putRequestsOf(registry)).toEqual([]);
    expect(leftBehindIn(project)).toEqual([]);
  });

  test.for([
    [
      'prints a diagnostic and exits 1',
      "console.log('error TS2322: Type is wrong.\\nmore'); process.exit(1);",
      'failed: error TS2322: Type is wrong.',
    ],
    [
      'prints only on stderr',
      "console.error('tsc crashed'); process.exit(1);",
      'failed: tsc crashed',
    ],
    ['prints nothing and exits 2', 'process.exit(2);', 'failed: exit status 2'],
    ['is stopped by a signal', "process.kill(process.pid, 'SIGKILL');", 'was stopped by SIGKILL'],
  ] as const)(
    'a tsc that %s fails publish with one line, and nothing is put or left behind',
    async ([, script, ending], { lab }) => {
      const project = await aGeneratedProject(lab, aRoot());
      withTsc(project, script);

      const { ran, registry } = await publishedAgainst(lab, { project, served: {} });

      const label = `tsc on the Contract Package of ${ordersPackage}@1.0.0`;
      const checked = `${neverPublished(registry)}\n`;
      expect(ran).toEqual({ status: 3, stdout: checked, stderr: `${label} ${ending}\n` });
      expect(putRequestsOf(registry)).toEqual([]);
      expect(leftBehindIn(project)).toEqual([]);
    },
  );

  test('a publish killed while it builds has printed the lines of the Check', async ({ lab }) => {
    const project = await aGeneratedProject(lab, aRoot());
    withTsc(project, "process.kill(process.ppid, 'SIGKILL');");

    const { ran, registry } = await publishedAgainst(lab, { project, served: {} });

    expect(ran).toEqual({ status: null, stdout: `${neverPublished(registry)}\n`, stderr: '' });
    expect(putRequestsOf(registry)).toEqual([]);
  });

  test.skipIf(isRoot)(
    'a staging folder that cannot be removed leaves a published version published: publish names the folder',
    async ({ lab }) => {
      const project = await aGeneratedProject(lab, aRoot());
      withTsc(project, aTscThatLocksItsStaging('process.exit(0);'));
      try {
        const { ran, registry } = await publishedAgainst(lab, { project, served: {} });

        expect(ran.status).toBe(0);
        expect(ran.stdout.split('\n').at(-2)).toBe(`Published ${ordersPackage}@1.0.0`);
        expect(ran.stderr).toMatch(leftBehindLine);
        expect(putsOf(registry)).toHaveLength(1);
        expect(leftBehindIn(project)).toHaveLength(1);
      } finally {
        chmodSync(join(project, stagingFolder), 0o755);
      }
    },
  );

  test.skipIf(isRoot)(
    'a staging folder that cannot be removed is named after the line of the failure that ended publish',
    async ({ lab }) => {
      const project = await aGeneratedProject(lab, aRoot());
      withTsc(project, aTscThatLocksItsStaging('process.exit(1);'));
      try {
        const { ran, registry } = await publishedAgainst(lab, { project, served: {} });

        const failure = `tsc on the Contract Package of ${ordersPackage}@1.0.0 failed: exit status 1`;
        const [first, second, ...more] = ran.stderr.split('\n');
        const checked = `${neverPublished(registry)}\n`;
        expect([ran.status, ran.stdout, first, more]).toEqual([3, checked, failure, ['']]);
        expect(`${second}\n`).toMatch(leftBehindLine);
        expect(putRequestsOf(registry)).toEqual([]);
      } finally {
        chmodSync(join(project, stagingFolder), 0o755);
      }
    },
  );

  test('a staging place that cannot be made is a tooling error with one line, and nothing is put', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aRoot());
    rmSync(join(project, 'node_modules/.cache'), { recursive: true, force: true });
    write(project, { 'node_modules/.cache': '' });

    const { ran, registry } = await publishedAgainst(lab, { project, served: {} });

    expect(ran.status).toBe(3);
    expect(ran.stdout).toBe(`${neverPublished(registry)}\n`);
    expect(ran.stderr).toMatch(/^node_modules\/\.cache\/cf-loom cannot be written: [^\n]+\n$/);
    expect(ran.stderr).not.toContain('was left behind');
    expect(putRequestsOf(registry)).toEqual([]);
  });

  test.for([
    [['generate', '--force'], 'Only publish takes --force'],
    [['generate', '--prerelease'], 'Only check and publish take --prerelease'],
    [['publish', '--force=true'], '--force takes no value'],
    [['publish', '--prerelease=false'], '--prerelease takes no value'],
    [['publish', 'now'], 'publish takes no argument'],
    [['generate', '--dry-run'], 'Only publish takes --dry-run'],
    [['check', '--dry-run'], 'Only publish takes --dry-run'],
    [['publish', '--dry-run=true'], '--dry-run takes no value'],
  ] as const)('publish and its options are called wrongly: %s', ([args, message]) => {
    const project = aProject();

    const ran = cfLoom(project, ...args);

    expect(ran).toEqual({ status: 3, stdout: '', stderr: `${message}. ${usage}\n` });
  });
});

const unchangedRoots = { before: aRoot(), after: aRoot() };
const refusedGapRoots = {
  before: aMessagingRoot(),
  after: aMessagingRoot({ eventVersions: [1, 3] }),
};

describe.concurrent('cf-loom publish --dry-run', { timeout: publishTimeout }, () => {
  /** The methods of the requests the registry got after the Baseline's tarball was read. */
  const requestsAfterBaseline = (registry: Registry) => {
    const { requests } = registry;
    const lastTarball = requests.findLastIndex(({ path }) => path.startsWith('/tarballs/'));
    return requests.slice(lastTarball + 1).map(({ method }) => method);
  };

  test('stages and builds the package, prints the version it would take, puts nothing and leaves nothing behind', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aRoot());

    const { ran, registry } = await publishedAgainst(lab, { project, served: {} }, '--dry-run');

    const would = `Would publish ${ordersPackage}@1.0.0 (first version): --dry-run stopped before npm publish`;
    expect(ran).toEqual({
      status: 0,
      stdout: `${neverPublished(registry)}\n${would}\n`,
      stderr: '',
    });
    expect(putRequestsOf(registry)).toEqual([]);
    expect(leftBehindIn(project)).toEqual([]);
  });

  test('asks the registry nothing once the Baseline is read, where a publish reads the versions again before it puts', async ({
    lab,
  }) => {
    const changed = await aChangedProject(lab, addedSuccessField);

    const dry = await publishedAgainst(lab, changed, '--dry-run');
    const real = await publishedAgainst(lab, changed);

    expect(requestsAfterBaseline(dry.registry)).toEqual([]);
    const afterReal = requestsAfterBaseline(real.registry);
    expect(afterReal.at(-1)).toBe('PUT');
    expect(afterReal).toContain('GET');
  });

  test('builds with tsc, so a tsc that fails still fails the dry run with its line', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aRoot());
    withTsc(project, "console.error('tsc crashed'); process.exit(1);");

    const { ran, registry } = await publishedAgainst(lab, { project, served: {} }, '--dry-run');

    const label = `tsc on the Contract Package of ${ordersPackage}@1.0.0`;
    expect(ran).toEqual({
      status: 3,
      stdout: `${neverPublished(registry)}\n`,
      stderr: `${label} failed: tsc crashed\n`,
    });
    expect(leftBehindIn(project)).toEqual([]);
  });

  test('--force over an unchanged package derives the patch it would publish, and says it is forced', async ({
    lab,
  }) => {
    const changed = await aChangedProject(lab, { before: aRoot(), after: aRoot() });

    const { ran, registry } = await publishedAgainst(lab, changed, '--dry-run', '--force');

    const would = `Would publish ${ordersPackage}@1.0.1 (forced): --dry-run stopped before npm publish`;
    expect(ran.stdout.split('\n').at(-2)).toBe(would);
    expect(putRequestsOf(registry)).toEqual([]);
  });

  test('--force --prerelease over a prerelease Baseline derives its next prerelease, never a promotion', async ({
    lab,
  }) => {
    const roots = { before: aRoot(), after: aRoot() };
    const changed = await aChangedProject(lab, roots, ['1.1.0-0']);

    const args = ['--dry-run', '--force', '--prerelease'];
    const { ran } = await publishedAgainst(lab, changed, ...args);

    const would = `Would publish ${ordersPackage}@1.1.0-1 (forced): --dry-run stopped before npm publish`;
    expect(ran.stdout.split('\n').at(-2)).toBe(would);
  });

  test('an unchanged package is nothing to publish, with or without --dry-run', async ({ lab }) => {
    const changed = await aChangedProject(lab, { before: aRoot(), after: aRoot() });

    const { ran } = await publishedAgainst(lab, changed, '--dry-run');

    const same = `${ordersPackage}@1.0.0`;
    expect(ran.stdout.split('\n').at(-2)).toBe(
      `${nothingToPublish(same)}; --force publishes anyway`,
    );
  });

  test('a Definitions Package is dry-run without tsc, its built entry still checked', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aBuiltDefinitions());
    withTsc(project, "console.error('tsc must not run'); process.exit(1);");

    const { ran, registry } = await publishedAgainst(lab, { project, served: {} }, '--dry-run');

    const would =
      'Would publish @org/definitions@1.0.0 (first version): --dry-run stopped before npm publish';
    expect(ran.stdout.split('\n').at(-2)).toBe(would);
    expect(ran.status).toBe(0);
    expect(putRequestsOf(registry)).toEqual([]);
    expect(leftBehindIn(project)).toEqual([]);
  });

  test('a Definitions Package whose dist is missing still exits 3 on a dry run', async ({
    lab,
  }) => {
    const built = aBuiltDefinitions();
    const { 'dist/index.js': _js, 'dist/index.d.ts': _declarations, ...files } = built;
    const project = await aGeneratedProject(lab, files);

    const { ran, registry } = await publishedAgainst(lab, { project, served: {} }, '--dry-run');

    expect(ran.status).toBe(3);
    expect(putRequestsOf(registry)).toEqual([]);
    expect(leftBehindIn(project)).toEqual([]);
  });
});

describe.concurrent('cf-loom publish --json', { timeout: publishTimeout }, () => {
  test('prints one document and no progress line: published, with the version it took', async ({
    lab,
  }) => {
    const project = await aGeneratedProject(lab, aRoot());

    const { ran, registry } = await publishedAgainst(lab, { project, served: {} }, '--json');

    const lines = ran.stdout.split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? '')).toEqual({
      format: 1,
      status: 0,
      package: ordersPackage,
      baseline: null,
      stable: null,
      reason: neverPublished(registry).slice(`${ordersPackage} has no Baseline: `.length),
      changes: [],
      peers: [],
      bump: null,
      version: '1.0.0',
      tag: 'latest',
      published: true,
    });
    expect(ran.stderr).toBe('');
    expect(putsOf(registry)).toEqual([
      { name: ordersPackage, version: '1.0.0', distTags: { latest: '1.0.0' } },
    ]);
  });

  test('with --dry-run and when nothing is to be published it says it published nothing', async ({
    lab,
  }) => {
    const changed = await aChangedProject(lab, addedSuccessField);
    const unchanged = await aChangedProject(lab, { before: aRoot(), after: aRoot() });

    const dry = await publishedAgainst(lab, changed, '--json', '--dry-run');
    const nothing = await publishedAgainst(lab, unchanged, '--json');

    expect(JSON.parse(dry.ran.stdout)).toMatchObject({
      status: 0,
      version: '1.1.0',
      published: false,
    });
    expect(JSON.parse(nothing.ran.stdout)).toMatchObject({
      status: 0,
      version: null,
      published: false,
    });
    expect(putRequestsOf(dry.registry)).toEqual([]);
  });

  test('a refused Change is status 1 with the same Changes as check --json', async ({ lab }) => {
    const changed = await aChangedProject(lab, refusedGapRoots);

    const published = await publishedAgainst(lab, changed, '--json');
    const checked = await checkedAgainst(lab, changed, '--json');

    expect(published.ran.status).toBe(1);
    expect(JSON.parse(published.ran.stdout)).toMatchObject({
      status: 1,
      version: null,
      published: false,
    });
    expect(JSON.parse(published.ran.stdout).changes).toEqual(
      JSON.parse(checked.ran.stdout).changes,
    );
    expect(published.ran.stderr).toBe(`${refusedLine}\n`);
    expect(putRequestsOf(published.registry)).toEqual([]);
  });

  test('a tooling failure is the errors document, with its line on stderr', async ({ lab }) => {
    const project = await aGeneratedProject(lab, aRoot());
    withTsc(project, "console.error('tsc crashed'); process.exit(1);");

    const { ran } = await publishedAgainst(lab, { project, served: {} }, '--json');

    const line = `tsc on the Contract Package of ${ordersPackage}@1.0.0 failed: tsc crashed`;
    expect(ran).toEqual({
      status: 3,
      stdout: `${JSON.stringify({ format: 1, status: 3, errors: [line] })}\n`,
      stderr: `${line}\n`,
    });
  });

  test.skipIf(isRoot)(
    'a staging folder that cannot be removed is kept on stderr, and the document says it published',
    async ({ lab }) => {
      const project = await aGeneratedProject(lab, aRoot());
      withTsc(project, aTscThatLocksItsStaging('process.exit(0);'));
      try {
        const { ran } = await publishedAgainst(lab, { project, served: {} }, '--json');

        expect(JSON.parse(ran.stdout)).toMatchObject({ status: 0, published: true });
        expect(ran.stderr).toMatch(leftBehindLine);
      } finally {
        chmodSync(join(project, stagingFolder), 0o755);
      }
    },
  );
});

describe.concurrent('cf-loom check and publish derive one version', {
  timeout: publishTimeout,
}, () => {
  const zodLine = Number(zodVersion.split('.')[0]);
  const rows = [
    {
      name: 'a Neutral Change',
      roots: { before: aRoot(), after: aRoot({ description: 'Reads' }) },
      listed: [] as readonly string[],
      flags: [] as readonly string[],
    },
    { name: 'an Additive Change', roots: addedSuccessField, listed: [], flags: [] },
    { name: 'a Breaking Change', roots: removedSuccessField, listed: [], flags: [] },
    {
      name: 'a prerelease Baseline promoted',
      roots: unchangedRoots,
      listed: ['1.1.0-0'],
      flags: [],
    },
    {
      name: 'a prerelease Baseline with --prerelease',
      roots: addedSuccessField,
      listed: ['1.1.0-0'],
      flags: ['--prerelease'],
    },
    {
      name: 'a Change with --prerelease',
      roots: addedSuccessField,
      listed: [],
      flags: ['--prerelease'],
    },
  ] as const;

  test.for(rows)('over $name', async (row, { lab }) => {
    const changed = await aChangedProject(lab, row.roots, row.listed);

    const checked = await checkedAgainst(lab, changed, '--json', ...row.flags);
    const published = await publishedAgainst(lab, changed, '--json', ...row.flags);

    const version = JSON.parse(checked.ran.stdout).version;
    expect(version).not.toBeNull();
    expect(JSON.parse(published.ran.stdout)).toMatchObject({ version, published: true });
    expect(putsOf(published.registry).map((put) => put.version)).toEqual([version]);
  });

  test.for([
    { name: 'a peer major', zod: `^${zodLine - 1}.0.0` },
    { name: 'a peer minor', zod: `^${zodLine}.0.0` },
  ])('over $name', async ({ zod }, { lab }) => {
    const project = await aGeneratedProject(lab, aRoot());
    const older = withPeers(publishedAs(project, '1.0.0'), { ...installedPeers, zod });
    const changed = { project, served: servedAs(ordersPackage, older) };

    const checked = await checkedAgainst(lab, changed, '--json');
    const published = await publishedAgainst(lab, changed, '--json');

    const version = JSON.parse(checked.ran.stdout).version;
    expect(version).not.toBeNull();
    expect(JSON.parse(published.ran.stdout)).toMatchObject({ version, published: true });
  });

  test('over a package never published', async ({ lab }) => {
    const project = await aGeneratedProject(lab, aRoot());

    const checked = await checkedAgainst(lab, { project, served: {} }, '--json');
    const published = await publishedAgainst(lab, { project, served: {} }, '--json');

    expect(JSON.parse(published.ran.stdout).version).toBe(JSON.parse(checked.ran.stdout).version);
    expect(JSON.parse(published.ran.stdout).published).toBe(true);
  });
});

/** The one document `--json` printed: a single line of stdout, parsed. */
function documentOf(ran: { readonly stdout: string }): Record<string, unknown> {
  const lines = ran.stdout.split('\n');
  expect(lines).toHaveLength(2);
  expect(lines[1]).toBe('');
  return JSON.parse(lines[0] ?? '');
}

describe('cf-loom generate --json', () => {
  const movedFrom = 'src/http/ping.handler.ts';
  const movedTo = 'src/api/ping.handler.ts';

  /** A project whose Handler was written under one layout and is now placed under another. */
  function aProjectWhoseHandlerMoves(): string {
    const project = aProject({
      'cf-loom.config.ts': aConfigWith("{ endpoint: 'src/http/{name}.handler.ts' }"),
      ...aRoot(),
    });
    cfLoom(project, 'generate');
    write(project, {
      'cf-loom.config.ts': aConfigWith("{ endpoint: 'src/api/{name}.handler.ts' }"),
    });
    return project;
  }

  test('lists the Handlers it moved, the files it wrote and the files it deleted, as its lines name them', () => {
    const project = aProjectWhoseHandlerMoves();

    const ran = cfLoom(project, 'generate', '--json');

    expect(documentOf(ran)).toMatchObject({
      format: 1,
      status: 0,
      moved: [{ from: movedFrom, to: movedTo }],
      wrote: expect.arrayContaining(['contract.snapshot.json']),
      deleted: [],
    });
  });

  test.skipIf(isRoot)(
    'keeps the Handlers it moved beside the error when a write then fails',
    () => {
      const project = aProjectWhoseHandlerMoves();
      chmodSync(project, 0o555);

      let ran: ReturnType<typeof cfLoom>;
      try {
        ran = cfLoom(project, 'generate', '--json');
      } finally {
        chmodSync(project, 0o755);
      }

      const [line] = ran.stderr.split('\n');
      expect(ran.status).toBe(3);
      expect(documentOf(ran)).toEqual({
        format: 1,
        status: 3,
        errors: [line],
        moved: [{ from: movedFrom, to: movedTo }],
      });
    },
  );
});

describe('cf-loom --json on every command', () => {
  const generatedProject = () => {
    const project = aProject({ 'cf-loom.config.ts': config, ...aRoot() });
    cfLoom(project, 'generate');
    return project;
  };

  test('init lists what it created, and what it updated in a .gitattributes it finds', () => {
    const fresh = aProject();
    const attributed = aProject({ '.gitattributes': '* text=auto\n' });

    const created = cfLoom(fresh, 'init', '--json');
    const updated = cfLoom(attributed, 'init', '--json');

    expect(documentOf(created)).toEqual({
      format: 1,
      status: 0,
      created: ['src/contract/index.ts', '.gitattributes'],
      updated: [],
    });
    expect(documentOf(updated)).toEqual({
      format: 1,
      status: 0,
      created: ['src/contract/index.ts'],
      updated: ['.gitattributes'],
    });
  });

  test('verify lists the files it found up to date', () => {
    const project = generatedProject();

    const ran = cfLoom(project, 'verify', '--json');

    const lines = cfLoom(project, 'verify').stdout.split('\n').filter(Boolean);
    const upToDate = lines.map((line) => line.replace(/ is up to date$/, ''));
    expect(documentOf(ran)).toEqual({ format: 1, status: 0, upToDate });
  });

  test('package names the folder it wrote', () => {
    const project = generatedProject();

    const ran = cfLoom(project, 'package', '--json', '--out', 'out');

    expect(documentOf(ran)).toEqual({ format: 1, status: 0, wrote: 'out' });
    expect(existsSync(join(project, 'out/package.json'))).toBe(true);
  });

  test.for(['openapi', 'asyncapi'] as const)(
    '%s prints its document on one line, where it prints it indented without --json',
    (command) => {
      const project = generatedProject();

      const json = cfLoom(project, command, '--json');
      const flagless = cfLoom(project, command);

      expect(documentOf(json)).toEqual({
        format: 1,
        status: 0,
        document: JSON.parse(flagless.stdout),
      });
      expect(flagless.stdout.split('\n').length).toBeGreaterThan(2);
    },
  );

  test('--help and help <command> print the usage as a document', () => {
    const project = aProject();

    const all = cfLoom(project, '--help', '--json');
    const one = cfLoom(project, 'help', 'check', '--json');

    expect(documentOf(all)).toEqual({
      format: 1,
      status: 0,
      usage,
    });
    expect(documentOf(one)).toEqual({
      format: 1,
      status: 0,
      usage: 'Usage: cf-loom check [--json] [--prerelease] [--against <version|dist-tag>]',
    });
  });

  test('--version prints the CLI’s name, version and Snapshot format as a document', () => {
    const project = aProject();

    const ran = cfLoom(project, '--version', '--json');

    expect(documentOf(ran)).toEqual({
      format: 1,
      status: 0,
      name: '@cf-loom/cli',
      version: cliVersion,
      snapshotFormat: 1,
    });
  });

  test.for([
    'init',
    'generate',
    'verify',
    'package',
    'check',
    'broker-plan',
    'openapi',
    'asyncapi',
    'publish',
  ])('%s is not refused --json', (command) => {
    const project = aProject();

    const ran = cfLoom(project, command, '--json');

    expect(ran.stderr).not.toContain('take --json');
    expect(documentOf(ran)).toMatchObject({ format: 1, status: ran.status });
  });
});

describe('cf-loom --json prints exactly one document, whatever the exit', () => {
  const staleProject = () => aProject({ 'cf-loom.config.ts': config, ...aRoot() });
  const brokenJson = () =>
    aProject({
      'cf-loom.config.ts': config,
      ...aRoot(),
      'contract.snapshot.json': '<<<<<<< HEAD\n',
    });
  const offline = ['generate', 'verify', 'package', 'broker-plan', 'openapi', 'asyncapi'] as const;
  const registered = ['check', 'publish'] as const;

  test.for(offline)('%s on success', (command) => {
    const project = staleProject();
    if (command !== 'generate') {
      cfLoom(project, 'generate');
    }

    const ran = cfLoom(project, command, '--json');

    expect(documentOf(ran)).toMatchObject({ format: 1, status: 0 });
    expect(ran.status).toBe(0);
    expect(ran.stderr).toBe('');
  });

  test.for([...offline.filter((command) => command !== 'generate'), ...registered])(
    '%s on a Snapshot out of date, exit 1',
    (command) => {
      const project = staleProject();

      const ran = cfLoom(project, command, '--json');

      const errors = ran.stderr.split('\n').filter(Boolean);
      expect(ran.status).toBe(1);
      expect(documentOf(ran)).toEqual({ format: 1, status: 1, errors });
    },
  );

  test.for([
    ...offline.filter((command) => command !== 'verify' && command !== 'generate'),
    ...registered,
  ])('%s on a Snapshot that is no JSON, exit 3', (command) => {
    const project = brokenJson();

    const ran = cfLoom(project, command, '--json');

    const [line] = ran.stderr.split('\n');
    expect(ran.status).toBe(3);
    expect(documentOf(ran)).toEqual({ format: 1, status: 3, errors: [line] });
  });

  test.for([
    'init',
    'generate',
    'verify',
    'package',
    'check',
    'broker-plan',
    'openapi',
    'asyncapi',
    'publish',
  ])('%s called wrongly', (command) => {
    const project = aProject();

    const ran = cfLoom(project, command, 'now', 'then', '--json');

    const [line] = ran.stderr.split('\n');
    expect(ran.status).toBe(3);
    expect(documentOf(ran)).toEqual({ format: 1, status: 3, errors: [line] });
  });
});

describe.concurrent('cf-loom --json, check and publish', { timeout: publishTimeout }, () => {
  test('check on a Breaking Change, exit 2, and publish --dry-run on success', async ({ lab }) => {
    const changed = await aChangedProject(lab, removedSuccessField);

    const checked = await checkedAgainst(lab, changed, '--json');
    const dry = await publishedAgainst(lab, changed, '--json', '--dry-run');

    const errors = checked.ran.stderr.split('\n').filter(Boolean);
    expect(documentOf(checked.ran)).toMatchObject({ format: 1, status: 2, errors });
    expect(checked.ran.status).toBe(2);
    expect(documentOf(dry.ran)).toMatchObject({ format: 1, status: 0, published: false });
    expect(documentOf(dry.ran)).not.toHaveProperty('errors');
  });

  test('check on a refused Change, exit 1, says what stderr says', async ({ lab }) => {
    const changed = await aChangedProject(
      lab,
      {
        before: aRoot({ lifecycle: 'active' }),
        after: aRoot({ lifecycle: 'retired' }),
      },
      ['1.0.0-0'],
    );

    const { ran } = await checkedAgainst(lab, changed, '--json');

    const errors = ran.stderr.split('\n').filter(Boolean);
    expect(errors).toEqual([expect.stringContaining('refused')]);
    expect(documentOf(ran)).toMatchObject({ format: 1, status: 1, errors });
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

    const ran = cfLoom(project, 'generate', '--verbose');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: `Unknown option: --verbose. ${usage}\n`,
    });
  });

  test('only check takes --against', () => {
    const project = aProject();

    const ran = cfLoom(project, 'publish', '--against', '1.0.0');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: `Only check takes --against. ${usage}\n`,
    });
  });

  test.for([['--against'], ['--against=']] as const)(
    '--against takes a version or a dist-tag: check %s',
    (flags) => {
      const project = aProject();

      const ran = cfLoom(project, 'check', ...flags);

      expect(ran).toEqual({
        status: 3,
        stdout: '',
        stderr: `--against takes a version or a dist-tag. ${usage}\n`,
      });
    },
  );

  test('check takes no argument', () => {
    const project = aProject();

    const ran = cfLoom(project, 'check', 'now');

    expect(ran).toEqual({ status: 3, stdout: '', stderr: `check takes no argument. ${usage}\n` });
  });

  test('a usage error under --json is the errors document on stdout and its one line on stderr', () => {
    const project = aProject();

    const ran = cfLoom(project, 'check', 'now', '--json');

    const line = `check takes no argument. ${usage}`;
    expect(ran).toEqual({ status: 3, stdout: errorsDocument(line), stderr: `${line}\n` });
  });

  test('an unknown option under --json is the errors document too', () => {
    const project = aProject();

    const ran = cfLoom(project, 'check', '--json', '--now');

    const line = `Unknown option: --now. ${usage}`;
    expect(ran).toEqual({ status: 3, stdout: errorsDocument(line), stderr: `${line}\n` });
  });

  test('--json takes no value', () => {
    const project = aProject();

    const ran = cfLoom(project, 'check', '--json=false');

    const line = `--json takes no value. ${usage}`;
    expect(ran).toEqual({ status: 3, stdout: errorsDocument(line), stderr: `${line}\n` });
  });

  test.for([
    ['--json=false', '--json'],
    ['--json=true', '--json'],
    ['--json', '--json=false'],
  ] as const)('--json takes no value, however often it is given: %s %s', ([first, second]) => {
    const project = aProject();

    const ran = cfLoom(project, 'check', first, second);

    const line = `--json takes no value. ${usage}`;
    expect(ran).toEqual({ status: 3, stdout: errorsDocument(line), stderr: `${line}\n` });
  });

  test('a throw is a tooling error that says cf-loom failed and where in cf-loom, never a stack trace', () => {
    const ran = cfLoomInRemovedFolder('generate');

    expect(ran.status).toBe(3);
    expect(ran.stdout).toBe('');
    expect(ran.stderr).toMatch(/^cf-loom failed: \S+:\d+: ENOENT[^\n]*\n$/);
  });

  test.for([
    ['\\r', '\r'],
    ['\\u0085', '\u0085'],
    ['\\u2028', '\u2028'],
    ['\\u2029', '\u2029'],
  ] as const)(
    'a throw whose message holds %s ends as one line, with the line break written escaped',
    ([visible, character]) => {
      const ran = cfLoomThrowing(`boom${character}tail`, 'generate');

      expect(ran.status).toBe(3);
      expect(ran.stdout).toBe('');
      expect(ran.stderr.split('\n')).toHaveLength(2);
      expect(ran.stderr).toMatch(
        new RegExp(`^cf-loom failed: \\S+:\\d+: boom\\${visible}tail\\n$`),
      );
    },
  );

  test.for([
    ['\\r', '\r'],
    ['\\u2028', '\u2028'],
  ] as const)(
    'check --json writes the document of a throw whose message holds %s on one line too',
    ([visible, character]) => {
      const ran = cfLoomThrowing(`boom${character}tail`, 'check', '--json');

      const [document, ...rest] = ran.stdout.split('\n');
      expect(rest).toEqual(['']);
      expect(ran.stdout).not.toContain(character);
      expect(JSON.parse(document ?? '')).toMatchObject({ status: 3 });
      expect(ran.stderr.split('\n')).toHaveLength(2);
      expect(ran.stderr).toMatch(
        new RegExp(`^cf-loom failed: \\S+:\\d+: boom\\${visible}tail\\n$`),
      );
    },
  );

  test('check --json writes the document of a throw too, and stderr keeps its line', () => {
    const ran = cfLoomInRemovedFolder('check', '--json');

    const errors = ran.stderr.trimEnd().split('\n');
    expect(ran.status).toBe(3);
    expect(errors).toEqual([expect.stringMatching(/^cf-loom failed: \S+:\d+: ENOENT/)]);
    expect(ran.stdout.split('\n')).toHaveLength(2);
    expect(JSON.parse(ran.stdout)).toEqual({ format: 1, status: 3, errors });
  });
});
