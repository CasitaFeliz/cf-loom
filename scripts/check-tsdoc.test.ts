import { describe, expect, it } from 'vitest';
import { undocumentedExports } from './check-tsdoc.ts';

describe('undocumentedExports', () => {
  it('accepts an export with TSDoc directly above it', () => {
    const source =
      '/** Why it exists. */\nexport function statusOf(): number {\n  return 200;\n}\n';

    expect(undocumentedExports(source)).toEqual([]);
  });

  it('accepts a lint directive between the TSDoc and the export', () => {
    const source =
      '/**\n * Why it exists.\n */\n// biome-ignore lint/style/useNamingConvention: wire name\nexport const HTTP = 1;\n';

    expect(undocumentedExports(source)).toEqual([]);
  });

  it('reports an export with no comment, a line comment, or a blank line before its TSDoc', () => {
    const source = [
      'export type Bare = string;',
      '// Not TSDoc.',
      'export const lineComment = 1;',
      '/* Not TSDoc either. */',
      'export class BlockComment {}',
      '/** Detached. */',
      '',
      'export interface Detached {}',
    ].join('\n');

    expect(undocumentedExports(source)).toEqual([1, 3, 5, 8]);
  });

  it('ignores re-exports and the empty export', () => {
    const source =
      "export { serve } from './serve.ts';\nexport type { Outcome } from './outcome.ts';\nexport {};\n";

    expect(undocumentedExports(source)).toEqual([]);
  });

  it('accepts overloads that follow a documented first signature', () => {
    const source = [
      '/** Why it exists. */',
      'export function statusOf(code: string): number;',
      'export function statusOf(code: number): number;',
      'export function statusOf(code: string | number): number {',
      '  return Number(code);',
      '}',
    ].join('\n');

    expect(undocumentedExports(source)).toEqual([]);
  });

  it('reads CRLF line endings', () => {
    expect(
      undocumentedExports(
        '/** Why. */\r\nexport const status = 200;\r\nexport const bare = 1;\r\n',
      ),
    ).toEqual([3]);
  });
});
