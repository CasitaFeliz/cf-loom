import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { Readme } from './readme-blocks.ts';
import { readmeScope } from './readme-scope.ts';
import { snippetProblems } from './readme-snippets.ts';

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

describe('the READMEs', () => {
  test('every TypeScript block of the contract, handlers, messaging and server READMEs type-checks', () => {
    const paths = ['contract', 'handlers', 'messaging', 'server'].map(
      (name) => `packages/${name}/README.md`,
    );
    const readmes = paths.map((path) => ({
      path,
      markdown: readFileSync(join(root, path), 'utf8'),
    }));

    const problems = snippetProblems(readmes, readmeScope);

    expect(problems).toEqual([]);
  });
});
