import { type RootKind, rootPlaces } from '../loading/index.ts';

/** A root that declares nothing yet, under the export the CLI loads it from. */
export function rootTemplateOf(kind: RootKind, name: string): string {
  const { define, exported } = rootPlaces[kind];
  const fields =
    kind === 'application' ? [`  name: '${name}',`, '  dependencies: [],'] : [`  name: '${name}',`];
  return lines([
    `import { ${define} } from '@cf-loom/contract';`,
    '',
    `export const ${exported} = ${define}({`,
    ...fields,
    '});',
  ]);
}

/** The configuration `init` writes, with the scope of the project's package.json. */
export function configTemplateOf(scope: string): string {
  return lines([
    "import { defineConfig } from '@cf-loom/cli';",
    '',
    `export const config = defineConfig({ scope: '${scope}' });`,
  ]);
}

function lines(written: readonly string[]): string {
  return `${written.join('\n')}\n`;
}
