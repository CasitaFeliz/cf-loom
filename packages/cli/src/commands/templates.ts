import { type RootKind, rootPlaces } from '../loading/index.ts';

/** The define function each kind of root is declared with. */
const defineOf: Readonly<Record<RootKind, string>> = {
  service: 'defineContract',
  application: 'defineApplication',
  definitions: 'defineDefinitions',
};

/** A root that declares nothing yet, under the export the CLI loads it from. */
export function rootTemplateOf(kind: RootKind, name: string): string {
  const define = defineOf[kind];
  const fields =
    kind === 'application' ? [`  name: '${name}',`, '  dependencies: [],'] : [`  name: '${name}',`];
  return lines([
    `import { ${define} } from '@casitafeliz/loom-contract';`,
    '',
    `export const ${rootPlaces[kind].exported} = ${define}({`,
    ...fields,
    '});',
  ]);
}

/** The configuration `init` writes, with the scope of the project's package.json. */
export function configTemplateOf(scope: string): string {
  return lines([
    "import { defineConfig } from '@casitafeliz/loom-cli';",
    '',
    `export const config = defineConfig({ scope: '${scope}' });`,
  ]);
}

function lines(written: readonly string[]): string {
  return `${written.join('\n')}\n`;
}
