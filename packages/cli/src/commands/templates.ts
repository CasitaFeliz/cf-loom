import type { RootKind } from '@cf-loom/contract/internal';
import { rootPlaces } from '../loading/index.ts';

/** A Root that declares nothing yet, exported under the conventional name, named when it has a name. */
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
