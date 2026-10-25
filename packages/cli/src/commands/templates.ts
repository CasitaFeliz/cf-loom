import { type RootKind, rootPlaces } from '../loading/index.ts';

/** A root that declares nothing yet, under the export the CLI loads it from, named when it has a name. */
export function rootTemplateOf(kind: RootKind, name: string): string {
  const { define, exported } = rootPlaces[kind];
  const imported = `import { ${define} } from '@cf-loom/contract';`;
  if (kind === 'definitions') {
    return lines([imported, '', `export const ${exported} = ${define}({});`]);
  }
  return lines([
    imported,
    '',
    `export const ${exported} = ${define}({`,
    `  name: '${name}',`,
    '});',
  ]);
}

function lines(written: readonly string[]): string {
  return `${written.join('\n')}\n`;
}
