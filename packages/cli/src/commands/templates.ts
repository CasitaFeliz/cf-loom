import { type RootKind, rootPlaces } from '../loading/index.ts';

/** A root that declares nothing yet, under the export the CLI loads it from. */
export function rootTemplateOf(kind: RootKind, name: string): string {
  const { define, exported } = rootPlaces[kind];
  return lines([
    `import { ${define} } from '@cf-loom/contract';`,
    '',
    `export const ${exported} = ${define}({`,
    `  name: '${name}',`,
    '});',
  ]);
}

function lines(written: readonly string[]): string {
  return `${written.join('\n')}\n`;
}
