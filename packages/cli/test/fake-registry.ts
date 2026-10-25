import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Published, publishedFrom } from './published-put.ts';
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

/** The packages a registry holds once it has answered a request for a path, as when someone else publishes meanwhile. */
type Later = {
  readonly afterRequestFor: string;
  readonly packages: Readonly<Record<string, FakePackage>>;
};

export type RegistryOptions = {
  readonly packages?: Readonly<Record<string, FakePackage>>;
  readonly whoami?: Answer;
  readonly answers?: Readonly<Record<string, Answer>>;
  readonly later?: Later;
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
  readonly published: readonly Published[];
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
  return { name, 'dist-tags': distTagsOf(served), versions };
}

/** What a package's `dist-tags` hold: those it was given, else `latest` on its last version. */
function distTagsOf(served: FakePackage): Readonly<Record<string, string>> {
  const latest = served.versions.at(-1)?.version;
  return served.distTags ?? (latest === undefined ? {} : { latest });
}

/** The package as it stands once a version is put to it, with the dist-tags the put asked for. */
function withPublished(served: FakePackage | undefined, put: Published): FakePackage {
  const { version, manifest, tarball } = put;
  const published = { version, manifest, tarball, packed: undefined, dist: {} };
  const distTags = { ...(served === undefined ? {} : distTagsOf(served)), ...put.distTags };
  return { versions: [...(served?.versions ?? []), published], distTags };
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

type Asked = {
  readonly method: string;
  readonly path: string;
  readonly accept: string | undefined;
  readonly body: string;
};

/** What a registry holds as it runs: the options it was given, its packages and what was put. */
type State = {
  readonly options: RegistryOptions;
  readonly packages: Record<string, FakePackage>;
  readonly published: Published[];
};

function putAnswerOf(body: string, { packages, published }: State): Answer {
  const put = publishedFrom(body);
  packages[put.name] = withPublished(packages[put.name], put);
  published.push(put);
  return jsonAnswer(201, { ok: true });
}

function answerOf({ method, path, accept, body }: Asked, state: State, url: string): Answer {
  const { options, packages } = state;
  const override = options.answers?.[path];
  if (override !== undefined) {
    return override;
  }
  if (method === 'PUT') {
    return putAnswerOf(body, state);
  }
  if (path === '/-/whoami') {
    return options.whoami ?? jsonAnswer(200, { username: 'tester' });
  }
  const isAbbreviated = accept?.startsWith('application/vnd.npm.install-v1+json') === true;
  for (const [name, served] of Object.entries(packages)) {
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

/**
 * An npm registry on the loopback that serves what the options give, keeps what npm puts to it and
 * records what it is asked.
 */
export async function aRegistry(options: RegistryOptions = {}): Promise<Registry> {
  const requests: Recorded[] = [];
  const state: State = { options, packages: { ...options.packages }, published: [] };
  const server = createServer((request, response) => {
    const method = request.method ?? '';
    const path = request.url ?? '';
    requests.push({ method, path, authorization: request.headers.authorization });
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const { accept } = request.headers;
      const body = Buffer.concat(chunks).toString('utf8');
      const url = `http://${request.headers.host}`;
      const answer = answerOf({ method, path, accept, body }, state, url);
      if (options.later?.afterRequestFor === path) {
        Object.assign(state.packages, options.later.packages);
      }
      if (answer === 'hang') {
        return;
      }
      response.statusCode = answer.status;
      response.setHeader('content-type', answer.contentType ?? 'text/plain');
      response.end(answer.body ?? '');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  const close = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  return { url: `http://${host}`, host, requests, published: state.published, close };
}
