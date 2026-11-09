import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { aFixture, cfLoom, lines, removeFixtures, write } from '../test/cli-project.ts';

const tsc = join(import.meta.dirname, '..', '..', '..', 'node_modules', '.bin', 'tsc');

type Kind = 'service' | 'application' | 'definitions';

const kinds: readonly Kind[] = ['service', 'application', 'definitions'];
const exportNames = ['contract', 'application', 'definitions', 'root', 'default'] as const;

const declarations: Readonly<Record<Kind, string>> = {
  service: "defineService({ name: 'orders-service' })",
  application: "defineApplication({ name: 'orders-service' })",
  definitions: 'defineDefinitions({})',
};

const layoutRefusals: Readonly<Record<Kind, string | undefined>> = {
  service: undefined,
  application: 'cf-loom.config.ts: an Application has no Handlers, so it takes no `layout`',
  definitions: 'cf-loom.config.ts: a Definitions Package has no Handlers, so it takes no `layout`',
};

/** A project around a Root of `kind`, which its Root file exports as `exportName`. */
function aRootProject(kind: Kind, exportName: string): Readonly<Record<string, string>> {
  const file = kind === 'definitions' ? 'src/definitions/index.ts' : 'src/contract/index.ts';
  const exported =
    exportName === 'default'
      ? 'export default declared;'
      : `export const ${exportName} = declared;`;
  return {
    'package.json': JSON.stringify({ name: '@org/orders-service', type: 'module' }),
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        allowImportingTsExtensions: true,
        module: 'nodenext',
        noEmit: true,
        skipLibCheck: true,
        strict: true,
        target: 'es2024',
        types: [],
      },
      include: ['src'],
    }),
    [file]: lines([
      "import { defineApplication, defineDefinitions, defineService } from '@cf-loom/contract';",
      '',
      `const declared = ${declarations[kind]};`,
      exported,
    ]),
  };
}

/** What one project did: `generate`, then `tsc` over a Service, then `generate` with a `layout` set. */
type Outcome = {
  readonly generated: number | null;
  readonly snapshotKind: unknown;
  readonly handlerMap: string | undefined;
  readonly typeCheck: number | null | undefined;
  readonly withLayout: { readonly status: number | null; readonly stderr: string };
};

const outcomes = new Map<string, Outcome>();

function keyOf(kind: Kind, exportName: string): string {
  return `${kind} exported as ${exportName}`;
}

/** The text of a file of the project, or nothing when `generate` wrote none. */
function textAt(project: string, path: string): string | undefined {
  const file = join(project, path);
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
}

function outcomeOf(kind: Kind, exportName: string): Outcome {
  const project = aFixture(aRootProject(kind, exportName));
  const generated = cfLoom(project, 'generate').status;
  const snapshot = textAt(project, 'contract.snapshot.json');
  const snapshotKind: unknown = snapshot === undefined ? undefined : JSON.parse(snapshot).kind;
  const handlerMap = textAt(project, 'src/handlers.generated.ts');
  const checked = handlerMap === undefined ? undefined : spawnSync(tsc, ['-p', project]);
  write(project, { 'cf-loom.config.ts': layoutConfig });
  const { status, stderr } = cfLoom(project, 'generate');
  const withLayout = { status, stderr };
  return { generated, snapshotKind, handlerMap, typeCheck: checked?.status, withLayout };
}

const layoutConfig = lines([
  "import { defineConfig } from '@cf-loom/cli';",
  '',
  "export const config = defineConfig({ layout: { endpoint: 'src/http/{name}.handler.ts' } });",
]);

beforeAll(() => {
  for (const kind of kinds) {
    for (const exportName of exportNames) {
      outcomes.set(keyOf(kind, exportName), outcomeOf(kind, exportName));
    }
  }
});

afterAll(removeFixtures);

function outcomeFor(kind: Kind, exportName: string): Outcome {
  const outcome = outcomes.get(keyOf(kind, exportName));
  if (outcome === undefined) {
    throw new Error(`No outcome for a ${keyOf(kind, exportName)}`);
  }
  return outcome;
}

const combinations = kinds.flatMap((kind) => exportNames.map((name) => [kind, name] as const));

describe('cf-loom generate: the Root is found by identity, under any name', () => {
  test.for(combinations)(
    'a Root of kind %s exported as %s generates the Snapshot of its kind',
    ([kind, name]) => {
      const outcome = outcomeFor(kind, name);

      expect(outcome.generated).toBe(0);
      expect(outcome.snapshotKind).toBe(kind);
    },
  );

  test.for(combinations)(
    'a Root of kind %s exported as %s takes a layout only when it is a Service',
    ([kind, name]) => {
      const { withLayout } = outcomeFor(kind, name);

      const refusal = layoutRefusals[kind];
      expect(withLayout.status).toBe(refusal === undefined ? 0 : 3);
      expect(withLayout.stderr).toBe(refusal === undefined ? '' : `${refusal}\n`);
    },
  );

  test.for(exportNames)(
    'a Service exported as %s generates a Handler map that type-checks',
    (name) => {
      const { handlerMap, typeCheck } = outcomeFor('service', name);

      const imported = name === 'contract' ? 'contract' : `${name} as contract`;
      expect(handlerMap).toContain(`import type { ${imported} } from './contract/index.ts';`);
      expect(handlerMap).toContain('} satisfies HandlerMapOf<typeof contract>;');
      expect(typeCheck).toBe(0);
    },
  );
});
