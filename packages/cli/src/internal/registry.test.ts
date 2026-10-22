import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { type AddressInfo, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { canonicalTextOf, type PublishedSnapshot } from '@cf-loom/contract/internal';
import { test as baseTest, describe, expect } from 'vitest';
import { baselineOf, type NpmPlace, type ReadBaseline } from './index.ts';

type Kind = 'service' | 'application' | 'definitions';
type Declared = { readonly kind: Kind; readonly name: string };

const npmTimeout = 30_000;
const token = 'tok-3f9c1a';
const orders = { kind: 'service', name: 'orders-service' } as const satisfies Declared;
const ordersPackage = '@org/contract-orders-service';

const standardRejections: Extract<PublishedSnapshot, { kind: 'service' }>['standardRejections'] = {
  invalidInput: {
    origin: 'standard',
    code: 'INVALID_INPUT',
    status: 400,
    message: 'Invalid',
    body: { type: 'object', mode: 'strict', fields: {} },
  },
  notFound: { origin: 'standard', code: 'NOT_FOUND', status: 404, message: 'Not found' },
  notImplemented: { origin: 'standard', code: 'NOT_IMPLEMENTED', status: 501, message: 'No' },
};

function aPublishedSnapshot(declared: Declared, version: string): PublishedSnapshot {
  const heading = {
    format: 1 as const,
    name: declared.name,
    version,
    generator: '@cf-loom/cli@0.0.0',
  };
  switch (declared.kind) {
    case 'service':
      return {
        ...heading,
        kind: 'service',
        definitions: {},
        standardRejections,
        defs: {},
        endpoints: {},
        events: {},
        commands: {},
        guards: {},
        codes: {},
        subscriptions: {},
        dependencies: {},
      };
    case 'application':
      return { ...heading, kind: 'application', dependencies: {} };
    case 'definitions':
      return {
        ...heading,
        kind: 'definitions',
        standardRejections,
        defs: {},
        schemas: {},
        guards: {},
        codes: {},
      };
  }
}

const block = 512;
const mebibyte = 1024 * 1024;

type TarEntry = {
  readonly path: string;
  readonly content?: Buffer | string;
  readonly type?: string;
  readonly prefix?: string;
  readonly linkname?: string;
  readonly ustar?: string;
  readonly corruptChecksum?: boolean;
  readonly sizeField?: Buffer;
  readonly sizeAs?: (size: number) => string;
  readonly checksumAs?: (checksum: number) => string;
  readonly overwrite?: Overwrite;
};

type Overwrite = { readonly at: number; readonly bytes: Buffer };

const octal = (number: number, digits: number) => number.toString(8).padStart(digits, '0');

function headerOf(entry: TarEntry, size: number): Buffer {
  const header = Buffer.alloc(block);
  header.write(entry.path, 0, 100, 'utf8');
  header.write('0000644\0', 100, 'latin1');
  header.write('0000000\0', 108, 'latin1');
  header.write('0000000\0', 116, 'latin1');
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'latin1');
  entry.sizeField?.copy(header, 124);
  if (entry.sizeAs !== undefined) {
    header.write(entry.sizeAs(size), 124, 12, 'latin1');
  }
  header.write('00000000000\0', 136, 'latin1');
  header.write('        ', 148, 'latin1');
  header.write(entry.type ?? '0', 156, 'latin1');
  header.write(entry.linkname ?? '', 157, 100, 'utf8');
  header.write(entry.ustar ?? 'ustar\x0000', 257, 'latin1');
  header.write(entry.prefix ?? '', 345, 155, 'utf8');
  entry.overwrite?.bytes.copy(header, entry.overwrite.at);
  let checksum = entry.corruptChecksum ? 1 : 0;
  for (const byte of header) {
    checksum += byte;
  }
  const checksumField = entry.checksumAs?.(checksum) ?? `${octal(checksum, 6)}\0 `;
  header.write(checksumField, 148, 8, 'latin1');
  return header;
}

function tarOf(entries: readonly TarEntry[]): Buffer {
  const blocks = entries.flatMap((entry) => {
    const content = Buffer.from(entry.content ?? '');
    const padding = Buffer.alloc((block - (content.length % block)) % block);
    return [headerOf(entry, content.length), content, padding];
  });
  return Buffer.concat([...blocks, Buffer.alloc(2 * block)]);
}

function base256At(offset: number): Overwrite {
  return { at: offset, bytes: Buffer.from([0x81]) };
}

function textAt(offset: number, text: string): Overwrite {
  return { at: offset, bytes: Buffer.from(text) };
}

function aTarball(entries: readonly TarEntry[]): Buffer {
  return gzipSync(tarOf(entries));
}

function aPackageTarball(snapshotJson: Buffer | string, folder = 'package'): Buffer {
  return aTarball([
    { path: `${folder}/package.json`, content: '{}' },
    { path: `${folder}/snapshot.json`, content: snapshotJson },
    { path: `${folder}/dist/index.js`, content: 'export {};' },
  ]);
}

const hiddenEntry = tarOf([{ path: 'package/snapshot.json', content: 'real' }]).subarray(
  0,
  2 * block,
);

function recordLength(restLength: number): number {
  const withOneDigitMore = restLength + String(restLength).length;
  return String(withOneDigitMore).length === String(restLength).length
    ? withOneDigitMore
    : withOneDigitMore + 1;
}

function paxRecord(key: string, value: string, leadingZeros = ''): string {
  const rest = ` ${key}=${value}\n`;
  return `${leadingZeros}${recordLength(leadingZeros.length + rest.length)}${rest}`;
}

function paxRecordOfBytes(key: string, value: Buffer): Buffer {
  const rest = Buffer.concat([Buffer.from(` ${key}=`), value, Buffer.from('\n')]);
  return Buffer.concat([Buffer.from(String(recordLength(rest.length))), rest]);
}

const entryNotWritten = 'has a tar entry npm does not write';
const paxNotWritten = 'has a pax header npm does not write';
const pathNotWritten = 'has a path npm does not write';
const pathNotPlainAscii = 'has a path that is not printable ASCII, or that holds a ":" or a "\\"';
const paxBeyondAscii = 'has a pax header with a byte beyond ASCII';
const folderNamedSnapshot = 'has a folder named snapshot.json';
const credentialsInUrl =
  'npm will not print a registry URL that holds credentials: put them in a //host/:_authToken or //host/:_auth line instead of in the registry URL';

/** npm strips a path's first folder, so it can be as long as a test needs and still name snapshot.json. */
const longFirstFolder = 'p'.repeat(1_048_548);
const paxOfOneMebibyte = paxRecord('path', `${longFirstFolder}/snapshot.json`);
const paxOfOneMebibytePlusOne = paxRecord('path', `${longFirstFolder}p/snapshot.json`);

/** The first byte of the "é" is the last of the archive's first 16 KiB, behind this many bytes of filler. */
const bytesBeforeSplitPax = 13_824;
const splitPaxPath = paxRecordOfBytes('path', Buffer.from(`package/${'a'.repeat(494)}é.txt`));

function integrityOf(bytes: Buffer, algorithm: 'sha1' | 'sha512'): string {
  return `${algorithm}-${createHash(algorithm).update(bytes).digest('base64')}`;
}

type ServedVersion = {
  readonly version: string;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly tarball: Buffer;
  readonly packed: Buffer | undefined;
  readonly dist: Readonly<Record<string, unknown>> | null;
};

type VersionOptions = {
  readonly declared?: Declared;
  readonly peers?: Readonly<Record<string, string>>;
  readonly deprecated?: string;
  readonly cfLoom?: Readonly<Record<string, unknown>> | null;
  readonly manifest?: Readonly<Record<string, unknown>>;
  readonly snapshotJson?: Buffer | string;
  readonly tarball?: Buffer;
  readonly packed?: Buffer;
  readonly dist?: Readonly<Record<string, unknown>> | null;
};

function aVersion(version: string, options: VersionOptions = {}): ServedVersion {
  const declared = options.declared ?? orders;
  const snapshotJson =
    options.snapshotJson ?? canonicalTextOf(aPublishedSnapshot(declared, version));
  const defaultCfLoom = { format: 1, snapshotHash: 'a'.repeat(64), kind: declared.kind };
  const cfLoom = options.cfLoom === undefined ? defaultCfLoom : options.cfLoom;
  const manifest = {
    version,
    ...(cfLoom === null ? {} : { cfLoom }),
    ...(options.peers === undefined ? {} : { peerDependencies: options.peers }),
    ...(options.deprecated === undefined ? {} : { deprecated: options.deprecated }),
    ...options.manifest,
  };
  const tarball = options.tarball ?? aPackageTarball(snapshotJson);
  const dist = options.dist === undefined ? {} : options.dist;
  return { version, manifest, tarball, packed: options.packed, dist };
}

type FakePackage = {
  readonly versions: readonly ServedVersion[];
  readonly distTags?: Readonly<Record<string, string>>;
  readonly unpublishedAt?: string;
};

type Answer =
  | {
      readonly status: number;
      readonly body?: Buffer | string;
      readonly contentType?: string;
    }
  | 'hang';

function jsonAnswer(status: number, value: unknown): Answer {
  return { status, body: JSON.stringify(value), contentType: 'application/json' };
}

type RegistryOptions = {
  readonly packages?: Readonly<Record<string, FakePackage>>;
  readonly whoami?: Answer;
  readonly answers?: Readonly<Record<string, Answer>>;
};

type Recorded = {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | undefined;
};

type Registry = {
  readonly url: string;
  readonly host: string;
  readonly requests: readonly Recorded[];
  readonly close: () => Promise<void>;
};

function tarballPathOf(packageName: string, version: string): string {
  return `/tarballs/${packageName.replace('@', '').replace('/', '-')}-${version}.tgz`;
}

function packedPathOf(packageName: string, version: string): string {
  return tarballPathOf(packageName, `${version}-packed`);
}

function distOf(tarballPath: string, bytes: Buffer, url: string) {
  return {
    tarball: `${url}${tarballPath}`,
    integrity: integrityOf(bytes, 'sha512'),
    shasum: createHash('sha1').update(bytes).digest('hex'),
  };
}

/** What a client asked of a packument: where the registry is, and whether it took the abbreviated one. */
type View = { readonly url: string; readonly isAbbreviated: boolean };

function packumentOf(name: string, served: FakePackage, { url, isAbbreviated }: View) {
  if (served.unpublishedAt !== undefined) {
    return { name, time: { unpublished: { time: served.unpublishedAt, versions: [] } } };
  }
  const versions = Object.fromEntries(
    served.versions.map((version) => {
      const packed = isAbbreviated ? version.packed : undefined;
      const sent =
        packed === undefined
          ? distOf(tarballPathOf(name, version.version), version.tarball, url)
          : distOf(packedPathOf(name, version.version), packed, url);
      const dist = version.dist === null ? undefined : { ...sent, ...version.dist };
      return [version.version, { name, ...version.manifest, dist }];
    }),
  );
  const latest = served.versions.at(-1)?.version;
  const distTags = served.distTags ?? (latest === undefined ? {} : { latest });
  return { name, 'dist-tags': distTags, versions };
}

function bytesAnswer(body: Buffer): Answer {
  return { status: 200, body, contentType: 'application/octet-stream' };
}

function tarballAnswerOf(path: string, packageName: string, served: FakePackage) {
  for (const { version, tarball, packed } of served.versions) {
    if (path === tarballPathOf(packageName, version)) {
      return bytesAnswer(tarball);
    }
    if (packed !== undefined && path === packedPathOf(packageName, version)) {
      return bytesAnswer(packed);
    }
  }
  return undefined;
}

type Asked = { readonly path: string; readonly accept: string | undefined };

function answerOf({ path, accept }: Asked, options: RegistryOptions, url: string): Answer {
  const override = options.answers?.[path];
  if (override !== undefined) {
    return override;
  }
  if (path === '/-/whoami') {
    return options.whoami ?? jsonAnswer(200, { username: 'tester' });
  }
  const isAbbreviated = accept?.startsWith('application/vnd.npm.install-v1+json') === true;
  for (const [name, served] of Object.entries(options.packages ?? {})) {
    if (path === `/${name.replace('/', '%2f')}`) {
      return jsonAnswer(200, packumentOf(name, served, { url, isAbbreviated }));
    }
    const tarball = tarballAnswerOf(path, name, served);
    if (tarball !== undefined) {
      return tarball;
    }
  }
  return jsonAnswer(404, { error: 'Not found' });
}

async function aRegistry(options: RegistryOptions = {}): Promise<Registry> {
  const requests: Recorded[] = [];
  const server = createServer((request, response) => {
    const path = request.url ?? '';
    const authorization = request.headers.authorization;
    requests.push({ method: request.method ?? '', path, authorization });
    const accept = request.headers.accept;
    const answer = answerOf({ path, accept }, options, `http://${request.headers.host}`);
    if (answer === 'hang') {
      return;
    }
    response.statusCode = answer.status;
    response.setHeader('content-type', answer.contentType ?? 'text/plain');
    response.end(answer.body ?? '');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  const close = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  return { url: `http://${host}`, host, requests, close };
}

type Address = Pick<Registry, 'url' | 'host'>;

/** A host and port that were taken, so no other test is given them, with nothing listening on them. */
async function aDeadAddress(): Promise<Address & { readonly release: () => void }> {
  const listener = createServer();
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const holder = connect({ host: '127.0.0.1', port: (listener.address() as AddressInfo).port });
  await once(holder, 'connect');
  const host = `127.0.0.1:${holder.localPort}`;
  return {
    url: `http://${host}`,
    host,
    release: () => {
      holder.destroy();
      listener.close();
    },
  };
}

function loginTo(registry: Address): string {
  return `@org:registry=${registry.url}/\n//${registry.host}/:_authToken=${token}\n`;
}

type PlaceOptions = {
  readonly userConfig?: string;
  readonly projectConfig?: string;
  readonly path?: string;
  readonly fetchTimeout?: number;
};

type Lab = {
  readonly aRegistry: (options?: RegistryOptions) => Promise<Registry>;
  readonly aDeadAddress: () => Promise<Address>;
  readonly aPlace: (options: PlaceOptions) => NpmPlace;
  readonly aFolder: () => string;
};

const { PATH: inheritedPath = '' } = process.env;
const npmSettings = /^npm_config_/i;
const proxySettings = /^(?:https?|all|no)_proxy$/i;

/** Everything of the process environment but npm's own settings and proxies, so no developer configuration reaches a test. */
const inheritedEnvironment = Object.entries(process.env).filter(
  ([name, value]) => value !== undefined && !npmSettings.test(name) && !proxySettings.test(name),
);

function aLab(): Lab & { readonly dispose: () => Promise<void> } {
  const registries: Registry[] = [];
  const dead: { readonly release: () => void }[] = [];
  const folders: string[] = [];
  const aFolder = () => {
    const folder = mkdtempSync(join(tmpdir(), 'cf-loom-registry-test-'));
    folders.push(folder);
    return folder;
  };
  const aPlace = (options: PlaceOptions): NpmPlace => {
    const folder = aFolder();
    const directory = join(folder, 'project');
    mkdirSync(directory);
    writeFileSync(join(directory, 'package.json'), '{"name":"project","version":"0.0.0"}');
    if (options.projectConfig !== undefined) {
      writeFileSync(join(directory, '.npmrc'), options.projectConfig);
    }
    writeFileSync(join(folder, 'user.npmrc'), options.userConfig ?? '');
    writeFileSync(join(folder, 'global.npmrc'), '');
    const settings = [
      ['userconfig', join(folder, 'user.npmrc')],
      ['globalconfig', join(folder, 'global.npmrc')],
      ['cache', join(folder, 'cache')],
      ['logs_max', '0'],
      ['update_notifier', 'false'],
      ['fetch_retries', '0'],
      ['fetch_timeout', String(options.fetchTimeout ?? 60_000)],
    ] as const;
    const env = Object.fromEntries([
      ...inheritedEnvironment,
      ['PATH', options.path ?? inheritedPath],
      ...settings.map(([name, value]) => [`npm_config_${name}`, value]),
    ]);
    return { directory, env };
  };
  return {
    aRegistry: async (options) => {
      const registry = await aRegistry(options);
      registries.push(registry);
      return registry;
    },
    aDeadAddress: async () => {
      const address = await aDeadAddress();
      dead.push(address);
      return address;
    },
    aPlace,
    aFolder,
    dispose: async () => {
      await Promise.all(registries.map((registry) => registry.close()));
      for (const address of dead) {
        address.release();
      }
      for (const folder of folders) {
        rmSync(folder, { recursive: true, force: true });
      }
    },
  };
}

const test = baseTest.extend<{ lab: Lab }>({
  // biome-ignore lint/correctness/noEmptyPattern: vitest reads what a fixture needs from this pattern
  lab: async ({}, use) => {
    const lab = aLab();
    await use(lab);
    await lab.dispose();
  },
});

async function readOrders(lab: Lab, served: RegistryOptions) {
  const registry = await lab.aRegistry(served);
  const npm = lab.aPlace({ userConfig: loginTo(registry) });
  const read = await baselineOf(npm, orders, '@org');
  return { read, registry };
}

function ordersWith(...versions: readonly ServedVersion[]): RegistryOptions {
  return { packages: { [ordersPackage]: { versions } } };
}

function baselineIn(read: ReadBaseline) {
  if (read.kind !== 'baseline') {
    throw new Error(`not a baseline: ${JSON.stringify(read)}`);
  }
  return read;
}

function failureIn(read: ReadBaseline): string {
  if (read.kind !== 'failed') {
    throw new Error(`not a failure: ${JSON.stringify(read)}`);
  }
  return read.message;
}

function setEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function aRecordingNpm(lab: Lab) {
  const folder = lab.aFolder();
  const log = join(folder, 'calls.log');
  const script = `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nPATH='${inheritedPath}'\nexport PATH\nexec npm "$@"\n`;
  writeFileSync(join(folder, 'npm'), script);
  chmodSync(join(folder, 'npm'), 0o755);
  const calls = () =>
    readFileSync(log, 'utf8')
      .split('\n')
      .filter((line) => line !== '');
  return { path: `${folder}${delimiter}${inheritedPath}`, calls };
}

function aStubNpm(lab: Lab, body: string): string {
  const folder = lab.aFolder();
  writeFileSync(join(folder, 'npm'), `#!/bin/sh\n${body}\n`);
  chmodSync(join(folder, 'npm'), 0o755);
  return `${folder}${delimiter}${inheritedPath}`;
}

function aPackLockingNpm(lab: Lab, folder: string): string {
  const body = `PATH='${inheritedPath}'\nexport PATH\nnpm "$@"\nstatus=$?\ncase "$1" in pack) chmod 555 '${folder}';; esac\nexit $status`;
  return aStubNpm(lab, body);
}

/** The tarball a real packer writes for a folder, with the files given by their paths. */
function aFolderPackedBy(
  lab: Lab,
  packer: 'npm' | 'pnpm',
  files: Readonly<Record<string, string>>,
) {
  const { directory, env } = lab.aPlace({});
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), content);
  }
  const destination = lab.aFolder();
  execFileSync(packer, ['pack', '--pack-destination', destination], {
    cwd: directory,
    env,
    stdio: 'pipe',
  });
  const [tarball] = readdirSync(destination);
  return readFileSync(join(destination, tarball ?? ''));
}

function tarballsRequested(registry: Registry): readonly string[] {
  return registry.requests.map((request) => request.path).filter((p) => p.startsWith('/tarballs/'));
}

describe.concurrent('baselineOf', { timeout: npmTimeout }, () => {
  test('a package’s Baseline is the snapshot.json of its highest published version', async ({
    lab,
  }) => {
    const served = ordersWith(aVersion('1.0.0'), aVersion('1.1.0'));

    const { read, registry } = await readOrders(lab, served);

    expect(baselineIn(read).snapshot).toEqual(aPublishedSnapshot(orders, '1.1.0'));
    expect(tarballsRequested(registry)).toEqual([tarballPathOf(ordersPackage, '1.1.0')]);
  });

  test('versions order as semantic versions, not as text or publish order', async ({ lab }) => {
    const served = ordersWith(aVersion('1.9.0'), aVersion('1.10.0'), aVersion('1.2.0'));

    const { read } = await readOrders(lab, served);

    expect(baselineIn(read).snapshot.version).toBe('1.10.0');
  });

  test('a prerelease never counts as the highest version', async ({ lab }) => {
    const served = ordersWith(aVersion('1.0.0'), aVersion('2.0.0-rc.1'));

    const { read } = await readOrders(lab, served);

    expect(baselineIn(read).snapshot.version).toBe('1.0.0');
  });

  test.for([
    ['a lower version', '1.0.0'],
    ['a prerelease', '2.0.0-rc.1'],
  ] as const)(
    'the latest dist-tag is never read, even when it points at %s',
    async ([, tagged], { lab }) => {
      const versions = [aVersion('1.0.0'), aVersion('1.1.0'), aVersion('2.0.0-rc.1')];
      const served = { packages: { [ordersPackage]: { versions, distTags: { latest: tagged } } } };

      const { read } = await readOrders(lab, served);

      expect(baselineIn(read).snapshot.version).toBe('1.1.0');
    },
  );

  test('a deprecated version still counts as published', async ({ lab }) => {
    const served = ordersWith(aVersion('1.0.0'), aVersion('1.1.0', { deprecated: 'use 2.x' }));

    const { read } = await readOrders(lab, served);

    expect(baselineIn(read).snapshot.version).toBe('1.1.0');
  });

  test('a package with only prereleases has no Baseline and lists its versions', async ({
    lab,
  }) => {
    const served = ordersWith(aVersion('1.0.0-rc.2'), aVersion('1.0.0-rc.1'));

    const { read, registry } = await readOrders(lab, served);

    expect(read).toEqual({
      kind: 'no-baseline',
      packageName: ordersPackage,
      why: { kind: 'only-prereleases', versions: ['1.0.0-rc.1', '1.0.0-rc.2'] },
    });
    expect(tarballsRequested(registry)).toEqual([]);
  });

  test('the Baseline lists every published version, prereleases included, lowest first', async ({
    lab,
  }) => {
    const versions = ['1.1.0', '1.0.0', '1.2.0-rc.1', '1.10.0', '1.2.0'];

    const { read } = await readOrders(lab, ordersWith(...versions.map((v) => aVersion(v))));

    expect(baselineIn(read).versions).toEqual(['1.0.0', '1.1.0', '1.2.0-rc.1', '1.2.0', '1.10.0']);
  });

  test('the Baseline’s peer ranges are those of its own version', async ({ lab }) => {
    const peers = { zod: '^4.0.0', '@cf-loom/contract': '^1.2.0' };
    const served = ordersWith(
      aVersion('1.0.0', { peers: { zod: '^3.0.0' } }),
      aVersion('1.1.0', { peers }),
    );

    const { read } = await readOrders(lab, served);

    expect(baselineIn(read).peers).toEqual(peers);
  });

  test('a Baseline with no peerDependencies has no peer ranges', async ({ lab }) => {
    const served = ordersWith(aVersion('1.0.0', { peers: { zod: '^3.0.0' } }), aVersion('1.1.0'));

    const { read } = await readOrders(lab, served);

    expect(baselineIn(read).peers).toEqual({});
  });

  test('the scope’s registry and login are those npm’s configuration names', async ({ lab }) => {
    const served = ordersWith(aVersion('1.0.0'));

    const { registry } = await readOrders(lab, served);

    const paths = registry.requests.map((request) => request.path);
    const logins = new Set(registry.requests.map((request) => request.authorization));
    expect(paths).toContain(tarballPathOf(ordersPackage, '1.0.0'));
    expect(logins).toEqual(new Set([`Bearer ${token}`]));
  });

  test('a project’s own .npmrc decides the scope’s registry', async ({ lab }) => {
    const serving = await lab.aRegistry(ordersWith(aVersion('1.0.0')));
    const elsewhere = await lab.aRegistry();
    const npm = lab.aPlace({ userConfig: loginTo(elsewhere), projectConfig: loginTo(serving) });

    const read = await baselineOf(npm, orders, '@org');

    expect(baselineIn(read).snapshot.version).toBe('1.0.0');
    expect(elsewhere.requests).toEqual([]);
  });

  test('npm is given no --registry and no secret in its arguments', async ({ lab }) => {
    const registry = await lab.aRegistry(ordersWith(aVersion('1.0.0')));
    const recording = aRecordingNpm(lab);
    const npm = lab.aPlace({ userConfig: loginTo(registry), path: recording.path });

    await baselineOf(npm, orders, '@org');
    await baselineOf(npm, { kind: 'service', name: 'unknown-service' }, '@org');

    const calls = recording.calls();
    const secrets = [token, registry.host, '--registry'];
    expect(calls).toHaveLength(6);
    expect(calls.filter((call) => secrets.some((secret) => call.includes(secret)))).toEqual([]);
  });

  test('a package the registry does not know has no Baseline once npm reports a user there', async ({
    lab,
  }) => {
    const registry = await lab.aRegistry();
    const npm = lab.aPlace({ userConfig: loginTo(registry) });

    const read = await baselineOf(npm, orders, '@org');

    expect(read).toEqual({
      kind: 'no-baseline',
      packageName: ordersPackage,
      why: { kind: 'unknown-package', registry: `${registry.url}/`, username: 'tester' },
    });
    const whoami = registry.requests.find((request) => request.path === '/-/whoami');
    expect(whoami?.authorization).toBe(`Bearer ${token}`);
  });

  test('whoami asks the registry npm reads the scope from, not the default registry', async ({
    lab,
  }) => {
    const scoped = await lab.aRegistry();
    const standard = await lab.aRegistry();
    const defaults = `registry=${standard.url}/\n//${standard.host}/:_authToken=${token}\n`;
    const npm = lab.aPlace({ userConfig: loginTo(scoped) + defaults });

    const read = await baselineOf(npm, orders, '@org');

    expect(read.kind).toBe('no-baseline');
    expect(scoped.requests.map((request) => request.path)).toContain('/-/whoami');
    expect(standard.requests).toEqual([]);
  });

  test('whoami asks the default registry when the scope has none of its own', async ({ lab }) => {
    const registry = await lab.aRegistry();
    const userConfig = `registry=${registry.url}/\n//${registry.host}/:_authToken=${token}\n`;
    const npm = lab.aPlace({ userConfig });

    const read = await baselineOf(npm, orders, '@org');

    expect(read).toMatchObject({ why: { kind: 'unknown-package', registry: `${registry.url}/` } });
  });

  test('whoami asks the scope’s registry although the default registry holds credentials', async ({
    lab,
  }) => {
    const registry = await lab.aRegistry();
    const npm = lab.aPlace({
      userConfig: `${loginTo(registry)}registry=https://bob:pw@elsewhere.invalid/\n`,
    });

    const read = await baselineOf(npm, orders, '@org');

    expect(read).toMatchObject({ why: { kind: 'unknown-package', registry: `${registry.url}/` } });
  });

  test('a default registry that holds credentials, with none for the scope, fails without them', async ({
    lab,
  }) => {
    const registry = await lab.aRegistry();
    const authority = `bob:pw@${registry.host}`;
    const npm = lab.aPlace({ userConfig: `registry=http://${authority}/\n` });

    const read = await baselineOf(npm, orders, '@org');

    expect(failureIn(read)).toBe(`npm config get registry failed: ${credentialsInUrl}`);
  });

  test.for([
    ['a scope registry', '@org:registry'],
    ['the default registry', 'registry'],
  ] as const)(
    'a package npm cannot find fails with where to put the credentials when %s holds them in its URL',
    async ([, key], { lab }) => {
      const registry = await lab.aRegistry();
      const userConfig = `${key}=http://alice:pw@${registry.host}/\n//${registry.host}/:_authToken=${token}\n`;
      const npm = lab.aPlace({ userConfig });

      const read = await baselineOf(npm, orders, '@org');

      expect(failureIn(read)).toBe(`npm config get ${key} failed: ${credentialsInUrl}`);
    },
  );

  test('a registry URL’s user is left out of what is printed', async ({ lab }) => {
    const registry = await lab.aRegistry();
    const npm = lab.aPlace({
      userConfig: `@org:registry=http://alice@${registry.host}/\n//${registry.host}/:_authToken=${token}\n`,
    });

    const read = await baselineOf(npm, orders, '@org');

    expect(read).toMatchObject({ why: { kind: 'unknown-package', registry: `${registry.url}/` } });
  });

  test('a registry URL’s user is left out of a refusal too', async ({ lab }) => {
    const registry = await lab.aRegistry({ whoami: jsonAnswer(401, { error: 'bad token' }) });
    const npm = lab.aPlace({
      userConfig: `@org:registry=http://alice@${registry.host}/\n//${registry.host}/:_authToken=${token}\n`,
    });

    const read = await baselineOf(npm, orders, '@org');

    expect(failureIn(read)).toContain(
      `${ordersPackage} is not in ${registry.url}/, and npm has no login`,
    );
    expect(failureIn(read)).not.toContain('alice');
  });

  test.for([
    ['refuses the login', jsonAnswer(401, { error: 'bad token' })],
    ['answers no username', jsonAnswer(200, {})],
  ] as const)(
    'a package the registry does not know fails when whoami %s',
    async ([, whoami], { lab }) => {
      const registry = await lab.aRegistry({ whoami });
      const npm = lab.aPlace({ userConfig: loginTo(registry) });

      const read = await baselineOf(npm, orders, '@org');

      expect(failureIn(read)).toContain(`${ordersPackage} is not in ${registry.url}/`);
      expect(failureIn(read)).toContain('a package your login cannot read looks unpublished');
    },
  );

  test.for([
    ['service', 'orders-service', '@org/contract-orders-service'],
    ['application', 'orders-web', '@org/contract-orders-web'],
    ['definitions', 'shared', '@org/shared'],
  ] as const)(
    'the Baseline of the %s %s is read from %s',
    async ([kind, name, packageName], { lab }) => {
      const declared = { kind, name };
      const version = aVersion('1.0.0', { declared });
      const registry = await lab.aRegistry({
        packages: { [packageName]: { versions: [version] } },
      });
      const npm = lab.aPlace({ userConfig: loginTo(registry) });

      const read = await baselineOf(npm, declared, '@org');

      expect(baselineIn(read)).toMatchObject({ packageName, snapshot: { kind, name } });
    },
  );

  test('a highest version whose cfLoom is of another kind fails, and its tarball is not requested', async ({
    lab,
  }) => {
    const other = { kind: 'application', name: 'orders-service' } as const;
    const served = ordersWith(aVersion('1.0.0'), aVersion('1.1.0', { declared: other }));

    const { read, registry } = await readOrders(lab, served);

    expect(failureIn(read)).toBe(
      `${ordersPackage}@1.1.0 is the package of kind application, not service`,
    );
    expect(tarballsRequested(registry)).toEqual([]);
  });

  test('a highest version without cfLoom fails, naming the package and version', async ({
    lab,
  }) => {
    const served = ordersWith(aVersion('1.0.0'), aVersion('1.1.0', { cfLoom: null }));

    const { read } = await readOrders(lab, served);

    expect(failureIn(read)).toBe(
      `${ordersPackage}@1.1.0 has no cfLoom: it was not published by cf-loom publish`,
    );
  });

  test.for([
    [
      'name',
      { kind: 'service', name: 'billing-service' },
      '1.0.0',
      'billing-service@1.0.0 (service)',
    ],
    [
      'kind',
      { kind: 'application', name: 'orders-service' },
      '1.0.0',
      'orders-service@1.0.0 (application)',
    ],
    ['version', orders, '9.9.9', 'orders-service@9.9.9 (service)'],
  ] as const)(
    'a snapshot.json of another %s than the package’s fails',
    async ([, other, version, said], { lab }) => {
      const snapshotJson = canonicalTextOf(aPublishedSnapshot(other, version));

      const { read } = await readOrders(lab, ordersWith(aVersion('1.0.0', { snapshotJson })));

      expect(failureIn(read)).toBe(
        `${ordersPackage}@1.0.0's snapshot.json is ${said}, not ${ordersPackage}@1.0.0`,
      );
    },
  );

  test.for([
    ['a scope that is no text', orders, Symbol('org')],
    ['no declared Snapshot', null, '@org'],
    ['a name that is no text', { kind: 'service', name: 7 }, '@org'],
    ['a kind cf-loom does not know', { kind: 'library', name: 'orders-service' }, '@org'],
  ] as const)(
    '%s fails rather than throws, asking nothing of the registry',
    async ([, declared, scope], { lab }) => {
      const registry = await lab.aRegistry();
      const npm = lab.aPlace({ userConfig: loginTo(registry) });

      const read = await baselineOf(npm, declared as never, scope as never);

      expect(failureIn(read)).toBe(
        'cannot name the package to read: a scope and a Snapshot name must be texts, and a Snapshot kind must be service, application or definitions',
      );
      expect(registry.requests).toEqual([]);
    },
  );

  test('a package whose every version was unpublished fails, saying so', async ({ lab }) => {
    const unpublished = { versions: [], unpublishedAt: '2020-01-02T00:00:00.000Z' };

    const { read, registry } = await readOrders(lab, {
      packages: { [ordersPackage]: unpublished },
    });

    expect(failureIn(read)).toContain(
      `${ordersPackage} was unpublished: Unpublished on 2020-01-02`,
    );
    expect(registry.requests.map((request) => request.path)).not.toContain('/-/whoami');
  });

  test.for([
    ['lists no version', ordersWith()],
    [
      'has versions but no latest dist-tag',
      {
        packages: {
          [ordersPackage]: { versions: [aVersion('1.0.0')], distTags: { next: '1.0.0' } },
        },
      },
    ],
  ] as const)('a package that %s fails, saying so', async ([, served], { lab }) => {
    const { read } = await readOrders(lab, served);

    expect(failureIn(read)).toBe(
      `${ordersPackage} lists no version, or has no latest dist-tag, which npm view needs to list them`,
    );
  });

  test.for([
    [401, 'E401'],
    [403, 'E403'],
    [500, 'E500'],
    [429, 'E429'],
  ] as const)(
    'a registry that answers %s fails with npm’s code and summary',
    async ([status, code], { lab }) => {
      const packument = `/${ordersPackage.replace('/', '%2f')}`;
      const answers = { [packument]: { status, body: 'a plain text body' } };

      const { read } = await readOrders(lab, { answers });

      expect(failureIn(read)).toMatch(
        new RegExp(`^npm view ${ordersPackage} failed \\(${code}: .+\\)$`),
      );
    },
  );

  test('a refused connection fails rather than throws', async ({ lab }) => {
    const registry = await lab.aDeadAddress();
    const npm = lab.aPlace({ userConfig: loginTo(registry) });

    const read = await baselineOf(npm, orders, '@org');

    expect(failureIn(read)).toMatch(
      /^npm view @org\/contract-orders-service failed \(ECONNREFUSED: /,
    );
  });

  test('a registry that never answers fails within npm’s fetch-timeout', async ({ lab }) => {
    const packument = `/${ordersPackage.replace('/', '%2f')}`;
    const registry = await lab.aRegistry({ answers: { [packument]: 'hang' } });
    const npm = lab.aPlace({ userConfig: loginTo(registry), fetchTimeout: 300 });

    const read = await baselineOf(npm, orders, '@org');

    expect(failureIn(read)).toMatch(/^npm view @org\/contract-orders-service failed \(/);
  });

  test('npm missing from PATH fails rather than throws', async ({ lab }) => {
    const npm = lab.aPlace({ path: lab.aFolder() });

    const read = await baselineOf(npm, orders, '@org');

    expect(failureIn(read)).toBe(
      'npm cannot be run: spawn npm ENOENT: cf-loom reads the registry through npm, which must be on PATH',
    );
  });

  test.for([
    ['no dist', null],
    ['no tarball', { tarball: undefined }],
  ] as const)('a version with %s fails before anything is packed', async ([, dist], { lab }) => {
    const { read, registry } = await readOrders(lab, ordersWith(aVersion('1.0.0', { dist })));

    expect(failureIn(read)).toBe(`${ordersPackage}@1.0.0 has no tarball`);
    expect(tarballsRequested(registry)).toEqual([]);
  });

  test.for([
    ['only a sha1', (tarball: Buffer) => ({ integrity: integrityOf(tarball, 'sha1') })],
    ['a malformed sha512', () => ({ integrity: 'sha512-AAAA' })],
    ['none', () => ({ integrity: undefined, shasum: undefined })],
  ] as const)(
    'a version with an integrity of %s fails before anything is packed',
    async ([, dist], { lab }) => {
      const version = aVersion('1.0.0');

      const { read, registry } = await readOrders(
        lab,
        ordersWith({ ...version, dist: dist(version.tarball) }),
      );

      expect(failureIn(read)).toBe(
        `${ordersPackage}@1.0.0 has no sha512 integrity, so its tarball cannot be verified`,
      );
      expect(tarballsRequested(registry)).toEqual([]);
    },
  );

  test('a version whose integrity holds several hashes, among them a sha512, is read', async ({
    lab,
  }) => {
    const version = aVersion('1.0.0');
    const integrity = `${integrityOf(version.tarball, 'sha1')} ${integrityOf(version.tarball, 'sha512')}`;

    const { read } = await readOrders(lab, ordersWith({ ...version, dist: { integrity } }));

    expect(baselineIn(read).snapshot.version).toBe('1.0.0');
  });

  test('a tarball that does not match its integrity fails', async ({ lab }) => {
    const integrity = integrityOf(Buffer.from('other bytes'), 'sha512');

    const { read } = await readOrders(lab, ordersWith(aVersion('1.0.0', { dist: { integrity } })));

    expect(failureIn(read)).toMatch(
      /^npm pack @org\/contract-orders-service@1.0.0 failed \(EINTEGRITY: /,
    );
  });

  test('a tarball that npm pack reads from other metadata than npm view fails', async ({ lab }) => {
    const forged = { ...aPublishedSnapshot(orders, '1.0.0'), generator: 'forged' };
    const packed = aPackageTarball(canonicalTextOf(forged));

    const { read, registry } = await readOrders(lab, ordersWith(aVersion('1.0.0', { packed })));

    expect(failureIn(read)).toBe(
      `${ordersPackage}@1.0.0's tarball does not match the sha512 integrity npm view lists`,
    );
    expect(tarballsRequested(registry)).toEqual([packedPathOf(ordersPackage, '1.0.0')]);
  });

  test.for([404, 500])('a tarball the registry answers with %s fails', async (status, { lab }) => {
    const answers = { [tarballPathOf(ordersPackage, '1.0.0')]: { status } };

    const { read } = await readOrders(lab, { ...ordersWith(aVersion('1.0.0')), answers });

    expect(failureIn(read)).toMatch(/^npm pack @org\/contract-orders-service@1.0.0 failed \(/);
  });

  test.for([
    ['is no gzip', Buffer.from('definitely not a gzip file'), 'is no gzip'],
    ['is no tar archive', gzipSync(Buffer.alloc(2048, 'x')), 'is no tar archive'],
    [
      'has a wrong header checksum',
      aTarball([{ path: 'package/snapshot.json', content: '{}', corruptChecksum: true }]),
      'is no tar archive',
    ],
    [
      'has a base-256 size',
      aTarball([
        {
          path: 'package/snapshot.json',
          sizeField: Buffer.from([0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]),
        },
      ]),
      'is no tar archive',
    ],
    [
      'is cut short',
      gzipSync(
        tarOf([{ path: 'package/snapshot.json', content: 'x'.repeat(1000) }]).subarray(0, 700),
      ),
      'is no tar archive',
    ],
    [
      'has data after a zero block',
      gzipSync(
        Buffer.concat([
          tarOf([{ path: 'package/snapshot.json', content: 'decoy' }]).subarray(0, -block),
          tarOf([{ path: 'package/snapshot.json', content: 'real' }]),
        ]),
      ),
      'has data after its end',
    ],
    [
      'has a pax size that differs from its header',
      aTarball([
        { path: 'package/snapshot.json', content: 'decoy' },
        { path: 'PaxHeader/x', type: 'x', content: paxRecord('size', '0') },
        { path: 'package/padding', content: hiddenEntry },
      ]),
      paxNotWritten,
    ],
    [
      'has a malformed pax header',
      aTarball([
        { path: 'PaxHeader/x', type: 'x', content: '99 path=package/snapshot.json\n' },
        { path: 'placeholder', content: '{}' },
      ]),
      'is no tar archive',
    ],
  ] as const)('a tarball that %s fails', async ([, tarball, said], { lab }) => {
    const { read } = await readOrders(lab, ordersWith(aVersion('1.0.0', { tarball })));

    expect(failureIn(read)).toBe(`${ordersPackage}@1.0.0's tarball cannot be read: ${said}`);
  });

  test('a version key that is no semantic version fails', async ({ lab }) => {
    const served = ordersWith(aVersion('1.0.0'), aVersion('v1.1.0'));

    const { read } = await readOrders(lab, served);

    expect(failureIn(read)).toBe(`${ordersPackage} lists v1.1.0, which is no semantic version`);
  });

  test.for([
    ['that are a list', ['zod']],
    ['with a range that is no text', { zod: 4 }],
  ] as const)('peerDependencies %s fail', async ([, peerDependencies], { lab }) => {
    const served = ordersWith(aVersion('1.0.0', { manifest: { peerDependencies } }));

    const { read } = await readOrders(lab, served);

    expect(failureIn(read)).toBe(
      `${ordersPackage}@1.0.0 has peerDependencies that are no map of ranges`,
    );
  });

  test('an npm that prints no JSON fails with its first line', async ({ lab }) => {
    const registry = await lab.aRegistry();
    const stub = aStubNpm(lab, 'echo "npm is not itself today"\necho "second line"');
    const npm = lab.aPlace({ userConfig: loginTo(registry), path: stub });

    const read = await baselineOf(npm, orders, '@org');

    expect(failureIn(read)).toBe(
      `npm view ${ordersPackage} printed no JSON: npm is not itself today`,
    );
  });

  test('a tarball larger than 64 MiB fails', async ({ lab }) => {
    const entries = [{ path: 'package/blob', content: Buffer.alloc(64 * mebibyte + 1024) }];
    const tarball = gzipSync(tarOf(entries), { level: 0 });

    const { read } = await readOrders(lab, ordersWith(aVersion('1.0.0', { tarball })));

    expect(failureIn(read)).toBe(
      `${ordersPackage}@1.0.0's tarball cannot be read: is larger than 64 MiB`,
    );
  });

  test('a tarball larger than 64 MiB unpacked fails', async ({ lab }) => {
    const entries = [{ path: 'package/blob', content: Buffer.alloc(64 * mebibyte + 1024) }];
    const tarball = gzipSync(tarOf(entries));

    const { read } = await readOrders(lab, ordersWith(aVersion('1.0.0', { tarball })));

    expect(failureIn(read)).toBe(
      `${ordersPackage}@1.0.0's tarball cannot be read: is larger than 64 MiB unpacked`,
    );
  });

  test.for([
    ['no snapshot.json', [{ path: 'package/package.json', content: '{}' }], 'has no snapshot.json'],
    [
      'two',
      [
        { path: 'package/snapshot.json', content: '{}' },
        { path: 'package/snapshot.json', content: '{}' },
      ],
      'has more than one snapshot.json',
    ],
    [
      'two, one in another letter case',
      [
        { path: 'package/snapshot.json', content: 'decoy' },
        { path: 'package/Snapshot.JSON', content: 'real' },
      ],
      'has more than one snapshot.json',
    ],
    [
      'two, both in other letter cases',
      [
        { path: 'package/SNAPSHOT.json', content: 'decoy' },
        { path: 'package/Snapshot.json', content: 'real' },
      ],
      'has more than one snapshot.json',
    ],
    [
      'only one, under a folder named at the end of a prefix of more than 130 characters',
      [
        {
          path: 'snapshot.json',
          prefix: `p/${'./'.repeat(64)}sub`,
          content: '{}',
        },
      ],
      'has no snapshot.json',
    ],
    [
      'only one, in another letter case',
      [{ path: 'package/Snapshot.json', content: '{}' }],
      'has no snapshot.json',
    ],
    [
      'two, one behind a dot segment',
      [
        { path: 'package/snapshot.json', content: 'decoy' },
        { path: 'package/./snapshot.json', content: 'real' },
      ],
      'has more than one snapshot.json',
    ],
    [
      'two, one behind an empty segment',
      [
        { path: 'package/snapshot.json', content: 'decoy' },
        { path: 'package//snapshot.json', content: 'real' },
      ],
      'has more than one snapshot.json',
    ],
  ] as const)('a tarball with %s fails', async ([, entries, said], { lab }) => {
    const tarball = aTarball(entries);

    const { read } = await readOrders(lab, ordersWith(aVersion('1.0.0', { tarball })));

    expect(failureIn(read)).toBe(`${ordersPackage}@1.0.0 ${said}`);
  });

  test.for([
    [
      'two pax headers in a row, the second the one that names the path',
      [
        { path: 'package/snapshot.json', content: 'decoy' },
        { path: 'PaxHeader/x', type: 'x', content: paxRecord('path', 'package/snapshot.json') },
        { path: 'PaxHeader/x', type: 'x', content: paxRecord('mtime', '1') },
        { path: 'package/placeholder', content: 'real' },
      ],
      paxNotWritten,
    ],
    [
      'two pax headers in a row, the first with a size',
      [
        { path: 'package/snapshot.json', content: 'decoy' },
        { path: 'PaxHeader/x', type: 'x', content: paxRecord('size', '0') },
        { path: 'PaxHeader/x', type: 'x', content: paxRecord('mtime', '1') },
        { path: 'package/padding', content: hiddenEntry },
      ],
      paxNotWritten,
    ],
    [
      'a pax header with no entry after it',
      [
        { path: 'package/snapshot.json', content: 'decoy' },
        { path: 'PaxHeader/x', type: 'x', content: paxRecord('path', 'package/snapshot.json') },
      ],
      paxNotWritten,
    ],
    [
      'a pax header of a mebibyte and one byte',
      [
        { path: 'package/snapshot.json', content: 'decoy' },
        { path: 'PaxHeader/x', type: 'x', content: paxOfOneMebibytePlusOne },
        { path: 'package/placeholder', content: 'real' },
      ],
      paxNotWritten,
    ],
    [
      'a pax header over a mebibyte with a key npm does not write',
      [
        { path: 'package/snapshot.json', content: 'decoy' },
        {
          path: 'PaxHeader/x',
          type: 'x',
          content: paxRecord('comment', 'y'.repeat(mebibyte + 10)) + paxRecord('path', 'package/a'),
        },
        { path: 'package/snapshot.json', content: 'real' },
      ],
      paxNotWritten,
    ],
    [
      'a pax header with a key npm does not write',
      [
        { path: 'PaxHeader/x', type: 'x', content: paxRecord('uid', '0') },
        { path: 'package/snapshot.json', content: 'real' },
      ],
      paxNotWritten,
    ],
    [
      'a pax header with a link path',
      [
        { path: 'PaxHeader/x', type: 'x', content: paxRecord('linkpath', 'package/a') },
        { path: 'package/snapshot.json', content: 'real' },
      ],
      paxNotWritten,
    ],
    [
      'a pax header with a path twice',
      [
        {
          path: 'PaxHeader/x',
          type: 'x',
          content: paxRecord('path', 'package/a') + paxRecord('path', 'package/snapshot.json'),
        },
        { path: 'package/placeholder', content: 'real' },
      ],
      paxNotWritten,
    ],
    [
      'a pax header with a modification time that is no number',
      [
        { path: 'PaxHeader/x', type: 'x', content: paxRecord('mtime', 'yesterday') },
        { path: 'package/snapshot.json', content: 'real' },
      ],
      paxNotWritten,
    ],
    [
      'a pax header with a size that is no number',
      [
        { path: 'PaxHeader/x', type: 'x', content: paxRecord('size', 'x') },
        { path: 'package/snapshot.json', content: 'real' },
      ],
      paxNotWritten,
    ],
    [
      'a pax header with a line break in its path',
      [
        { path: 'PaxHeader/x', type: 'x', content: paxRecord('path', 'pa\nckage/snapshot.json') },
        { path: 'package/decoy', content: 'decoy' },
      ],
      paxNotWritten,
    ],
    [
      'a global pax header',
      [
        { path: 'package/snapshot.json', content: 'decoy' },
        { path: 'PaxHeader/g', type: 'g', content: paxRecord('size', '0') },
        { path: 'package/padding', content: hiddenEntry },
      ],
      entryNotWritten,
    ],
    [
      'a link path on a file',
      [
        { path: 'package/snapshot.json', content: 'decoy' },
        { path: 'package/padding', linkname: 'x', content: hiddenEntry },
      ],
      entryNotWritten,
    ],
    [
      'a folder with a body',
      [
        { path: 'package/snapshot.json', content: 'decoy' },
        { path: 'package/dist', type: '5', content: hiddenEntry },
      ],
      entryNotWritten,
    ],
    [
      'a ustar version that is not 00',
      [
        { path: 'package/snapshot.json', content: 'decoy' },
        { path: 'package/snapshot.json', prefix: 'zzz', ustar: 'ustar\x00xx', content: 'real' },
      ],
      entryNotWritten,
    ],
    [
      'a GNU magic',
      [{ path: 'package/snapshot.json', ustar: 'ustar  \x00', content: '{}' }],
      entryNotWritten,
    ],
    [
      'a header with no ustar magic',
      [{ path: 'package/snapshot.json', ustar: '', content: '{}' }],
      entryNotWritten,
    ],
    [
      'an empty path',
      [
        { path: 'package/snapshot.json', content: 'decoy' },
        { path: '', content: hiddenEntry },
      ],
      pathNotWritten,
    ],
    [
      'a file whose path ends with a slash, and a body',
      [
        { path: 'package/snapshot.json', content: 'decoy' },
        { path: 'package/dist/', content: hiddenEntry },
      ],
      pathNotWritten,
    ],
    [
      'a file named snapshot.json with a slash after it',
      [{ path: 'package/snapshot.json/', content: '{}' }],
      pathNotWritten,
    ],
    [
      'a path with a backslash',
      [{ path: 'package\\snapshot.json', content: '{}' }],
      pathNotPlainAscii,
    ],
    [
      'a path with a drive letter, package/c:snapshot.json, which npm’s tar strips',
      [
        { path: 'package/package.json', content: '{}' },
        { path: 'package/snapshot.json', content: 'decoy' },
        { path: 'package/c:snapshot.json', content: 'real' },
      ],
      pathNotPlainAscii,
    ],
    [
      'a path with a drive letter and a slash, package/c:/snapshot.json, which npm’s tar strips',
      [
        { path: 'package/package.json', content: '{}' },
        { path: 'package/snapshot.json', content: 'decoy' },
        { path: 'package/c:/snapshot.json', content: 'real' },
      ],
      pathNotPlainAscii,
    ],
    [
      'a pax path with a drive letter',
      [
        { path: 'package/snapshot.json', content: 'decoy' },
        { path: 'PaxHeader/x', type: 'x', content: paxRecord('path', 'package/c:snapshot.json') },
        { path: 'package/placeholder', content: 'real' },
      ],
      pathNotPlainAscii,
    ],
    ['a colon in a file name', [{ path: 'package/dist/a:b.js', content: '{}' }], pathNotPlainAscii],
    [
      'a path with a multibyte character',
      [
        { path: 'package/snapshot.json', content: 'decoy' },
        { path: 'package/é.txt', content: 'real' },
      ],
      pathNotPlainAscii,
    ],
    [
      'a path named by a long s, which a filesystem that folds case reads as an s',
      [
        { path: 'package/snapshot.json', content: 'decoy' },
        { path: 'package/\u017fnapshot.json', content: 'real' },
      ],
      pathNotPlainAscii,
    ],
    [
      'a ustar prefix with a multibyte character',
      [
        { path: 'package/snapshot.json', content: 'decoy' },
        { path: 'snapshot.json', prefix: 'package/é', content: 'real' },
      ],
      pathNotPlainAscii,
    ],
    [
      'a path with a control character',
      [{ path: 'package/dist/a\u0001.js', content: '{}' }],
      pathNotPlainAscii,
    ],
    [
      'a path with a DEL character',
      [{ path: 'package/dist/a\u007f.js', content: '{}' }],
      pathNotPlainAscii,
    ],
    [
      'a pax path with a multibyte character',
      [
        { path: 'package/snapshot.json', content: 'decoy' },
        {
          path: 'PaxHeader/x',
          type: 'x',
          content: paxRecordOfBytes('path', Buffer.from('package/é.txt')),
        },
        { path: 'package/placeholder', content: 'real' },
      ],
      paxBeyondAscii,
    ],
    [
      'a pax path with a multibyte character that a 16 KiB chunk of the archive splits',
      [
        { path: 'package/snapshot.json', content: 'decoy' },
        { path: 'package/filler.txt', content: Buffer.alloc(bytesBeforeSplitPax, 0x61) },
        { path: 'PaxHeader/x', type: 'x', content: splitPaxPath },
        { path: 'package/placeholder', content: 'real' },
      ],
      paxBeyondAscii,
    ],
    [
      'a pax path with a 0xff byte',
      [
        { path: 'package/snapshot.json', content: 'decoy' },
        {
          path: 'PaxHeader/x',
          type: 'x',
          content: paxRecordOfBytes(
            'path',
            Buffer.concat([Buffer.from('package/harmless'), Buffer.from([0xff])]),
          ),
        },
        { path: 'package/snapshot.json', content: 'real' },
      ],
      paxBeyondAscii,
    ],
    [
      'a pax record whose length has a leading zero, which npm’s tar drops',
      [
        { path: 'package/snapshot.json', content: 'decoy' },
        {
          path: 'PaxHeader/x',
          type: 'x',
          content: paxRecord('path', 'package/harmless.txt', '0'),
        },
        { path: 'package/snapshot.json', content: 'real' },
      ],
      paxNotWritten,
    ],
    [
      'a path with a .. segment',
      [{ path: 'package/dist/../snapshot.json', content: '{}' }],
      pathNotWritten,
    ],
    [
      'a pax path with a .. segment',
      [
        { path: 'PaxHeader/x', type: 'x', content: paxRecord('path', '../snapshot.json') },
        { path: 'package/placeholder', content: '{}' },
      ],
      pathNotWritten,
    ],
    [
      'a mode that is a base-256 number',
      [
        { path: 'package/snapshot.json', content: 'decoy' },
        { path: 'package/padding', overwrite: base256At(100), content: hiddenEntry },
      ],
      entryNotWritten,
    ],
    [
      'a modification time that is a base-256 number',
      [
        { path: 'package/snapshot.json', content: 'decoy' },
        { path: 'package/padding', overwrite: base256At(136), content: hiddenEntry },
      ],
      entryNotWritten,
    ],
    [
      'a device number that is a base-256 number',
      [
        { path: 'package/snapshot.json', content: 'decoy' },
        { path: 'package/padding', overwrite: base256At(329), content: hiddenEntry },
      ],
      entryNotWritten,
    ],
    [
      'a change time that is a base-256 number',
      [
        { path: 'package/snapshot.json', content: 'decoy' },
        { path: 'package/padding', overwrite: base256At(488), content: hiddenEntry },
      ],
      entryNotWritten,
    ],
    [
      'a name with text after its NUL',
      [
        { path: 'package/snapshot.json', content: 'decoy' },
        { path: '', overwrite: textAt(0, 'package/padding\0\nx'), content: hiddenEntry },
      ],
      entryNotWritten,
    ],
    [
      'a prefix with text after its NUL',
      [
        { path: 'package/snapshot.json', content: 'decoy' },
        { path: 'padding', overwrite: textAt(345, 'package\0\nx'), content: hiddenEntry },
      ],
      entryNotWritten,
    ],
    [
      'a checksum of eight digits, which npm’s tar reads with the type after it',
      [
        { path: 'package/snapshot.json', content: 'decoy' },
        {
          path: 'package/padding',
          checksumAs: (checksum: number) => octal(checksum, 8),
          content: hiddenEntry,
        },
      ],
      'is no tar archive',
    ],
    [
      'a pax path of digits only, which npm’s tar reads as a number',
      [
        { path: 'package/snapshot.json', content: 'decoy' },
        { path: 'PaxHeader/x', type: 'x', content: paxRecord('path', '123') },
        { path: 'package/padding', content: hiddenEntry },
      ],
      paxNotWritten,
    ],
    [
      'a path of more than 1024 segments after the first, which npm’s tar leaves out',
      [
        {
          path: 'PaxHeader/x',
          type: 'x',
          content: paxRecord('path', `package/${'./'.repeat(1024)}snapshot.json`),
        },
        { path: 'package/placeholder', content: '{}' },
      ],
      pathNotWritten,
    ],
    [
      'a folder named snapshot.json',
      [{ path: 'package/snapshot.json', type: '5' }],
      folderNamedSnapshot,
    ],
    [
      'a folder named snapshot.json, in another letter case, after the file',
      [
        { path: 'package/snapshot.json', content: '{}' },
        { path: 'package/SNAPSHOT.json/', type: '5' },
      ],
      folderNamedSnapshot,
    ],
    [
      'a file under a folder named snapshot.json',
      [
        { path: 'package/snapshot.json', content: '{}' },
        { path: 'package/snapshot.json/index.js', content: 'export {};' },
      ],
      folderNamedSnapshot,
    ],
  ] as const)('a tarball with %s fails', async ([, entries, said], { lab }) => {
    const tarball = aTarball(entries);

    const { read } = await readOrders(lab, ordersWith(aVersion('1.0.0', { tarball })));

    expect(failureIn(read)).toBe(`${ordersPackage}@1.0.0's tarball cannot be read: ${said}`);
  });

  test.for([
    ['a hard link', '1'],
    ['a symbolic link', '2'],
    ['a character device', '3'],
    ['a block device', '4'],
    ['a named pipe', '6'],
    ['a contiguous file', '7'],
    ['an old extended header', 'X'],
    ['a GNU long-name', 'L'],
    ['a GNU long link name', 'K'],
    ['an old GNU long-name', 'N'],
    ['a GNU sparse file', 'S'],
  ] as const)('a tarball with %s entry fails', async ([, type], { lab }) => {
    const tarball = aTarball([
      { path: 'package/snapshot.json', content: 'decoy' },
      { path: 'package/other', type, content: 'package/snapshot.json\0' },
      { path: 'package/snapshot.json', content: 'real' },
    ]);

    const { read } = await readOrders(lab, ordersWith(aVersion('1.0.0', { tarball })));

    expect(failureIn(read)).toBe(
      `${ordersPackage}@1.0.0's tarball cannot be read: ${entryNotWritten}`,
    );
  });
  test.for([
    ['its first folder is called anything', 'folder'],
    ['it sits behind a ustar prefix', 'prefix'],
    ['a pax header gives its path, a modification time and a size that agrees', 'pax'],
    ['a pax header of exactly a mebibyte names it', 'big-pax'],
    ['a folder entry comes before it', 'folder-entry'],
    ['its type flag is a NUL', 'nul-type'],
    ['a long ustar prefix needs the bytes where an access time would be', 'long-prefix'],
    ['an access time sits after a short ustar prefix', 'access-time'],
    ['its path has 1024 segments after the first', 'deep'],
  ] as const)('snapshot.json is found when %s', async ([, placing], { lab }) => {
    const json = canonicalTextOf(aPublishedSnapshot(orders, '1.0.0'));
    const placed = {
      folder: [{ path: 'orders-contract-1.0.0/snapshot.json', content: json }],
      prefix: [{ path: 'snapshot.json', prefix: 'package', content: json }],
      pax: [
        {
          path: 'PaxHeader/x',
          type: 'x',
          content:
            paxRecord('path', 'package/snapshot.json') +
            paxRecord('mtime', '499162500') +
            paxRecord('size', String(Buffer.byteLength(json))),
        },
        { path: 'placeholder', content: json },
      ],
      deep: [
        {
          path: 'PaxHeader/x',
          type: 'x',
          content: paxRecord('path', `package/${'./'.repeat(1023)}snapshot.json`),
        },
        { path: 'placeholder', content: json },
      ],
      'big-pax': [
        { path: 'PaxHeader/x', type: 'x', content: paxOfOneMebibyte },
        { path: 'placeholder', content: json },
      ],
      'nul-type': [{ path: 'package/snapshot.json', type: '\0', content: json }],
      'long-prefix': [{ path: 'snapshot.json', prefix: 'p'.repeat(150), content: json }],
      'access-time': [
        {
          path: 'snapshot.json',
          prefix: 'package',
          overwrite: textAt(476, '00000000000\0'),
          content: json,
        },
      ],
      'folder-entry': [
        { path: 'package/dist/', type: '5' },
        { path: 'package/snapshot.json', content: json },
      ],
    };
    const tarball = aTarball(placed[placing]);

    const { read } = await readOrders(lab, ordersWith(aVersion('1.0.0', { tarball })));

    expect(baselineIn(read).snapshot).toEqual(aPublishedSnapshot(orders, '1.0.0'));
  });

  test.for([
    [
      'a checksum written with seven digits and a NUL',
      { checksumAs: (sum: number) => `${octal(sum, 7)}\0` },
    ],
    [
      'a checksum written with six digits, a space and a NUL',
      { checksumAs: (sum: number) => `${octal(sum, 6)} \0` },
    ],
    [
      'a size written with ten digits, a space and a NUL',
      { sizeAs: (size: number) => `${octal(size, 10)} \0` },
    ],
    [
      'a size written with eleven digits and a space',
      { sizeAs: (size: number) => `${octal(size, 11)} ` },
    ],
  ] as const)('a header with %s is read', async ([, form], { lab }) => {
    const json = canonicalTextOf(aPublishedSnapshot(orders, '1.0.0'));
    const tarball = aTarball([{ path: 'package/snapshot.json', content: json, ...form }]);

    const { read } = await readOrders(lab, ordersWith(aVersion('1.0.0', { tarball })));

    expect(baselineIn(read).snapshot).toEqual(aPublishedSnapshot(orders, '1.0.0'));
  });

  test.for([
    ['npm', 'npm', { [`dist/${'f'.repeat(130)}.js`]: 'export {};' }],
    ['pnpm', 'pnpm', {}],
  ] as const)(
    'a tarball packed by %s is read, whatever the lengths of its ASCII paths',
    async ([, packer, extra], { lab }) => {
      const snapshot = aPublishedSnapshot(orders, '1.0.0');
      const tarball = aFolderPackedBy(lab, packer, {
        'package.json': JSON.stringify({ name: ordersPackage, version: '1.0.0' }),
        'snapshot.json': canonicalTextOf(snapshot),
        'dist/index.js': 'export {};',
        [`dist/${'d'.repeat(60)}/${'g'.repeat(50)}.js`]: 'export {};',
        ...extra,
      });

      const { read } = await readOrders(lab, ordersWith(aVersion('1.0.0', { tarball })));

      expect(baselineIn(read).snapshot).toEqual(snapshot);
    },
  );

  test('a tarball packed by npm with a file named in other than ASCII fails', async ({ lab }) => {
    const tarball = aFolderPackedBy(lab, 'npm', {
      'package.json': JSON.stringify({ name: ordersPackage, version: '1.0.0' }),
      'snapshot.json': canonicalTextOf(aPublishedSnapshot(orders, '1.0.0')),
      'dist/ünïcödé-ファイル.js': 'export {};',
    });

    const { read } = await readOrders(lab, ordersWith(aVersion('1.0.0', { tarball })));

    expect(failureIn(read)).toBe(
      `${ordersPackage}@1.0.0's tarball cannot be read: ${paxBeyondAscii}`,
    );
  });

  test('a snapshot.json that is no UTF-8 fails', async ({ lab }) => {
    const snapshotJson = Buffer.from([0x7b, 0xff, 0xfe, 0x7d]);

    const { read } = await readOrders(lab, ordersWith(aVersion('1.0.0', { snapshotJson })));

    expect(failureIn(read)).toBe(`${ordersPackage}@1.0.0's snapshot.json is no UTF-8 text`);
  });

  test.for([
    ['is no JSON', '{', /^@org\/contract-orders-service@1.0.0's snapshot.json is no JSON \(.+\)$/],
    [
      'is in a newer format',
      '{"format":2}',
      /^@org\/contract-orders-service@1.0.0's snapshot.json is in format 2, newer than this cf-loom reads: upgrade @cf-loom\/cli$/,
    ],
    [
      'is malformed',
      '{"format":1}',
      /^@org\/contract-orders-service@1.0.0's snapshot.json is malformed: .+/,
    ],
  ] as const)(
    'a snapshot.json that %s fails with the decoder’s reason',
    async ([, snapshotJson, said], { lab }) => {
      const { read } = await readOrders(lab, ordersWith(aVersion('1.0.0', { snapshotJson })));

      expect(failureIn(read)).toMatch(said);
    },
  );

  test('a failure message is one line, with ANSI and control characters removed', async ({
    lab,
  }) => {
    const packument = `/${ordersPackage.replace('/', '%2f')}`;
    const error = '\u001b[31mred\u001b[0m\nsecond line\u0007 end';
    const answers = { [packument]: jsonAnswer(403, { error }) };

    const { read } = await readOrders(lab, { answers });

    expect(failureIn(read)).toContain('red second line end');
    expect(failureIn(read)).not.toMatch(/\p{Cc}/u);
  });
});

function packDestinationIn(calls: readonly string[]): string {
  const [, destination] = /--pack-destination (\S+)/.exec(calls.join('\n')) ?? [];
  if (destination === undefined) {
    throw new Error(`npm pack was not called: ${calls.join('; ')}`);
  }
  return destination;
}

describe('baselineOf and its temporary folder', { timeout: npmTimeout }, () => {
  test.for([
    ['succeeds', ordersWith(aVersion('1.0.0')), 'baseline'],
    ['fails', ordersWith(aVersion('1.0.0', { snapshotJson: '{' })), 'failed'],
  ] as const)(
    'the temporary folder is made under the system’s and removed whether a read %s',
    async ([, served, kind], { lab }) => {
      const registry = await lab.aRegistry(served);
      const recording = aRecordingNpm(lab);
      const npm = lab.aPlace({ userConfig: loginTo(registry), path: recording.path });
      const tmp = lab.aFolder();
      const { TMPDIR: before } = process.env;
      setEnvironment('TMPDIR', tmp);

      const read = await baselineOf(npm, orders, '@org').finally(() =>
        setEnvironment('TMPDIR', before),
      );

      const destination = packDestinationIn(recording.calls());
      expect(read.kind).toBe(kind);
      expect(destination.startsWith(`${tmp}${sep}`)).toBe(true);
      expect(existsSync(destination)).toBe(false);
    },
  );

  test('a temporary folder that cannot be removed does not fail a read', async ({ lab }) => {
    const registry = await lab.aRegistry(ordersWith(aVersion('1.0.0')));
    const tmp = lab.aFolder();
    const npm = lab.aPlace({ userConfig: loginTo(registry), path: aPackLockingNpm(lab, tmp) });
    const { TMPDIR: before } = process.env;
    setEnvironment('TMPDIR', tmp);

    const read = await baselineOf(npm, orders, '@org').finally(() => {
      setEnvironment('TMPDIR', before);
      chmodSync(tmp, 0o755);
    });

    expect(read.kind).toBe('baseline');
  });

  test('a temporary folder that cannot be made fails rather than throws', async ({ lab }) => {
    const registry = await lab.aRegistry(ordersWith(aVersion('1.0.0')));
    const npm = lab.aPlace({ userConfig: loginTo(registry) });
    const { TMPDIR: before } = process.env;
    setEnvironment('TMPDIR', join(lab.aFolder(), 'nowhere'));

    const read = await baselineOf(npm, orders, '@org').finally(() =>
      setEnvironment('TMPDIR', before),
    );

    expect(failureIn(read)).toMatch(
      /^@org\/contract-orders-service@1.0.0's tarball cannot be read: /,
    );
  });

  test('a tarball npm names but did not write fails rather than throws', async ({ lab }) => {
    const metadata = `{"version":"1.0.0","cfLoom":{"kind":"service"},"dist":{"tarball":"http://x/y.tgz","integrity":"sha512-${'A'.repeat(86)}=="}}`;
    const body = `case "$1" in\nview) case "$2" in *@1.0.0) echo '${metadata}';; *) echo '["1.0.0"]';; esac;;\npack) echo '[{"filename":"missing.tgz"}]';;\nesac`;
    const npm = lab.aPlace({ path: aStubNpm(lab, body) });

    const read = await baselineOf(npm, orders, '@org');

    expect(failureIn(read)).toMatch(
      /^@org\/contract-orders-service@1.0.0's tarball cannot be read: /,
    );
  });
});
