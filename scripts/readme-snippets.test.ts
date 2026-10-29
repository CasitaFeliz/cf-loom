import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { Readme } from './readme-blocks.ts';
import { readmeServiceProblems, snippetProblems, writeReadmeService } from './readme-snippets.ts';

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

  test('two blocks that name one path are each type-checked and reported at their own README and line', () => {
    const block = ['// src/main.ts', "const quantity: number = 'three';"].join('\n');
    const first = aReadme('FIRST.md', block);
    const second = aReadme('SECOND.md', block);

    const problems = snippetProblems([first, second], {});

    expect(problems).toHaveLength(2);
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^FIRST\.md:5: error TS2322/),
        expect.stringMatching(/^SECOND\.md:5: error TS2322/),
      ]),
    );
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

  test('when two blocks name one path, the later is the file the Service has', () => {
    const first = ['// src/a.ts', 'export const a = 1;'].join('\n');
    const later = ['// src/a.ts', 'export const a = 2;', 'export const more = a;'].join('\n');
    const user = ['// src/user.ts', 'export const user = more;'].join('\n');

    const directory = serviceWrittenFrom(
      aReadme('packages/handlers/README.md', first, later, user).markdown,
    );

    expect(fileOf(directory, 'src/a.ts')).toContain('export const a = 2;');
    expect(fileOf(directory, 'src/user.ts')).toContain("import { more } from './a.ts';");
  });

  test('a name a block without a path declares is no import for another block', () => {
    const readme = aReadme('FIXTURE.md', 'const shared = 1;', 'export const again = shared;');

    const problems = snippetProblems([readme], {});

    expect(problems).toEqual([expect.stringMatching(/^FIXTURE\.md:10: error TS2304.*shared/)]);
  });
});

describe('the READMEs', () => {
  test('every TypeScript block of the contract, handlers, messaging and server READMEs type-checks', () => {
    const directory = mkdtempSync(join(tmpdir(), 'readme-service-'));
    try {
      writeReadmeService(directory);

      const problems = readmeServiceProblems(directory);

      expect(problems).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
