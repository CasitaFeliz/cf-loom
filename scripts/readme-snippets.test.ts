import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { readmeScope } from './readme-scope.ts';
import { type Readme, snippetProblems } from './readme-snippets.ts';

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
