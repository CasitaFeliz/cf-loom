import type { RootFile } from '../loading/index.ts';

/** The kinds of root `init` creates, as the command names them. */
export const rootKinds = ['service', 'application', 'definitions'] as const;

/** A kind of root `init` creates. */
export type RootKind = (typeof rootKinds)[number];

/** Where `init` creates each kind of root. */
export function rootFileOf(kind: RootKind): RootFile {
  switch (kind) {
    case 'service':
    case 'application':
      return 'src/contract/index.ts';
    case 'definitions':
      return 'src/definitions/index.ts';
  }
}

/** A root that declares nothing yet, under the export the CLI loads it from. */
export function rootTemplateOf(kind: RootKind, name: string): string {
  switch (kind) {
    case 'service':
      return declaration('contract = defineContract', 'defineContract', [`  name: '${name}',`]);
    case 'application':
      return declaration('application = defineApplication', 'defineApplication', [
        `  name: '${name}',`,
        '  dependencies: [],',
      ]);
    case 'definitions':
      return declaration('definitions = defineDefinitions', 'defineDefinitions', [
        `  name: '${name}',`,
      ]);
  }
}

/** The configuration `init` writes, with the scope of the project's package.json. */
export function configTemplateOf(scope: string): string {
  return lines([
    "import { defineConfig } from '@casitafeliz/loom-cli';",
    '',
    `export const config = defineConfig({ scope: '${scope}' });`,
  ]);
}

function declaration(exported: string, define: string, fields: readonly string[]): string {
  return lines([
    `import { ${define} } from '@casitafeliz/loom-contract';`,
    '',
    `export const ${exported}({`,
    ...fields,
    '});',
  ]);
}

function lines(written: readonly string[]): string {
  return `${written.join('\n')}\n`;
}
