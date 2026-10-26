import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const packagesDir = join(import.meta.dirname, '..', '..');
const tsc = join(packagesDir, '..', 'node_modules', '.bin', 'tsc');
const zodDir = realpathSync(join(packagesDir, 'cli', 'node_modules', 'zod'));

/** The name a project imports the Contract Package of payments-service by. */
export const paymentsSpecifier = '@org/contract-payments-service';

/** The module of a Provider's Contract Package, written by hand as `cf-loom package` writes one, exporting the Event `PaymentSettled@1`. */
export const paymentsSource = `${[
  "import { openEnumReader, providedEvent } from '@cf-loom/contract';",
  "import { z } from 'zod';",
  '',
  "export const paymentSettledV1 = providedEvent('payments-service', {",
  "  name: 'PaymentSettled',",
  '  version: 1,',
  "  visibility: 'internal',",
  "  description: 'A payment was settled',",
  '  body: z.object({ paymentId: z.uuid() }),',
  '});',
  '',
  'export const payments = {',
  "  name: 'payments-service',",
  '  endpoints: {},',
  '  events: { paymentSettledV1 },',
  '  standardRejections: {',
  '    invalidInput: {',
  "      code: 'INVALID_INPUT',",
  '      status: 400,',
  "      message: 'Invalid input',",
  `      body: z.object({ issues: z.array(z.object({ ${[
    "code: openEnumReader(['invalid_format', 'invalid_type', 'invalid_value', 'malformed', 'not_multiple', 'required', 'too_big', 'too_small', 'unrecognized_key'])",
    "in: openEnumReader(['body', 'headers', 'params', 'query'])",
    'message: z.string()',
    'path: z.array(z.union([z.string(), z.number()]))',
  ].join(', ')} })) }),`,
  '    },',
  "    notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },",
  "    notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },",
  '  },',
  '} as const;',
].join('\n')}\n`;

/** What a project installs of payments-service's Contract Package: its version, 5.1.0 unless given, `null` for none, and the TypeScript module it is built from. */
type Installed = { readonly version?: string | null; readonly source?: string };

/** The JavaScript and declarations `tsc` builds from a module, as the Contract Package a Service publishes is built. */
type Built = { readonly js: string; readonly declarations: string };

const builds = new Map<string, Built>();

/** A TypeScript module built once with the repository's `tsc`, which a project installs as JavaScript, since Node strips no types under `node_modules`. */
function builtFrom(source: string): Built {
  const known = builds.get(source);
  if (known !== undefined) {
    return known;
  }
  const folder = mkdtempSync(join(tmpdir(), 'cf-loom-payments-'));
  try {
    writeBuildFolder(folder, source);
    const ran = spawnSync(tsc, ['-p', folder], { encoding: 'utf8' });
    if (ran.status !== 0) {
      throw new Error(`The payments-service package does not build: ${ran.stdout}`);
    }
    const js = readFileSync(join(folder, 'dist/index.js'), 'utf8');
    const declarations = readFileSync(join(folder, 'dist/index.d.ts'), 'utf8');
    const built = { js, declarations };
    builds.set(source, built);
    return built;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/** The folder `tsc` builds a module in: an ES module package with the module as its `src/index.ts`, and the peers installed. */
function writeBuildFolder(folder: string, source: string): void {
  const compilerOptions = {
    declaration: true,
    module: 'nodenext',
    outDir: 'dist',
    rootDir: 'src',
    skipLibCheck: true,
    strict: true,
    target: 'es2024',
    types: [],
  };
  mkdirSync(join(folder, 'src'));
  writeFileSync(join(folder, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(join(folder, 'src/index.ts'), source);
  writeFileSync(
    join(folder, 'tsconfig.json'),
    JSON.stringify({ compilerOptions, include: ['src'] }),
  );
  linkPeers(folder);
}

function linkPeers(folder: string): void {
  const nodeModules = join(folder, 'node_modules');
  mkdirSync(join(nodeModules, '@cf-loom'), { recursive: true });
  symlinkSync(join(packagesDir, 'contract'), join(nodeModules, '@cf-loom/contract'), 'dir');
  symlinkSync(zodDir, join(nodeModules, 'zod'), 'dir');
}

/** Payments-service's Contract Package as a project installs it in `node_modules`, built from its module. */
export function installedPayments({
  version = '5.1.0',
  source = paymentsSource,
}: Installed = {}): Readonly<Record<string, string>> {
  const exports = { types: './index.d.ts', default: './index.js' };
  const named = { name: paymentsSpecifier, type: 'module', exports };
  const manifest = version === null ? named : { ...named, version };
  const { js, declarations } = builtFrom(source);
  const at = `node_modules/${paymentsSpecifier}`;
  return {
    [`${at}/package.json`]: JSON.stringify(manifest),
    [`${at}/index.js`]: js,
    [`${at}/index.d.ts`]: declarations,
  };
}
