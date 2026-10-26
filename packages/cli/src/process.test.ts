import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, openSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { bin, type Closing, cfLoomClosing } from '../test/cf-loom-run.ts';
import {
  aContractProject,
  aGeneratedProject,
  aProject,
  cfLoom,
  cfLoomOffline,
  removeProjects,
  write,
} from '../test/cli-project.ts';
import { usage } from '../test/usage.ts';

afterEach(removeProjects);

const cliVersion: string = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'),
).version;

/** Root may write in any folder, so a permission test means nothing when run as root. */
const isRoot = process.getuid?.() === 0;

/** A project with only a package.json, as `init` finds one. */
const aBarePackage = {
  'package.json': JSON.stringify({ name: '@org/orders-service', type: 'module' }),
};

/** A Service with one Endpoint, `ping`. */
const aService = aContractProject([
  "import { defineContract, defineEndpoint, defineGroup } from '@cf-loom/contract';",
  "import { z } from 'zod';",
  'export const ping = defineEndpoint({',
  "  name: 'ping',",
  "  method: 'GET',",
  "  path: '/ping',",
  "  visibility: 'public',",
  "  description: 'Answers',",
  '  success: { status: 200, body: z.object({ ok: z.boolean() }) },',
  '});',
  "const health = defineGroup({ name: 'health', description: 'Health', endpoints: [ping] });",
  "export const contract = defineContract({ name: 'orders-service', groups: [health] });",
]);

const crlfLine = (path: string) => `${path} has CRLF line endings: set eol=lf in .gitattributes\n`;

/** The text of a file with every line break a CRLF. */
function withCrlf(project: string, path: string): void {
  const text = readFileSync(join(project, path), 'utf8');
  write(project, { [path]: text.replaceAll('\n', '\r\n') });
}

/** Three commands that end 0, 1 and 3, printing on the stream they name. */
const commands = [
  {
    name: 'openapi, which prints on stdout and ends 0',
    status: 0,
    prints: 'stdout',
    args: ['openapi'],
    project: () => aGeneratedProject(aService),
  },
  {
    name: 'verify of a stale Snapshot, which prints on stderr and ends 1',
    status: 1,
    prints: 'stderr',
    args: ['verify'],
    project: () => {
      const project = aGeneratedProject(aService);
      write(project, { 'contract.snapshot.json': '{}\n' });
      return project;
    },
  },
  {
    name: 'an unknown command, which prints on stderr and ends 3',
    status: 3,
    prints: 'stderr',
    args: ['frobnicate'],
    project: () => aProject(aService),
  },
] as const;

const closings: readonly Closing[] = (['stdout', 'stderr'] as const).flatMap((stream) =>
  (['before', 'after', 'never'] as const).map((when) => ({ stream, when })),
);

const readerCases = commands.flatMap((command) =>
  closings.map((closing) => ({ command, closing })),
);

const readCases = readerCases.filter(
  ({ command, closing }) => closing.when === 'never' || closing.stream !== command.prints,
);

describe('cf-loom: when the reader of its output goes away', () => {
  test.each(readerCases)(
    '$command.name, with a reader that closes $closing.stream $closing.when: its exit status is the command’s, with no stack trace',
    async ({ command, closing }) => {
      const project = command.project();

      const ran = await cfLoomClosing(project, closing, ...command.args);

      expect(ran.status).toBe(command.status);
      expect(ran.stderr).not.toMatch(/^\s+at |Unhandled|EPIPE/m);
    },
  );

  test.each(readCases)(
    '$command.name, with a reader that closes $closing.stream $closing.when: what is read is what the command prints',
    async ({ command, closing }) => {
      const project = command.project();

      const ran = await cfLoomClosing(project, closing, ...command.args);

      expect(ran[command.prints]).not.toBe('');
    },
  );

  test.skipIf(!existsSync('/dev/full'))(
    'a stream that cannot be written ends 3 with one line on stderr',
    () => {
      const project = aGeneratedProject(aService);
      const full = openSync('/dev/full', 'w');

      const ran = spawnSync(process.execPath, [bin, 'openapi'], {
        cwd: project,
        encoding: 'utf8',
        stdio: ['ignore', full, 'pipe'],
      });

      expect(ran.status).toBe(3);
      expect(ran.stderr).toMatch(/^cf-loom cannot write stdout: ENOSPC[^\n]*\n$/);
    },
  );
});

describe('cf-loom: a Contract module that keeps the process alive', () => {
  test('generate ends when a module of the Contract holds a timer', () => {
    const project = aProject(
      aContractProject([
        'setInterval(() => {}, 1_000_000);',
        "import { defineContract } from '@cf-loom/contract';",
        "export const contract = defineContract({ name: 'orders-service' });",
      ]),
    );

    const ran = spawnSync(process.execPath, [bin, 'generate'], {
      cwd: project,
      encoding: 'utf8',
      timeout: 30_000,
    });

    expect(ran).toMatchObject({ status: 0, signal: null, stderr: '' });
  });
});

describe('cf-loom: files checked out with CRLF line endings', () => {
  test('verify says a contract.snapshot.json with CRLF line endings has them', () => {
    const project = aGeneratedProject(aService);
    withCrlf(project, 'contract.snapshot.json');

    const ran = cfLoom(project, 'verify');

    expect(ran).toEqual({ status: 1, stdout: '', stderr: crlfLine('contract.snapshot.json') });
  });

  test('verify says a Handler map with CRLF line endings has them', () => {
    const project = aGeneratedProject(aService);
    withCrlf(project, 'src/handlers.generated.ts');

    const ran = cfLoom(project, 'verify');

    expect(ran).toEqual({ status: 1, stdout: '', stderr: crlfLine('src/handlers.generated.ts') });
  });

  test.for([
    ['package'],
    ['check'],
    ['broker-plan'],
    ['openapi'],
    ['asyncapi'],
    ['publish'],
  ] as const)('%s stops at a contract.snapshot.json with CRLF line endings', ([command]) => {
    const project = aGeneratedProject(aService);
    withCrlf(project, 'contract.snapshot.json');

    const ran = cfLoom(project, command);

    expect(ran).toEqual({ status: 1, stdout: '', stderr: crlfLine('contract.snapshot.json') });
  });

  test('a contract.snapshot.json that differs in more than its line endings is out of date', () => {
    const project = aGeneratedProject(aService);
    write(project, { 'contract.snapshot.json': '{}\r\n' });

    const ran = cfLoom(project, 'verify');

    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain('contract.snapshot.json was edited or is out of date');
  });
});

const attributeLines = [
  'contract.snapshot.json text eol=lf',
  '*.generated.ts text eol=lf',
] as const;

const another = 'another text -diff';

/** Every `.gitattributes` an author may have: with or without each of the two lines and another, ended by a line break or not. */
const attributeFiles: readonly string[] = [
  [],
  [another],
  [attributeLines[0]],
  [attributeLines[1]],
  attributeLines,
  [another, attributeLines[0]],
  [another, attributeLines[1]],
  [another, ...attributeLines],
].flatMap((held) => [held.join('\n'), `${held.join('\n')}\n`]);

/** What `init` leaves in a `.gitattributes`: its own text, then the lines it lacks. */
function completed(attributes: string): string {
  const held = attributes.split('\n').map((line) => line.trim());
  const lacking = attributeLines.filter((line) => !held.includes(line));
  if (lacking.length === 0) {
    return attributes;
  }
  const ended = attributes === '' || attributes.endsWith('\n') ? attributes : `${attributes}\n`;
  return `${ended}${lacking.map((line) => `${line}\n`).join('')}`;
}

describe('cf-loom init: .gitattributes', () => {
  test('init writes a .gitattributes keeping the generated files’ line endings, and says it created it and the root', () => {
    const project = aProject(aBarePackage);

    const ran = cfLoom(project, 'init');

    expect(ran).toEqual({
      status: 0,
      stdout: 'Created src/contract/index.ts\nCreated .gitattributes\n',
      stderr: '',
    });
    expect(readFileSync(join(project, '.gitattributes'), 'utf8')).toBe(
      'contract.snapshot.json text eol=lf\n*.generated.ts text eol=lf\n',
    );
  });

  test.for(attributeFiles)(
    'init completes a .gitattributes of %j without editing a line',
    (held) => {
      const project = aProject({ ...aBarePackage, '.gitattributes': held });

      const ran = cfLoom(project, 'init');

      expect(ran.status).toBe(0);
      const completedText = completed(held);
      expect(readFileSync(join(project, '.gitattributes'), 'utf8')).toBe(completedText);
      const changed = completedText !== held;
      expect(ran.stdout).toBe(
        `Created src/contract/index.ts\n${changed ? 'Updated .gitattributes\n' : ''}`,
      );
      cfLoom(project, 'init', 'definitions');
      expect(readFileSync(join(project, '.gitattributes'), 'utf8')).toBe(completedText);
    },
  );

  test('init that cannot write the root leaves a .gitattributes as it was', () => {
    const project = aProject({
      ...aBarePackage,
      '.gitattributes': another,
      'src/contract/kept.ts': '',
    });
    symlinkSync('missing/index.ts', join(project, 'src/contract/index.ts'));

    const ran = cfLoom(project, 'init');

    expect(ran.status).toBe(3);
    expect(readFileSync(join(project, '.gitattributes'), 'utf8')).toBe(another);
  });

  test.skipIf(isRoot)('init that cannot write .gitattributes removes the root it wrote', () => {
    const project = aProject({ ...aBarePackage, '.gitattributes': `${another}\n` });
    chmodSync(join(project, '.gitattributes'), 0o444);

    const ran = cfLoom(project, 'init');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toMatch(/^init cannot write: EACCES[^\n]*\n$/);
    expect(existsSync(join(project, 'src'))).toBe(false);
    expect(readFileSync(join(project, '.gitattributes'), 'utf8')).toBe(`${another}\n`);
  });

  test.skipIf(spawnSync('prlimit', ['--version']).error !== undefined)(
    'init whose append writes part of its text and fails puts back the bytes .gitattributes held, and removes the root',
    () => {
      const held = `#${'a'.repeat(998)}\n`;
      const project = aProject({ ...aBarePackage, '.gitattributes': held });

      const ran = spawnSync('prlimit', ['--fsize=1024', process.execPath, bin, 'init'], {
        cwd: project,
        encoding: 'utf8',
      });

      expect(ran.status).toBe(3);
      expect(ran.stderr).toMatch(/^init cannot write: EFBIG[^\n]*\n$/);
      expect(readFileSync(join(project, '.gitattributes'), 'utf8')).toBe(held);
      expect(existsSync(join(project, 'src'))).toBe(false);
    },
  );

  test('init refuses a .gitattributes it cannot read, writing nothing', () => {
    const project = aProject(aBarePackage);
    mkdirSync(join(project, '.gitattributes'));

    const ran = cfLoom(project, 'init');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toMatch(/^\.gitattributes cannot be read: EISDIR[^\n]*\n$/);
    expect(existsSync(join(project, 'src'))).toBe(false);
  });

  test.for([
    ['service', 'a Service name'],
    ['application', 'an Application name'],
  ] as const)(
    'init %s refuses a package whose name is not kebab-case, writing nothing',
    ([kind, noun]) => {
      const project = aProject({
        'package.json': JSON.stringify({ name: '@acme/orders_service', type: 'module' }),
      });

      const ran = cfLoom(project, 'init', kind);

      const message = `package.json names "orders_service", but ${noun} is kebab-case: rename the package`;
      expect(ran).toEqual({ status: 3, stdout: '', stderr: `${message}\n` });
      expect(existsSync(join(project, 'src'))).toBe(false);
      expect(existsSync(join(project, '.gitattributes'))).toBe(false);
    },
  );

  test('init definitions takes a package of any name', () => {
    const project = aProject({
      'package.json': JSON.stringify({ name: '@acme/orders_service', type: 'module' }),
    });

    const ran = cfLoom(project, 'init', 'definitions');

    expect(ran.status).toBe(0);
    expect(existsSync(join(project, 'src/definitions/index.ts'))).toBe(true);
  });
});

describe('cf-loom: an option whose value is another option', () => {
  test('package --out --json is a usage error, and writes no folder', () => {
    const project = aGeneratedProject(aService);

    const ran = cfLoom(project, 'package', '--out', '--json');

    expect(ran).toEqual({ status: 3, stdout: '', stderr: `--out takes a folder. ${usage}\n` });
    expect(existsSync(join(project, '--json'))).toBe(false);
  });

  test('package --out=--json still writes a folder named --json', () => {
    const project = aGeneratedProject(aService);

    const ran = cfLoom(project, 'package', '--out=--json');

    expect(ran).toEqual({ status: 0, stdout: 'Wrote --json\n', stderr: '' });
    expect(existsSync(join(project, '--json', 'package.json'))).toBe(true);
  });

  test('check --against --json is a usage error, before any registry is read', async () => {
    const project = aGeneratedProject(aService);

    const ran = await cfLoomOffline(project, 'check', '--against', '--json');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: `--against takes a version or a dist-tag. ${usage}\n`,
    });
  });

  test('check --against --json --against 1.0.0 is a usage error, since the first --against has another option for its value', async () => {
    const project = aGeneratedProject(aService);

    const ran = await cfLoomOffline(project, 'check', '--against', '--json', '--against', '1.0.0');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: `--against takes a version or a dist-tag. ${usage}\n`,
    });
  });

  test('package --out --json --out folder is a usage error, and writes no folder', () => {
    const project = aGeneratedProject(aService);

    const ran = cfLoom(project, 'package', '--out', '--json', '--out', 'folder');

    expect(ran).toEqual({ status: 3, stdout: '', stderr: `--out takes a folder. ${usage}\n` });
    expect(existsSync(join(project, 'folder'))).toBe(false);
  });

  test('broker-plan --prefix --json is a usage error', () => {
    const project = aGeneratedProject(aService);

    const ran = cfLoom(project, 'broker-plan', '--prefix', '--json');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: `--prefix takes a prefix in kebab-case, such as staging. ${usage}\n`,
    });
  });
});

describe('cf-loom: help and version', () => {
  test.for([['--help'], ['-h'], ['help']] as const)('%s prints the usage and ends 0', ([word]) => {
    const project = aProject({});

    const ran = cfLoom(project, word);

    expect(ran).toEqual({ status: 0, stdout: `${usage}\n`, stderr: '' });
  });

  test.for([
    ['init', 'init [service | application | definitions]'],
    ['generate', 'generate'],
    ['verify', 'verify'],
    ['package', 'package [--out <dir>]'],
    ['check', 'check [--json] [--prerelease] [--against <version|dist-tag>]'],
    ['broker-plan', 'broker-plan [--prefix <p>] [--json]'],
    ['openapi', 'openapi'],
    ['asyncapi', 'asyncapi [--prefix <p>]'],
    ['publish', 'publish [--json] [--dry-run] [--force] [--prerelease]'],
  ] as const)('%s --help and help %s print its usage line and end 0', ([command, syntax]) => {
    const project = aProject({});
    const expected = { status: 0, stdout: `Usage: cf-loom ${syntax}\n`, stderr: '' };

    const flagged = cfLoom(project, command, '--help');
    const asked = cfLoom(project, 'help', command);

    expect(flagged).toEqual(expected);
    expect(asked).toEqual(expected);
  });

  test.for([
    ['publish', '-h', 'extra'],
    ['help', 'publish', 'extra'],
    ['--help', 'publish', 'extra'],
  ] as const)('%s given more than one command is a usage error', (args) => {
    const project = aProject({});

    const ran = cfLoom(project, ...args);

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: `help takes one command. ${usage}\n`,
    });
  });

  test.for([['--help'], ['--version']] as const)('%s=x is a usage error', ([option]) => {
    const project = aProject({});

    const ran = cfLoom(project, `${option}=x`);

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: `${option} takes no value. ${usage}\n`,
    });
  });

  test('help of an unknown command is a usage error', () => {
    const project = aProject({});

    const ran = cfLoom(project, 'help', 'frobnicate');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: `Unknown command: frobnicate. ${usage}\n`,
    });
  });

  test('--version prints the version of the CLI and the Snapshot format it writes, and ends 0', () => {
    const project = aGeneratedProject(aService);
    const written = JSON.parse(readFileSync(join(project, 'contract.snapshot.json'), 'utf8'));

    const ran = cfLoom(project, '--version');

    expect(ran).toEqual({
      status: 0,
      stdout: `@cf-loom/cli ${cliVersion} (Snapshot format ${written.format})\n`,
      stderr: '',
    });
  });
});
