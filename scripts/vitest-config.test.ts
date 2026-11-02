import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import {
  startProcess,
  stopProcess,
  type TestProcess,
  untilListening,
} from '../packages/messaging/test/test-process.ts';

const root = join(import.meta.dirname, '..');
const configUrl = JSON.stringify(pathToFileURL(join(root, 'vitest.config.ts')).href);
const vitestNode = JSON.stringify(
  pathToFileURL(join(root, 'node_modules', 'vitest', 'dist', 'node.js')).href,
);
const vitestBin = join(root, 'node_modules', 'vitest', 'vitest.mjs');

/** The time a child that starts Vitest and writes the README Service up to three times needs on a loaded runner. */
const writeOutsTimeout = 90_000;

/** What a Node process needs to start a Vitest through its API on this checkout's configuration, and to read the folder its `tooling` project gets the README Service from. */
const startsVitest = `
const { createVitest } = await import(${vitestNode});
const { existsSync } = await import('node:fs');
const { join } = await import('node:path');
const startVitest = (options = {}) =>
  createVitest('test', { watch: true, reporters: [{}], config: ${configUrl}, ...options }, {}, { stdout: process.stderr });
const folderOf = (vitest) =>
  vitest.projects.find(({ name }) => name === 'tooling').config.provide.readmeService;
`;

/** A Vitest process: it reports its folder once Vitest has started, and lives until SIGTERM, which Vitest's own handler ends with process.exit. */
const reportsItsFolder = `${startsVitest}
console.log(folderOf(await startVitest()));
setInterval(() => {}, 2 ** 30);
`;

/** A Vitest process that restarts twice, as watch mode does for a change of its configuration, then closes. */
const restartsThenCloses = `${startsVitest}
const vitest = await startVitest();
const first = folderOf(vitest);
await vitest.vite.restart();
process.once('SIGTERM', () => process.exit());
const second = folderOf(vitest);
const afterFirstRestart = {
  moved: second !== first,
  rewritten: existsSync(join(second, 'tsconfig.json')),
  oldRemoved: !existsSync(first),
};
const listeners = process.listenerCount('exit');
await vitest.vite.restart();
const addedListeners = process.listenerCount('exit') - listeners;
const third = folderOf(vitest);
await vitest.close();
console.log(JSON.stringify({ ...afterFirstRestart, addedListeners, removedOnClose: !existsSync(third) }));
process.exit();
`;

/** A Vitest process with two Vitest instances: it closes the first and reports what is left of each folder. */
const closesOneOfTwo = `${startsVitest}
const first = await startVitest();
const second = await startVitest();
const folders = [folderOf(first), folderOf(second)];
await first.close();
console.log(JSON.stringify({
  distinct: folders[0] !== folders[1],
  firstRemoved: !existsSync(folders[0]),
  secondKept: existsSync(join(folders[1], 'tsconfig.json')),
}));
await second.close();
process.exit();
`;

/** A Vitest process that runs only projects of packages, which are given no README Service: it reports the projects it ran and whether it wrote a folder. */
const runsOnlyPackages = `${startsVitest}
const { readdirSync } = await import('node:fs');
const vitest = await startVitest({ project: ['@cf-loom/contract', '@cf-loom/client'] });
const folders = existsSync('.readme-service') ? readdirSync('.readme-service') : [];
const wrote = folders.some((name) => name.startsWith(\`\${process.pid}-\`));
await vitest.close();
console.log(JSON.stringify({ projects: vitest.projects.map(({ name }) => name), wrote }));
process.exit();
`;

const started: TestProcess[] = [];

function startNode(...args: string[]): TestProcess {
  const node = startProcess(process.execPath, args, { cwd: root });
  started.push(node);
  return node;
}

/** Starts a Vitest process, and resolves with the folder it reports once it has written its README Service. */
async function startVitestProcess(): Promise<{
  readonly node: TestProcess;
  readonly folder: string;
}> {
  const node = startNode('--input-type=module', '--eval', reportsItsFolder);
  const folder = await untilListening(node, 'a Vitest process', () => {
    const [line, rest] = node.stdout().split('\n');
    return rest === undefined ? undefined : line;
  });
  return { node, folder };
}

afterEach(async () => {
  await Promise.all(started.splice(0).map(stopProcess));
});

describe('the Vitest configuration', () => {
  test('Vitest processes started together in one checkout each write a README Service of their own, removed when they exit', async () => {
    const [first, second] = await Promise.all([startVitestProcess(), startVitestProcess()]);

    expect(first.folder).not.toBe(second.folder);
    expect(existsSync(join(first.folder, 'tsconfig.json'))).toBe(true);
    expect(existsSync(join(second.folder, 'tsconfig.json'))).toBe(true);

    await Promise.all([stopProcess(first.node), stopProcess(second.node)]);

    expect(existsSync(first.folder)).toBe(false);
    expect(existsSync(second.folder)).toBe(false);
  });

  test('a restart of Vitest writes a new README Service and removes the old one, adds no removal of its own, and its close removes the last', {
    timeout: writeOutsTimeout,
  }, async () => {
    const vitest = startNode('--input-type=module', '--eval', restartsThenCloses);

    await vitest.exited;

    expect(JSON.parse(vitest.stdout())).toEqual({
      moved: true,
      rewritten: true,
      oldRemoved: true,
      addedListeners: 0,
      removedOnClose: true,
    });
  });

  test('two Vitest instances in one process each write a README Service of their own, and closing one leaves the other', {
    timeout: writeOutsTimeout,
  }, async () => {
    const vitest = startNode('--input-type=module', '--eval', closesOneOfTwo);

    await vitest.exited;

    expect(JSON.parse(vitest.stdout())).toEqual({
      distinct: true,
      firstRemoved: true,
      secondKept: true,
    });
  });

  test('a Vitest that runs no project given the README Service writes none', async () => {
    const vitest = startNode('--input-type=module', '--eval', runsOnlyPackages);

    await vitest.exited;

    expect(JSON.parse(vitest.stdout())).toEqual({
      projects: ['@cf-loom/contract', '@cf-loom/client'],
      wrote: false,
    });
  });

  test('the readme-service project collects the README tests from the folder of its own process', async () => {
    const vitest = startNode(vitestBin, 'list', '--project', 'readme-service', '--filesOnly');
    const readmeTests = readdirSync(join(root, 'scripts', 'readme-service', 'test'));

    await vitest.exited;

    const own = `\\[readme-service\\] \\.readme-service/${vitest.child.pid}-[0-9a-f-]+/test/`;
    expect(vitest.stdout().trim().split('\n').toSorted()).toEqual(
      readmeTests.toSorted().map((name) => expect.stringMatching(new RegExp(`^${own}${name}$`))),
    );
  });
});
