import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { Readme } from './readme-blocks.ts';
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
  readmes: Partial<Record<'contract' | 'handlers' | 'messaging' | 'server', string>>,
  scope: Record<string, string> = {},
): string {
  const repository = mkdtempSync(join(tmpdir(), 'readme-repository-'));
  repositories.push(repository);
  const files: Record<string, string> = {
    'packages/contract/src/index.ts': "export { defineGuard } from './declarations/index.ts';\n",
    ...Object.fromEntries(
      ['contract', 'handlers', 'messaging', 'server'].map((name) => [
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

describe('the READMEs', () => {
  test('Vitest writes the README Service when it loads its configuration', () => {
    expect(existsSync(join(root, '.readme-service', 'tsconfig.json'))).toBe(true);
  });

  test('every TypeScript block of the contract, handlers, messaging and server READMEs type-checks', () => {
    const problems = readmeServiceProblems(join(root, '.readme-service'));

    expect(problems).toEqual([]);
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
