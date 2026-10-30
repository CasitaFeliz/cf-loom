import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');

/** The three statements of the npm releases the CLI supports, as the repository holds them. */
type NpmReleaseStatements = {
  readonly engines: string;
  readonly workflow: string;
  readonly readme: string;
};

/** The lines of the `cli-npm` job, from its key to the next key of `jobs` or the end of the file. */
function cliNpmJobIn(workflow: string): readonly string[] {
  const lines = workflow.split('\n');
  const start = lines.indexOf('  cli-npm:');
  if (start === -1) {
    return [];
  }
  const job = lines.slice(start + 1);
  const end = job.findIndex((line) => /^ {0,2}\S/.test(line));
  return end === -1 ? job : job.slice(0, end);
}

/** The npm releases the `cli-npm` matrix pins, in its order. */
function testedReleasesIn(workflow: string): readonly string[] {
  return cliNpmJobIn(workflow).flatMap(
    (line) => /^\s+- version: (\d+\.\d+\.\d+)\s*$/.exec(line)?.[1] ?? [],
  );
}

/**
 * What differs between `engines.npm` of the CLI, the releases the `cli-npm` matrix tests and the
 * range the CLI README quotes: `engines.npm` is a caret at each tested release, joined by ` || `
 * in the matrix's order.
 */
function npmReleaseProblems({
  engines,
  workflow,
  readme,
}: NpmReleaseStatements): readonly string[] {
  const releases = testedReleasesIn(workflow);
  if (releases.length === 0) {
    return ['the cli-npm job of ci.yml pins no npm release'];
  }
  const range = releases.map((release) => `^${release}`).join(' || ');
  const problems: string[] = [];
  if (engines !== range) {
    problems.push(`engines.npm is \`${engines}\`, but cli-npm tests \`${range}\``);
  }
  if (!readme.includes(`\`${range}\``)) {
    problems.push(`the CLI README does not quote \`${range}\``);
  }
  return problems;
}

const matrix = (...versions: readonly string[]) =>
  [
    'jobs:',
    '  check:',
    '    steps:',
    '      - version: 99.0.0',
    '  cli-npm:',
    '    strategy:',
    '      matrix:',
    '        npm:',
    ...versions.flatMap((version) => [
      `          - version: ${version}`,
      '            sha256: PENDING',
    ]),
    '    steps:',
    '      - run: true',
    '  later:',
    '    strategy:',
    '      matrix:',
    '        node:',
    '          - version: 24.16.0',
  ].join('\n');

const readmeQuoting = (range: string) =>
  `cf-loom reads and publishes through the \`npm\` on your \`PATH\`, an npm in \`${range}\`, as declared.`;

describe('the npm releases the CLI supports', () => {
  it('the npm releases CI tests are the ones engines.npm declares and the CLI README quotes', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'packages/cli/package.json'), 'utf8'));

    const problems = npmReleaseProblems({
      engines: manifest.engines?.npm ?? '',
      workflow: readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8'),
      readme: readFileSync(join(root, 'packages/cli/README.md'), 'utf8'),
    });

    expect(problems).toEqual([]);
  });

  it('is in agreement when each statement names the releases of the matrix, in its order', () => {
    const range = '^11.13.0 || ^12.2.1';

    const problems = npmReleaseProblems({
      engines: range,
      workflow: matrix('11.13.0', '12.2.1'),
      readme: readmeQuoting(range),
    });

    expect(problems).toEqual([]);
  });

  it('a matrix without one of the releases fails', () => {
    const range = '^11.13.0 || ^12.2.1';

    const problems = npmReleaseProblems({
      engines: range,
      workflow: matrix('12.2.1'),
      readme: readmeQuoting(range),
    });

    expect(problems).toEqual([
      'engines.npm is `^11.13.0 || ^12.2.1`, but cli-npm tests `^12.2.1`',
      'the CLI README does not quote `^12.2.1`',
    ]);
  });

  it('an engines.npm that admits a release CI does not test fails', () => {
    const range = '^11.13.0 || ^12.2.1 || ^13.0.0';

    const problems = npmReleaseProblems({
      engines: range,
      workflow: matrix('11.13.0', '12.2.1'),
      readme: readmeQuoting(range),
    });

    expect(problems).toEqual([
      'engines.npm is `^11.13.0 || ^12.2.1 || ^13.0.0`, but cli-npm tests `^11.13.0 || ^12.2.1`',
      'the CLI README does not quote `^11.13.0 || ^12.2.1`',
    ]);
  });

  it('a README quoting another range fails', () => {
    const range = '^11.13.0 || ^12.2.1';

    const problems = npmReleaseProblems({
      engines: range,
      workflow: matrix('11.13.0', '12.2.1'),
      readme: readmeQuoting('^11.13.0 || ^12.0.0'),
    });

    expect(problems).toEqual(['the CLI README does not quote `^11.13.0 || ^12.2.1`']);
  });

  it('a version line in a job after cli-npm is not read as a tested release', () => {
    const problems = npmReleaseProblems({
      engines: '^11.13.0 || ^12.2.1 || ^24.16.0',
      workflow: matrix('11.13.0', '12.2.1'),
      readme: readmeQuoting('^11.13.0 || ^12.2.1'),
    });

    expect(problems).toEqual([
      'engines.npm is `^11.13.0 || ^12.2.1 || ^24.16.0`, but cli-npm tests `^11.13.0 || ^12.2.1`',
    ]);
  });

  it('a workflow without a cli-npm job fails', () => {
    const problems = npmReleaseProblems({
      engines: '^11.13.0',
      workflow: 'jobs:\n  check:\n    steps:\n      - version: 11.13.0\n',
      readme: readmeQuoting('^11.13.0'),
    });

    expect(problems).toEqual(['the cli-npm job of ci.yml pins no npm release']);
  });
});
