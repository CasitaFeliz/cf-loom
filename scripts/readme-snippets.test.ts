import {
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
import { afterEach, describe, expect, test } from 'vitest';
import type { Readme } from './readme-blocks.ts';
import { compile } from './readme-compile.ts';
import { readmeServiceProblems, snippetProblems, writeReadmeService } from './readme-snippets.ts';

const root = join(import.meta.dirname, '..');
const fence = '```';

function aReadme(path: string, ...blocks: string[]): Readme {
  const markdown = blocks.map((block) => `Text.\n\n${fence}ts\n${block}\n${fence}\n`).join('\n');
  return { path, markdown };
}

describe('the README snippet check', () => {
  test('a snippet with a type error is reported with its README and its line', () => {
    const readme = aReadme('FIXTURE.md', "const quantity: number = 'three';");

    const problems = snippetProblems([readme], {});

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^FIXTURE\.md:4: error TS2322/);
  });

  test('a snippet may leave out the imports of zod, @cf-loom/contract and of what another snippet exports', () => {
    const declaration = aReadme(
      'FIXTURE.md',
      [
        '// src/contract/rejections/order-locked.rejection.ts',
        "export const orderLocked = defineRejection({ code: 'LOCKED', status: 409, message: 'Locked', body: z.object({ lockedAt: z.iso.datetime() }) });",
      ].join('\n'),
      [
        '// src/contract/endpoints/orders/lock-order.endpoint.ts',
        "export const lockOrder = defineEndpoint({ name: 'lockOrder', method: 'POST', path: '/orders/:orderId/lock', visibility: 'internal', description: 'Locks', input: { params: z.object({ orderId: z.uuid() }) }, success: { status: 204 }, rejections: [orderLocked] });",
      ].join('\n'),
    );

    const problems = snippetProblems([declaration], {});

    expect(problems).toEqual([]);
  });

  test('a snippet that leaves out a name nothing provides is reported', () => {
    const readme = aReadme('FIXTURE.md', 'export const total = unknownRepository.count();');

    const problems = snippetProblems([readme], {});

    expect(problems).toEqual([
      expect.stringMatching(/^FIXTURE\.md:4: error TS2304.*unknownRepository/),
    ]);
  });

  test('a name the scope exports is imported from the scope', () => {
    const readme = aReadme('FIXTURE.md', 'export const total = await repository.count();');
    const scope = {
      'src/repository.ts': 'export declare const repository: { count(): Promise<number> };',
    };

    const problems = snippetProblems([readme], scope);

    expect(problems).toEqual([]);
  });

  test('a block imports the names its own package declares and its own declarations stand', () => {
    const readme = aReadme(
      'FIXTURE.md',
      [
        '// definitions/src/definitions/guards/api-key.guard.ts',
        "export const apiKey = defineGuard({ name: 'apiKey', description: 'A key' });",
      ].join('\n'),
      ['// definitions/src/definitions/index.ts', 'export const guards = [apiKey];'].join('\n'),
      [
        '// src/main.ts',
        'const repository = { count: () => 1 };',
        'export const shape = { apiKey: 1 };',
      ].join('\n'),
    );
    const scope = { 'src/repository.ts': 'export declare const repository: { count(): number };' };

    const problems = snippetProblems([readme], scope);

    expect(problems).toEqual([]);
  });

  test('a block does not import a name that another package declares', () => {
    const readme = aReadme(
      'FIXTURE.md',
      [
        '// definitions/src/definitions/guards/api-key.guard.ts',
        "export const apiKey = defineGuard({ name: 'apiKey', description: 'A key' });",
      ].join('\n'),
      ['// src/guards/api-key.handler.ts', 'export const guard = apiKey;'].join('\n'),
    );

    const problems = snippetProblems([readme], {});

    expect(problems).toEqual([expect.stringMatching(/^FIXTURE\.md:12: error TS2304.*apiKey/)]);
  });

  test('a name declared by a block and by the scope is reported', () => {
    const readme = aReadme(
      'FIXTURE.md',
      'export const repository = { count: (): string => "none" };',
    );
    const scope = { 'src/repository.ts': 'export declare const repository: { count(): number };' };

    const problems = snippetProblems([readme], scope);

    expect(problems).toEqual([expect.stringMatching(/^FIXTURE\.md:4: .*repository.*scope/)]);
  });

  test('a TypeScript block that is never closed is reported', () => {
    const readme = { path: 'FIXTURE.md', markdown: `Text.\n\n${fence}ts\nconst quantity = 1;\n` };

    const problems = snippetProblems([readme], {});

    expect(problems).toEqual([expect.stringMatching(/^FIXTURE\.md:3: .*never closed/)]);
  });

  test.each([
    ['a space after ts', `${fence}ts \nconst quantity: number = 'three';\n${fence}\n`],
    ['CRLF line ends', `${fence}ts\r\nconst quantity: number = 'three';\r\n${fence}\r\n`],
    ['typescript', `${fence}typescript\nconst quantity: number = 'three';\n${fence}\n`],
    ['an indent', `  ${fence}ts\n  const quantity: number = 'three';\n  ${fence}\n`],
  ])('a block opened with %s is type-checked', (_, block) => {
    const readme = { path: 'FIXTURE.md', markdown: `Text.\n\n${block}` };

    const problems = snippetProblems([readme], {});

    expect(problems).toEqual([expect.stringMatching(/^FIXTURE\.md:4: error TS2322/)]);
  });

  test('an error tsc reports with no location is a problem', () => {
    const readme = aReadme('FIXTURE.md', 'export const quantity = 1;');
    const options = { compilerOptions: { types: ['nodex'] }, include: ['**/*.ts'] };

    const problems = snippetProblems([readme], { 'tsconfig.json': JSON.stringify(options) });

    expect(problems).toEqual([expect.stringMatching(/error TS2688/)]);
  });
});

const repositories: string[] = [];

afterEach(() => {
  for (const repository of repositories.splice(0)) {
    rmSync(repository, { recursive: true, force: true });
  }
});

/** A repository with `packages/contract/src/index.ts` and no built package, to write a Service from. */
function aRepository(
  readmes: Partial<
    Record<'contract' | 'handlers' | 'messaging' | 'server' | 'client' | 'testing', string>
  >,
  scope: Record<string, string> = {},
): string {
  const repository = mkdtempSync(join(tmpdir(), 'readme-repository-'));
  repositories.push(repository);
  const files: Record<string, string> = {
    'packages/contract/src/index.ts': "export { defineGuard } from './declarations/index.ts';\n",
    ...Object.fromEntries(
      ['contract', 'handlers', 'messaging', 'server', 'client', 'testing'].map((name) => [
        `packages/${name}/README.md`,
        readmes[name as 'contract'] ?? `# ${name}\n`,
      ]),
    ),
    ...Object.fromEntries(
      Object.entries(scope).map(([path, source]) => [`scripts/readme-service/${path}`, source]),
    ),
  };
  mkdirSync(join(repository, 'scripts/readme-service'), { recursive: true });
  mkdirSync(join(repository, 'examples/billing-service'), { recursive: true });
  symlinkSync(
    join(root, 'examples/billing-service/node_modules'),
    join(repository, 'examples/billing-service/node_modules'),
  );
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(repository, path)), { recursive: true });
    writeFileSync(join(repository, path), source);
  }
  return repository;
}

function serviceWrittenFrom(readme: string): string {
  const repository = aRepository({ handlers: readme });
  const directory = join(repository, '.readme-service');
  writeReadmeService(directory, repository);
  return directory;
}

function fileOf(directory: string, path: string): string {
  return readFileSync(join(directory, path), 'utf8');
}

/** The scope's files of a Service in `folder`, which is `''` for the README's own, whose Contract lists no Group. */
function aServiceScope(folder: string, name: string): Record<string, string> {
  return {
    [`${folder}package.json`]: JSON.stringify({
      name: `@org/${name}`,
      version: '0.0.0',
      type: 'module',
    }),
    [`${folder}src/contract/index.ts`]: [
      "import { defineService } from '@cf-loom/contract';",
      '',
      `export const contract = defineService({ name: '${name}', groups: [] });`,
    ].join('\n'),
  };
}

/** The scope's files of the README's own Service, whose Group lists the one Endpoint `anOrdersEndpoint` shows. */
function anOrdersScope(): Record<string, string> {
  return {
    ...aServiceScope('', 'orders-service'),
    'src/contract/index.ts': [
      "import { defineService } from '@cf-loom/contract';",
      "import { ordersGroup } from './groups/orders.group.ts';",
      '',
      "export const contract = defineService({ name: 'orders-service', groups: [ordersGroup] });",
    ].join('\n'),
    'src/contract/groups/orders.group.ts': [
      "import { defineGroup } from '@cf-loom/contract';",
      "import { getOrder } from '../endpoints/orders/get-order.endpoint.ts';",
      '',
      "export const ordersGroup = defineGroup({ name: 'orders', description: 'Orders', endpoints: [getOrder] });",
    ].join('\n'),
  };
}

/** The block of the Endpoint of `anOrdersScope`, which leaves out its use of `success` to `successLine`. */
function anOrdersEndpoint(successLine: string): string {
  return [
    '// src/contract/endpoints/orders/get-order.endpoint.ts',
    "import { defineEndpoint } from '@cf-loom/contract';",
    '',
    'export const getOrder = defineEndpoint({',
    "  name: 'getOrder',",
    "  method: 'GET',",
    "  path: '/orders',",
    "  visibility: 'public',",
    "  description: 'Gets the orders',",
    `  ${successLine}`,
    '});',
  ].join('\n');
}

/** The block of an Endpoint at `path` that no Group lists. */
function anUnlistedEndpoint(path: string): string {
  return [
    `// ${path}`,
    "import { defineEndpoint } from '@cf-loom/contract';",
    "import { z } from 'zod';",
    '',
    'export const unlisted = defineEndpoint({',
    "  name: 'unlisted',",
    "  method: 'GET',",
    "  path: '/unlisted',",
    "  visibility: 'public',",
    "  description: 'Listed in no Group',",
    '  success: { status: 200, body: z.object({}) },',
    '});',
  ].join('\n');
}

/** The repository with the packages `examples/billing-service` installs but zod, whose types a Contract Package needs. */
function withoutZod(repository: string): string {
  const installed = join(repository, 'examples/billing-service/node_modules');
  rmSync(installed);
  mkdirSync(installed);
  for (const name of readdirSync(join(root, 'examples/billing-service/node_modules'))) {
    if (name !== 'zod') {
      symlinkSync(join(root, 'examples/billing-service/node_modules', name), join(installed, name));
    }
  }
  return repository;
}

describe('paths', () => {
  test('a path two blocks name is a problem', () => {
    const first = aReadme('FIRST.md', ['// src/main.ts', 'export const first = 1;'].join('\n'));
    const second = aReadme('SECOND.md', ['// src/main.ts', 'export const second = 2;'].join('\n'));

    const problems = snippetProblems([first, second], {});

    expect(problems).toEqual([
      expect.stringMatching(
        /^SECOND\.md:4: src\/main\.ts is also named at FIRST\.md:4: .*part of a file names no path/,
      ),
    ]);
  });

  test('a path a block and the scope name is a problem', () => {
    const readme = aReadme('FIXTURE.md', ['// src/a.ts', 'export default 2;'].join('\n'));
    const scope = { 'src/a.ts': 'export default 1;' };

    const problems = snippetProblems([readme], scope);

    expect(problems).toEqual([
      expect.stringMatching(/^FIXTURE\.md:4: src\/a\.ts is also a file of the scope: /),
    ]);
  });

  test('a path two snippets would be written to is a problem', () => {
    const markdown = [
      '## Foo',
      aReadme('X.md', 'const one = 1;').markdown,
      aReadme('X.md', 'const two = 2;').markdown,
      '## Foo 2',
      aReadme('X.md', 'const three = 3;').markdown,
    ].join('\n');

    const problems = snippetProblems([{ path: 'packages/x/README.md', markdown }], {});

    expect(problems).toEqual([
      expect.stringMatching(
        /^packages\/x\/README\.md:\d+: snippets\/x-foo-2\.ts is also the snippet at packages\/x\/README\.md:\d+: .*heading/,
      ),
    ]);
  });

  test.each([
    '../escaped.ts',
    './src/a.ts',
    'src/../escaped.ts',
    'node_modules/.cache/escaped.ts',
    'node_modules/src/escaped.ts',
    'snippets/a.ts',
    'test/a.ts',
    'scope-packages/a.ts',
    'a.ts',
  ])('a path comment %s that is no path of a Service is a problem', (path) => {
    const readme = aReadme('FIXTURE.md', `// ${path}\nexport const x = 1;`);

    const problems = snippetProblems([readme], {});

    expect(problems).toEqual([
      `FIXTURE.md:4: ${path} is no path of a Service: src/… or <service>/src/…`,
    ]);
  });

  test('a block whose path comment is no path of a Service is written nowhere', () => {
    const repository = aRepository({
      handlers: aReadme(
        'packages/handlers/README.md',
        '// ../escaped.ts\nexport const x = 1;',
        '// ./src/a.ts\nexport const a = 1;',
      ).markdown,
    });
    const directory = join(repository, '.readme-service');

    writeReadmeService(directory, repository);

    expect(existsSync(join(repository, 'escaped.ts'))).toBe(false);
    expect(existsSync(join(directory, 'src/a.ts'))).toBe(false);
    expect(existsSync(join(directory, 'snippets'))).toBe(false);
  });

  test.each([
    'src/a.ts',
    'notes-service/src/contract/index.ts',
    'definitions/src/definitions/guards/api-key.guard.ts',
  ])('%s is a path of a Service', (path) => {
    const repository = aRepository({
      handlers: aReadme('packages/handlers/README.md', `// ${path}\nexport const x = 1;`).markdown,
    });
    const directory = join(repository, '.readme-service');

    writeReadmeService(directory, repository);

    expect(fileOf(directory, path)).toContain('export const x = 1;');
  });
});

describe('the README Service written out', () => {
  test('the README Service is written out without the packages being built', () => {
    const directory = serviceWrittenFrom(
      aReadme('packages/handlers/README.md', '// src/a.ts\nexport const a = 1;').markdown,
    );

    expect(fileOf(directory, 'src/a.ts')).toContain('export const a = 1;');
  });

  test('a block with two path comments is written as two files', () => {
    const block = [
      '// src/a.ts',
      'export const a = 1;',
      '',
      '// src/b.ts',
      'export const b = a + 1;',
    ].join('\n');

    const directory = serviceWrittenFrom(aReadme('packages/handlers/README.md', block).markdown);

    expect(fileOf(directory, 'src/a.ts')).not.toContain('const b');
    expect(fileOf(directory, 'src/b.ts')).toContain('export const b = a + 1;');
    expect(fileOf(directory, 'src/b.ts')).toContain("import { a } from './a.ts';");
  });

  test('a block without a path is written under its README heading and exports what it declares', () => {
    const markdown = [
      '# @cf-loom/handlers',
      '',
      "## Testing a Service's own code",
      '',
      `${fence}ts`,
      "import { thing } from '../src/thing.ts';",
      'const outcome = await thing();',
      'export const kept = outcome;',
      fence,
      '',
      `${fence}ts`,
      'const answer = 1;',
      fence,
      '',
    ].join('\n');

    const directory = serviceWrittenFrom(markdown);

    const first = fileOf(directory, 'snippets/handlers-testing-a-services-own-code.ts');
    expect(first).toContain('export { outcome };');
    expect(first).not.toContain('export { thing');
    expect(first).not.toContain('export { kept');
    const second = fileOf(directory, 'snippets/handlers-testing-a-services-own-code-2.ts');
    expect(second).toContain('export { answer };');
  });

  test('a word that only a string or a comment holds is no import', () => {
    const block = ['// src/label.ts', "export const label = 'orders'; // the orders"].join('\n');
    const repository = aRepository(
      { handlers: aReadme('packages/handlers/README.md', block).markdown },
      { 'src/service-code.ts': 'export const orders = [];' },
    );
    const directory = join(repository, '.readme-service');

    writeReadmeService(directory, repository);

    expect(fileOf(directory, 'src/label.ts')).not.toContain('import { orders }');
  });

  test('a package of the scope with no name stops the write-out, naming its package.json', () => {
    const repository = aRepository({}, { 'definitions/package.json': '{}' });
    const directory = join(repository, '.readme-service');

    const writing = () => writeReadmeService(directory, repository);

    expect(writing).toThrow(/definitions\/package\.json names no package/);
  });

  test('a test of the scope is written as it is, with no import added', () => {
    const repository = aRepository(
      {},
      {
        'src/service-code.ts': 'export const orders = [];',
        'test/x.readme.test.ts':
          'export function count() {\n  const orders = 1;\n  return orders;\n}',
      },
    );
    const directory = join(repository, '.readme-service');

    writeReadmeService(directory, repository);

    expect(fileOf(directory, 'test/x.readme.test.ts')).not.toContain('import');
  });

  test('a name a block without a path declares is no import for another block', () => {
    const readme = aReadme('FIXTURE.md', 'const shared = 1;', 'export const again = shared;');

    const problems = snippetProblems([readme], {});

    expect(problems).toEqual([expect.stringMatching(/^FIXTURE\.md:10: error TS2304.*shared/)]);
  });
});

/** The Service written from one block of the handlers README, which the scope's `src/service-code.ts` completes. */
function blockWrittenOut(code: string, serviceCode: string): string {
  const repository = aRepository(
    { handlers: aReadme('packages/handlers/README.md', `// src/use.ts\n${code}`).markdown },
    { 'src/service-code.ts': serviceCode },
  );
  const directory = join(repository, '.readme-service');
  writeReadmeService(directory, repository);
  return fileOf(directory, 'src/use.ts');
}

describe('the names a block leaves out', () => {
  test.each([
    ['an object key', 'export const shape = { orders: 1 };', ['orders']],
    ['a member after a dot', 'export const size = [].length;', ['length']],
    ['a member after ?.', 'export const size = [1]?.length;', ['length']],
    ['a type member', 'export type Shape = { orders: number };', ['orders']],
    [
      'a name every object has, used as a key',
      'export const shape = { toString: 1, constructor: 2 };',
      ['toString', 'constructor'],
    ],
    ['a class member that nothing reads bare', 'export class Holder { orders = 1; }', ['orders']],
    ['a global the scope also exports', 'export const request = fetch;', ['fetch', 'Request']],
    [
      'a parameter that shadows a scope name',
      'export function handle({ body }: { body: number }) { return body; }',
      ['body'],
    ],
  ])('a word a block does not use as a reference is no import: %s', (_, code, names) => {
    const serviceCode = names.map((name) => `export const ${name} = 1;`).join('\n');

    const source = blockWrittenOut(code, serviceCode);

    for (const name of names) {
      expect(source).not.toContain(`import { ${name} }`);
    }
  });

  test.each([
    { position: 'a value', code: 'export const total = ref + 1;', exported: 'const ref = 1' },
    { position: 'a type', code: 'export let total: ref;', exported: 'type ref = string' },
    {
      position: 'a shorthand property',
      code: 'export const total = { ref };',
      exported: 'const ref = 1',
    },
    {
      position: 'a namespace qualifier',
      code: 'export let total: ref.Inner;',
      exported: 'const ref = {}',
    },
    {
      position: 'typeof in a type',
      code: 'export let total: typeof ref;',
      exported: 'const ref = 1',
    },
    { position: 'a spread', code: 'export const total = [...ref];', exported: 'const ref = [1]' },
    {
      position: 'a ternary branch',
      code: 'export const total = Math.random() > 0.5 ? ref : 2;',
      exported: 'const ref = 1',
    },
    {
      position: 'a case label',
      code: 'switch (Math.random()) { case ref: break; }',
      exported: 'const ref = 1',
    },
    {
      position: 'a base class',
      code: 'export class Derived extends ref {}',
      exported: 'class ref {}',
    },
    {
      position: 'a non-null assertion',
      code: 'export const total = ref!;',
      exported: 'const ref = 1',
    },
    {
      position: 'an optional chain',
      code: 'export const total = ref?.length;',
      exported: 'const ref = ""',
    },
    {
      position: 'a default parameter',
      code: 'export function total(count = ref) { return count; }',
      exported: 'const ref = 1',
    },
    {
      position: 'a template expression',
      code: `export const total = \`\${ref}\`;`,
      exported: 'const ref = 1',
    },
    {
      position: 'a name close to one the block declares',
      code: 'const refs = [];\nexport const first = ref;',
      exported: 'const ref = 1',
    },
    {
      position: 'a bare name that an instance member has',
      code: 'export class Holder { ref = 1; read() { return ref; } }',
      exported: 'const ref = 1',
    },
    {
      position: 'a bare name that a static member has',
      code: 'export class Holder { static ref = 1; read() { return ref; } }',
      exported: 'const ref = 1',
    },
  ])('a name a block references as $position is imported from the scope', (row) => {
    const source = blockWrittenOut(row.code, `export ${row.exported};`);

    expect(source).toContain("import { ref } from './service-code.ts';");
  });

  test('no import the completion adds to the README Service is reported unused', () => {
    const service = join(root, '.readme-service');

    const unused = unusedCompletedImports(service);

    expect(unused).toEqual([]);
  });
});

const unusedCodes = new Set([6133, 6192, 6196]);
const importOfOneName = /^import \{ [\w$]+ \} from '[^']+';$/;

/** The imports the completion adds to a file, which it writes right above the file's last line, as rows. */
function completedImportRows(source: string): number[] {
  const lines = source.split('\n');
  const rows: number[] = [];
  const completedFile = lines.at(-2)?.startsWith('export {') === true;
  for (
    let row = lines.length - 2;
    completedFile && importOfOneName.test(lines[row - 1] ?? '');
    row--
  ) {
    rows.push(row);
  }
  return rows;
}

/** The imports the completion added that `tsc` reports unused, as `path:row`. */
function unusedCompletedImports(service: string): string[] {
  const { diagnostics } = compile(service, ['--noUnusedLocals']);
  const unused: string[] = [];
  for (const { path, row, code } of diagnostics) {
    if (
      path !== undefined &&
      unusedCodes.has(code) &&
      completedImportRows(fileOf(service, path)).includes(row)
    ) {
      unused.push(`${path}:${row}`);
    }
  }
  return unused;
}

/** The files of the written-out Service under a `src/contract/` folder, by their path. */
function contractFilesOf(service: string): string[] {
  const files = readdirSync(service, { recursive: true, encoding: 'utf8' });
  const sources = files.filter(
    (path) => !path.split('/').some((part) => part.startsWith('.') || part === 'node_modules'),
  );
  return sources.filter((path) => /(^|\/)src\/contract\/.*\.ts$/.test(path));
}

const importedModule = /(?:from|import)\s*["']([^"']+)["']/g;
const organizationsModule = /^(?:zod(?:\/.*)?|@cf-loom\/contract|@org\/.+)$/;

/** The modules a Contract file imports that are neither in its own `src/contract/` nor the Contract's dependencies, as `path: module`. */
function importsOutsideContract(service: string, path: string): string[] {
  const contract = `${path.slice(0, path.indexOf('src/contract/'))}src/contract/`;
  const specifiers = [...fileOf(service, path).matchAll(importedModule)].map(
    ([, module]) => module ?? '',
  );
  const outside = specifiers.filter((module) => {
    const resolved = join(dirname(path), module);
    return module.startsWith('.')
      ? !resolved.startsWith(contract)
      : !organizationsModule.test(module);
  });
  return outside.map((module) => `${path}: ${module}`);
}

describe('the READMEs', () => {
  test('Vitest writes the README Service when it loads its configuration', () => {
    expect(existsSync(join(root, '.readme-service', 'tsconfig.json'))).toBe(true);
  });

  test('every TypeScript block of the contract, handlers, messaging, server, client and testing READMEs type-checks', () => {
    const problems = readmeServiceProblems(join(root, '.readme-service'));

    expect(problems).toEqual([]);
  });

  test.each([
    { service: "the README's own Service", folder: '', name: 'orders-service' },
    { service: 'notes-service', folder: 'notes-service', name: 'notes-service' },
    { service: 'payments-service', folder: 'payments-service', name: 'payments-service' },
  ])(
    'the write-out runs cf-loom generate and package over $service and installs its Contract Package',
    ({ folder, name }) => {
      const service = join(root, '.readme-service');
      const installed = join(service, 'node_modules', '@org', `contract-${name}`);

      const handlerMap = readFileSync(join(service, folder, 'src/handlers.generated.ts'), 'utf8');
      const contractPackage = readFileSync(join(installed, 'package.json'), 'utf8');

      expect(handlerMap).toMatch(/^\/\/ Generated by cf-loom generate\./);
      expect(JSON.parse(contractPackage)).toMatchObject({ name: `@org/contract-${name}` });
      expect(realpathSync(installed)).toBe(
        realpathSync(join(service, folder, '.cf-loom/contract-package')),
      );
    },
  );

  test.each([
    { service: "the README's own Service", folder: '', name: 'orders-service' },
    { service: 'another Service', folder: 'payments-service/', name: 'payments-service' },
  ])('a block cf-loom refuses in $service is a problem at its README line', ({ folder, name }) => {
    const unlisted = anUnlistedEndpoint(
      `${folder}src/contract/endpoints/payments/unlisted.endpoint.ts`,
    );
    const repository = aRepository(
      { client: aReadme('packages/client/README.md', unlisted).markdown },
      aServiceScope(folder, name),
    );
    const directory = join(repository, '.readme-service');
    writeReadmeService(directory, repository);

    const problems = readmeServiceProblems(directory, repository);

    expect(problems).toContainEqual(
      expect.stringMatching(
        /^packages\/client\/README\.md:4: .*exports unlisted, which no Group lists/,
      ),
    );
  });

  test('a refusal that names no file is reported with the Service it comes from', () => {
    const repository = aRepository(
      {},
      { 'package.json': aServiceScope('', 'orders-service')['package.json'] ?? '' },
    );
    const directory = join(repository, '.readme-service');
    writeReadmeService(directory, repository);

    const problems = readmeServiceProblems(directory, repository);

    expect(problems).toContainEqual(
      expect.stringMatching(
        /^cf-loom generate: @org\/orders-service: No Root in src\/contract\/index\.ts/,
      ),
    );
  });

  test('a Service after a refused Service is not run, and the check says so', () => {
    const unlisted = anUnlistedEndpoint(
      'payments-service/src/contract/endpoints/payments/unlisted.endpoint.ts',
    );
    const repository = aRepository(
      { client: aReadme('packages/client/README.md', unlisted).markdown },
      {
        ...aServiceScope('payments-service/', 'payments-service'),
        ...aServiceScope('', 'orders-service'),
      },
    );
    const directory = join(repository, '.readme-service');
    writeReadmeService(directory, repository);

    const problems = readmeServiceProblems(directory, repository);

    expect(problems).toContainEqual(
      'cf-loom: @org/orders-service: not run: @org/payments-service was refused',
    );
    expect(existsSync(join(directory, 'src/handlers.generated.ts'))).toBe(false);
  });

  test("a Contract Package that fails to build is reported at its file, as the build's", () => {
    const bodiless = anOrdersEndpoint('success: { status: 204 },');
    const repository = withoutZod(
      aRepository(
        { contract: aReadme('packages/contract/README.md', bodiless).markdown },
        anOrdersScope(),
      ),
    );
    const directory = join(repository, '.readme-service');
    writeReadmeService(directory, repository);

    const problems = readmeServiceProblems(directory, repository);

    expect(problems).toContainEqual(
      expect.stringMatching(
        /^\.cf-loom\/contract-package\/src\/\S+\.ts:\d+: building the Contract Package of @org\/orders-service: error TS2307: .*'zod'/,
      ),
    );
  });

  test('a syntax error in one block is the only problem reported', () => {
    const endpoint = anOrdersEndpoint('success: { status: 200, body: z.object({}) },');
    const repository = aRepository(
      {
        contract: aReadme('packages/contract/README.md', endpoint).markdown,
        handlers: aReadme('packages/handlers/README.md', 'export const broken = (;').markdown,
      },
      anOrdersScope(),
    );
    const directory = join(repository, '.readme-service');
    writeReadmeService(directory, repository);

    const problems = readmeServiceProblems(directory, repository);

    expect(problems).toEqual([
      expect.stringMatching(/^packages\/handlers\/README\.md:4: error TS1109/),
    ]);
  });

  test('no Contract file of the README Service imports Service code', () => {
    const service = join(root, '.readme-service');

    const outside = contractFilesOf(service).flatMap((file) =>
      importsOutsideContract(service, file),
    );

    expect(outside).toEqual([]);
  });

  test('the check reports a block at its README line and leaves the folder it compiles as it is', () => {
    const repository = aRepository(
      {
        handlers: aReadme('packages/handlers/README.md', "const quantity: number = 'three';")
          .markdown,
      },
      {},
    );
    const directory = join(repository, '.readme-service');
    writeReadmeService(directory, repository);
    writeFileSync(join(directory, 'kept.txt'), 'kept');

    const problems = readmeServiceProblems(directory, repository);

    expect(problems).toEqual([
      expect.stringMatching(/^packages\/handlers\/README\.md:4: error TS2322/),
    ]);
    expect(readFileSync(join(directory, 'kept.txt'), 'utf8')).toBe('kept');
  });
});
