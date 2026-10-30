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
const configAgainUrl = JSON.stringify(
  `${pathToFileURL(join(root, 'vitest.config.ts')).href}?again`,
);
const vitestBin = join(root, 'node_modules', 'vitest', 'vitest.mjs');

/** What a Node process needs to read the folder that the `tooling` project gets its README Service from, in the configuration it loads. */
const toolingFolderOf = `
const toolingFolderOf = (config) =>
  config.test.projects.find((project) => project.test?.name === 'tooling').test.provide?.readmeService;
`;

/** A Vitest process: it loads the configuration, reports its folder and lives until SIGTERM, which ends it as Vitest's own signal handlers do. */
const reportsItsFolder = `${toolingFolderOf}
const { default: config } = await import(${configUrl});
console.log(toolingFolderOf(config));
process.once('SIGTERM', () => process.exit());
setInterval(() => {}, 2 ** 30);
`;

/** A Vitest process that Vitest restarts for a change of its configuration: it loads the configuration a second time and reports what that load did. */
const loadsTheConfigTwice = `${toolingFolderOf}
const { existsSync } = await import('node:fs');
const { join } = await import('node:path');
const { default: first } = await import(${configUrl});
const listenersAfterFirst = process.listenerCount('exit');
const { default: second } = await import(${configAgainUrl});
const folder = toolingFolderOf(second);
console.log(JSON.stringify({
  sameFolder: folder === toolingFolderOf(first),
  addedListeners: process.listenerCount('exit') - listenersAfterFirst,
  written: existsSync(join(folder, 'tsconfig.json')),
}));
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

  test('a second load of the configuration in one process keeps the folder of the first and adds no removal of its own', async () => {
    const vitest = startNode('--input-type=module', '--eval', loadsTheConfigTwice);

    await vitest.exited;

    expect(JSON.parse(vitest.stdout())).toEqual({
      sameFolder: true,
      addedListeners: 0,
      written: true,
    });
  });

  test('the readme-service project collects the README tests from the folder of its own process', async () => {
    const vitest = startNode(vitestBin, 'list', '--project', 'readme-service', '--filesOnly');
    const readmeTests = readdirSync(join(root, 'scripts', 'readme-service', 'test'));

    await vitest.exited;

    const own = `\\[readme-service\\] \\.readme-service/${vitest.child.pid}-[\\d.]+/test/`;
    expect(vitest.stdout().trim().split('\n').toSorted()).toEqual(
      readmeTests.toSorted().map((name) => expect.stringMatching(new RegExp(`^${own}${name}$`))),
    );
  });
});
