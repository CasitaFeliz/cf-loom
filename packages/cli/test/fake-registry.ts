import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ServedVersion } from './served-version.ts';
import { integrityOf } from './tarball.ts';

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

/** Where a registry is: the URL npm is given and the host its login is written under. */
export type Address = Pick<Registry, 'url' | 'host'>;

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

/** An npm registry on the loopback that serves what the options give and records what it is asked. */
export async function aRegistry(options: RegistryOptions = {}): Promise<Registry> {
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
