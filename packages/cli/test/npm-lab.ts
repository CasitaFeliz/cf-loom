import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { type AddressInfo, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { canonicalTextOf, type PublishedSnapshot } from '@cf-loom/contract/internal';
import { test as baseTest } from 'vitest';
import type { NpmPlace } from '../src/internal/index.ts';

type Kind = 'service' | 'application' | 'definitions';
export type Declared = { readonly kind: Kind; readonly name: string };

export const token = 'tok-3f9c1a';
export const orders = { kind: 'service', name: 'orders-service' } as const satisfies Declared;
export const ordersPackage = '@org/contract-orders-service';

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

export function aPublishedSnapshot(declared: Declared, version: string): PublishedSnapshot {
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

export const block = 512;

export type TarEntry = {
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

export type Overwrite = { readonly at: number; readonly bytes: Buffer };

export const octal = (number: number, digits: number) => number.toString(8).padStart(digits, '0');

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

export function tarOf(entries: readonly TarEntry[]): Buffer {
  const blocks = entries.flatMap((entry) => {
    const content = Buffer.from(entry.content ?? '');
    const padding = Buffer.alloc((block - (content.length % block)) % block);
    return [headerOf(entry, content.length), content, padding];
  });
  return Buffer.concat([...blocks, Buffer.alloc(2 * block)]);
}

export function aTarball(entries: readonly TarEntry[]): Buffer {
  return gzipSync(tarOf(entries));
}

export function aPackageTarball(snapshotJson: Buffer | string, folder = 'package'): Buffer {
  return aTarball([
    { path: `${folder}/package.json`, content: '{}' },
    { path: `${folder}/snapshot.json`, content: snapshotJson },
    { path: `${folder}/dist/index.js`, content: 'export {};' },
  ]);
}

export function integrityOf(bytes: Buffer, algorithm: 'sha1' | 'sha512'): string {
  return `${algorithm}-${createHash(algorithm).update(bytes).digest('base64')}`;
}

export type ServedVersion = {
  readonly version: string;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly tarball: Buffer;
  readonly packed: Buffer | undefined;
  readonly dist: Readonly<Record<string, unknown>> | null;
};

export type VersionOptions = {
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

export function aVersion(version: string, options: VersionOptions = {}): ServedVersion {
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

export type Answer =
  | {
      readonly status: number;
      readonly body?: Buffer | string;
      readonly contentType?: string;
    }
  | 'hang';

export function jsonAnswer(status: number, value: unknown): Answer {
  return { status, body: JSON.stringify(value), contentType: 'application/json' };
}

export type RegistryOptions = {
  readonly packages?: Readonly<Record<string, FakePackage>>;
  readonly whoami?: Answer;
  readonly answers?: Readonly<Record<string, Answer>>;
};

type Recorded = {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | undefined;
};

export type Registry = {
  readonly url: string;
  readonly host: string;
  readonly requests: readonly Recorded[];
  readonly close: () => Promise<void>;
};

export function tarballPathOf(packageName: string, version: string): string {
  return `/tarballs/${packageName.replace('@', '').replace('/', '-')}-${version}.tgz`;
}

export function packedPathOf(packageName: string, version: string): string {
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

export type Address = Pick<Registry, 'url' | 'host'>;

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

export function loginTo(registry: Address): string {
  return `@org:registry=${registry.url}/\n//${registry.host}/:_authToken=${token}\n`;
}

export type EnvironmentOptions = {
  readonly userConfig?: string;
  readonly path?: string;
  readonly fetchTimeout?: number;
};

export type PlaceOptions = EnvironmentOptions & { readonly projectConfig?: string };

export type Lab = {
  readonly aRegistry: (options?: RegistryOptions) => Promise<Registry>;
  readonly aDeadAddress: () => Promise<Address>;
  readonly aPlace: (options: PlaceOptions) => NpmPlace;
  readonly anNpmEnvironment: (options?: EnvironmentOptions) => NpmEnvironment;
  readonly aFolder: () => string;
};

/** The environment npm runs with. */
export type NpmEnvironment = NpmPlace['env'];

export const { PATH: inheritedPath = '' } = process.env;
const npmSettings = /^npm_config_/i;
const proxySettings = /^(?:https?|all|no)_proxy$/i;

/** Everything of the process environment but npm's own settings and proxies, so no developer configuration reaches a test. */
const inheritedEnvironment = Object.entries(process.env).filter(
  ([name, value]) => value !== undefined && !npmSettings.test(name) && !proxySettings.test(name),
);

/** The environment of an npm whose user config, global config and cache sit in `folder`. */
function anNpmEnvironment(folder: string, options: EnvironmentOptions): NpmEnvironment {
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
  return Object.fromEntries([
    ...inheritedEnvironment,
    ['PATH', options.path ?? inheritedPath],
    ...settings.map(([name, value]) => [`npm_config_${name}`, value]),
  ]);
}

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
    return { directory, env: anNpmEnvironment(folder, options) };
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
    anNpmEnvironment: (options = {}) => anNpmEnvironment(aFolder(), options),
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

/** Vitest's `test` with a `lab` fixture: its registries, addresses and folders are gone when the test ends. */
export const test = baseTest.extend<{ lab: Lab }>({
  // biome-ignore lint/correctness/noEmptyPattern: vitest reads what a fixture needs from this pattern
  lab: async ({}, use) => {
    const lab = aLab();
    await use(lab);
    await lab.dispose();
  },
});
