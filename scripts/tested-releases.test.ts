import { readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { type Leg, legsByClass, legsOfCi } from './ci-legs.ts';

const root = join(import.meta.dirname, '..');

/**
 * How each tool cf-loom promises a range of widens a release CI runs it on into the releases its
 * maintainers call compatible with it: a caret for npm and Node, which follow semver, and a tilde
 * for TypeScript, whose minors may break.
 */
const widenings = { node: '^', npm: '^', typescript: '~' } as const;

type Tool = keyof typeof widenings;

/** Compares two releases number by number, so that `24.16.0` follows `24.9.0`, which text would not. */
function byRelease(left: string, right: string): number {
  const [leftMajor = 0, leftMinor = 0, leftPatch = 0] = left.split('.').map(Number);
  const [rightMajor = 0, rightMinor = 0, rightPatch = 0] = right.split('.').map(Number);
  return leftMajor - rightMajor || leftMinor - rightMinor || leftPatch - rightPatch;
}

/** The range cf-loom promises for `tool` when CI runs it on `releases`: each release widened, joined by ` || ` in ascending order of the releases. */
function promisedRange(tool: Tool, releases: readonly string[]): string {
  return [...new Set(releases)]
    .sort(byRelease)
    .map((release) => `${widenings[tool]}${release}`)
    .join(' || ');
}

/** What the repository says about the releases it supports, as it holds it: one text for each statement, and each package's manifest by its path. */
type Statements = {
  readonly workflow: string;
  readonly nodeVersion: string;
  readonly workspace: string;
  readonly manifests: Readonly<
    Record<string, { readonly engines?: { readonly node?: string; readonly npm?: string } }>
  >;
  readonly readme: string;
  readonly cliReadme: string;
};

/** The Node releases the legs of CI name, one for each leg that names one. */
function nodeReleasesOf(legs: readonly Leg[]): string[] {
  const releases: string[] = [];
  for (const {
    matrix: { node },
  } of legs) {
    if (node !== undefined) {
      releases.push(node);
    }
  }
  return releases;
}

/** The npm releases the legs of CI name: the `version` of the `npm` entry of each leg that has one. */
function npmReleasesOf(legs: readonly Leg[]): string[] {
  const releases: string[] = [];
  for (const {
    matrix: { npm },
  } of legs) {
    if (npm !== undefined) {
      releases.push((JSON.parse(npm) as { version: string }).version);
    }
  }
  return releases;
}

/** What the repository says about the releases of one tool: where it declares the range, which only some tools read, and which documents quote it. */
type ToolStatements = {
  readonly tool: Tool;
  readonly releases: readonly string[];
  readonly declared: Readonly<Record<string, string | undefined>>;
  readonly documents: Readonly<Record<string, string>>;
};

/**
 * What differs between the range CI's releases of a tool give and what the repository says: each
 * declaration is that range, and each document quotes it in backticks.
 */
function rangeProblems({ tool, releases, declared, documents }: ToolStatements): string[] {
  if (releases.length === 0) {
    return [`no leg of ci.yml names a release of ${tool}`];
  }
  const range = promisedRange(tool, releases);
  const problems: string[] = [];
  for (const [place, said] of Object.entries(declared)) {
    if (said !== range) {
      const found = said === undefined ? 'absent' : `\`${said}\``;
      problems.push(`${place} is ${found}, but CI tests ${tool} \`${range}\``);
    }
  }
  for (const [name, text] of Object.entries(documents)) {
    if (!text.includes(`\`${range}\``)) {
      problems.push(`${name} does not quote \`${range}\``);
    }
  }
  return problems;
}

/** What differs between the Node releases CI tests, `engines.node` of every package and the range the README quotes. */
function nodeProblems({ workflow, manifests, readme }: Statements): string[] {
  const declared = Object.fromEntries(
    Object.entries(manifests).map(([path, { engines }]) => [
      `engines.node of ${path}`,
      engines?.node,
    ]),
  );
  return rangeProblems({
    tool: 'node',
    releases: nodeReleasesOf(legsOfCi(workflow)),
    declared,
    documents: { 'README.md': readme },
  });
}

/** What differs between the npm releases CI tests, `engines.npm` of the CLI and the range the CLI README quotes. */
function npmProblems({ workflow, manifests, cliReadme }: Statements): string[] {
  const declared = {
    'engines.npm of packages/cli/package.json':
      manifests['packages/cli/package.json']?.engines?.npm,
  };
  return rangeProblems({
    tool: 'npm',
    releases: npmReleasesOf(legsOfCi(workflow)),
    declared,
    documents: { 'packages/cli/README.md': cliReadme },
  });
}

/** What differs between the TypeScript release of the catalog, which must be exact, and the range the README quotes. */
function typescriptProblems({ workspace, readme }: Statements): string[] {
  const release: unknown = parse(workspace).catalog?.typescript;
  if (typeof release !== 'string' || !/^\d+\.\d+\.\d+$/.test(release)) {
    return [`the catalog's typescript is \`${release}\`, not one exact release`];
  }
  return rangeProblems({
    tool: 'typescript',
    releases: [release],
    declared: {},
    documents: { 'README.md': readme },
  });
}

/** What is wrong with where CI runs: a leg that names no Node release, and a class of legs that does not run on each release the legs name. */
function legProblems(legs: readonly Leg[]): string[] {
  const problems: string[] = [];
  for (const { job, matrix } of legs) {
    const { node } = matrix;
    if (node === undefined) {
      problems.push(`a leg of ${job} names no node release: ${JSON.stringify(matrix)}`);
    }
  }
  const releases = [...new Set(nodeReleasesOf(legs))].sort(byRelease);
  for (const [key, group] of legsByClass(legs)) {
    const missing = releases.filter(
      (release) => !group.some(({ matrix: { node } }) => node === release),
    );
    if (missing.length > 0) {
      problems.push(`the legs of ${key} do not run on node ${missing.join(', ')}`);
    }
  }
  return problems;
}

/** What is wrong with the Node the repository develops, builds and releases with: it is not one of the releases CI tests. */
function repositoryNodeProblems({ workflow, nodeVersion }: Statements): string[] {
  const releases = nodeReleasesOf(legsOfCi(workflow));
  const own = nodeVersion.trim();
  return releases.includes(own)
    ? []
    : [`.node-version is \`${own}\`, which no leg of ci.yml runs on`];
}

/** The statements the repository holds, read from its files. */
async function repositoryStatements(): Promise<Statements> {
  const read = (path: string) => readFileSync(join(root, path), 'utf8');
  const paths: string[] = [];
  for await (const path of glob('packages/*/package.json', { cwd: root })) {
    paths.push(path);
  }
  return {
    workflow: read('.github/workflows/ci.yml'),
    nodeVersion: read('.node-version'),
    workspace: read('pnpm-workspace.yaml'),
    manifests: Object.fromEntries(paths.sort().map((path) => [path, JSON.parse(read(path))])),
    readme: read('README.md'),
    cliReadme: read('packages/cli/README.md'),
  };
}

const nodeRange = '^24.16.0 || ^26.13.0';
const npmRange = '^11.13.0 || ^12.2.1';

/** A workflow of the shape of CI's: a `check` job with the matrix lines given and a `cli-npm` job over `nodes` and `npms`. */
const aWorkflow = ({
  checkMatrix = ['memory: [light]', 'node: [24.16.0, 26.13.0]'],
  nodes = ['24.16.0', '26.13.0'],
  npms = ['11.13.0', '12.2.1'],
}: {
  readonly checkMatrix?: readonly string[];
  readonly nodes?: readonly string[];
  readonly npms?: readonly string[];
} = {}) =>
  [
    'jobs:',
    '  check:',
    '    strategy:',
    '      matrix:',
    ...checkMatrix.map((line) => `        ${line}`),
    '    steps:',
    "      - run: pnpm vitest run --project '!@cf-loom/cli'",
    '  cli-npm:',
    '    strategy:',
    '      matrix:',
    `        node: [${nodes.join(', ')}]`,
    '        npm:',
    ...npms.flatMap((version) => [
      `          - version: ${version}`,
      '            sha256: PENDING',
    ]),
    '    steps:',
    '      - run: node node_modules/vitest/vitest.mjs run --project @cf-loom/cli',
    '',
  ].join('\n');

/** The statements of a repository in agreement, with the ones given changed. */
const aRepository = (changes: Partial<Statements> = {}): Statements => ({
  workflow: aWorkflow(),
  nodeVersion: '24.16.0\n',
  workspace: 'catalog:\n  typescript: 7.0.2\n',
  manifests: {
    'packages/cli/package.json': { engines: { node: nodeRange, npm: npmRange } },
    'packages/contract/package.json': { engines: { node: nodeRange } },
  },
  readme: `Run on Node in \`${nodeRange}\`. Use TypeScript \`~7.0.2\`.`,
  cliReadme: `cf-loom reads and publishes through an npm in \`${npmRange}\`, as declared.`,
  ...changes,
});

describe('the Node releases cf-loom supports', () => {
  it("the Node releases CI tests are the ones every package's engines.node declares and the README quotes", async () => {
    const statements = await repositoryStatements();

    const problems = nodeProblems(statements);

    expect(problems).toEqual([]);
  });

  it("every class of CI's legs runs on each Node release CI tests", async () => {
    const { workflow } = await repositoryStatements();

    const problems = legProblems(legsOfCi(workflow));

    expect(problems).toEqual([]);
  });

  it("the repository's own Node is one of the Node releases CI tests", async () => {
    const statements = await repositoryStatements();

    const problems = repositoryNodeProblems(statements);

    expect(problems).toEqual([]);
  });

  it('is in agreement when each statement names the releases of the matrix', () => {
    const repository = aRepository();

    const problems = [
      ...nodeProblems(repository),
      ...legProblems(legsOfCi(repository.workflow)),
      ...repositoryNodeProblems(repository),
    ];

    expect(problems).toEqual([]);
  });

  it('a class that misses a Node release fails', () => {
    const workflow = aWorkflow({ checkMatrix: ['memory: [light]', 'node: [24.16.0]'] });

    const problems = legProblems(legsOfCi(workflow));

    expect(problems).toEqual(['the legs of check light do not run on node 26.13.0']);
  });

  it("an engines.node that admits a release CI does not test fails, and so does one package's engines.node that differs", () => {
    const repository = aRepository({
      manifests: {
        'packages/cli/package.json': { engines: { node: `${nodeRange} || ^28.0.0` } },
        'packages/contract/package.json': { engines: { node: '>=24' } },
        'packages/server/package.json': {},
      },
    });

    const problems = nodeProblems(repository);

    expect(problems).toEqual([
      'engines.node of packages/cli/package.json is `^24.16.0 || ^26.13.0 || ^28.0.0`, but CI tests node `^24.16.0 || ^26.13.0`',
      'engines.node of packages/contract/package.json is `>=24`, but CI tests node `^24.16.0 || ^26.13.0`',
      'engines.node of packages/server/package.json is absent, but CI tests node `^24.16.0 || ^26.13.0`',
    ]);
  });

  it('a README quoting another Node range fails', () => {
    const repository = aRepository({ readme: 'Run on Node in `^24.16.0 || ^26.0.0`.' });

    const problems = nodeProblems(repository);

    expect(problems).toEqual(['README.md does not quote `^24.16.0 || ^26.13.0`']);
  });

  it('the Node range is in ascending numeric order of the releases, whatever order the matrix lists them in', () => {
    const range = '^24.9.0 || ^24.16.0 || ^26.13.0';
    const nodes = ['26.13.0', '24.9.0', '24.16.0'];
    const repository = aRepository({
      workflow: aWorkflow({
        checkMatrix: ['memory: [light]', `node: [${nodes.join(', ')}]`],
        nodes,
      }),
      manifests: { 'packages/contract/package.json': { engines: { node: range } } },
      readme: `Run on Node in \`${range}\`.`,
    });

    const problems = nodeProblems(repository);

    expect(problems).toEqual([]);
  });

  it('an include leg without a Node release fails', () => {
    const workflow = aWorkflow({
      checkMatrix: [
        'memory: [light]',
        'node: [24.16.0, 26.13.0]',
        'include:',
        '  - memory: growth',
        '    shard: 1/2',
      ],
    });

    const problems = legProblems(legsOfCi(workflow));

    expect(problems).toEqual([
      'a leg of check names no node release: {"memory":"growth","shard":"1/2"}',
      'the legs of check growth do not run on node 24.16.0, 26.13.0',
    ]);
  });

  it('a .node-version that is not among the Node releases CI tests fails', () => {
    const repository = aRepository({ nodeVersion: '24.15.0\n' });

    const problems = repositoryNodeProblems(repository);

    expect(problems).toEqual(['.node-version is `24.15.0`, which no leg of ci.yml runs on']);
  });
});

describe('the TypeScript release cf-loom supports', () => {
  it("the TypeScript release the README promises is a tilde at the catalog's TypeScript", async () => {
    const statements = await repositoryStatements();

    const problems = typescriptProblems(statements);

    expect(problems).toEqual([]);
  });

  it('a README quoting another TypeScript release than the catalog fails', () => {
    const repository = aRepository({ workspace: 'catalog:\n  typescript: 7.1.0\n' });

    const problems = typescriptProblems(repository);

    expect(problems).toEqual(['README.md does not quote `~7.1.0`']);
  });

  it('a catalog TypeScript that is a range fails', () => {
    const repository = aRepository({ workspace: 'catalog:\n  typescript: ^7.0.2\n' });

    const problems = typescriptProblems(repository);

    expect(problems).toEqual(["the catalog's typescript is `^7.0.2`, not one exact release"]);
  });
});

describe('the npm releases the CLI supports', () => {
  it('the npm releases CI tests are the ones engines.npm declares and the CLI README quotes', async () => {
    const statements = await repositoryStatements();

    const problems = npmProblems(statements);

    expect(problems).toEqual([]);
  });

  it('is in agreement when each statement names the releases of the matrix', () => {
    const repository = aRepository();

    const problems = npmProblems(repository);

    expect(problems).toEqual([]);
  });

  it('a matrix without one of the releases fails', () => {
    const repository = aRepository({ workflow: aWorkflow({ npms: ['12.2.1'] }) });

    const problems = npmProblems(repository);

    expect(problems).toEqual([
      'engines.npm of packages/cli/package.json is `^11.13.0 || ^12.2.1`, but CI tests npm `^12.2.1`',
      'packages/cli/README.md does not quote `^12.2.1`',
    ]);
  });

  it('an engines.npm that admits a release CI does not test fails', () => {
    const repository = aRepository({
      manifests: {
        'packages/cli/package.json': { engines: { npm: `${npmRange} || ^13.0.0` } },
      },
    });

    const problems = npmProblems(repository);

    expect(problems).toEqual([
      'engines.npm of packages/cli/package.json is `^11.13.0 || ^12.2.1 || ^13.0.0`, but CI tests npm `^11.13.0 || ^12.2.1`',
    ]);
  });

  it('a README quoting another range fails', () => {
    const repository = aRepository({
      cliReadme: 'an npm in `^11.13.0 || ^12.0.0`, as declared.',
    });

    const problems = npmProblems(repository);

    expect(problems).toEqual(['packages/cli/README.md does not quote `^11.13.0 || ^12.2.1`']);
  });

  it("the npm releases are read from the cli-npm matrix's npm values, so a Node release in the same job is not one", () => {
    const repository = aRepository({
      workflow: aWorkflow({ nodes: ['24.16.0', '26.13.0', '28.0.0'] }),
    });

    const problems = npmProblems(repository);

    expect(problems).toEqual([]);
  });

  it('the npm range is in ascending numeric order of the releases, whatever order the matrix lists them in', () => {
    const range = '^11.9.0 || ^11.13.0 || ^12.2.1';
    const repository = aRepository({
      workflow: aWorkflow({ npms: ['12.2.1', '11.9.0', '11.13.0'] }),
      manifests: { 'packages/cli/package.json': { engines: { npm: range } } },
      cliReadme: `an npm in \`${range}\`.`,
    });

    const problems = npmProblems(repository);

    expect(problems).toEqual([]);
  });

  it('a workflow with no npm release fails', () => {
    const workflow =
      'jobs:\n  check:\n    strategy:\n      matrix:\n        memory: [light]\n    steps:\n      - run: pnpm vitest run\n';
    const repository = aRepository({ workflow });

    const problems = npmProblems(repository);

    expect(problems).toEqual(['no leg of ci.yml names a release of npm']);
  });
});
