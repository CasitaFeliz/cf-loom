import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { type Listed, npm } from './index.ts';

const token = 'npm_read-token';

type Recorded = {
  readonly path: string;
  readonly authorization: string | undefined;
  readonly accept: string | undefined;
};

type RegistryOptions = {
  readonly packages?: Readonly<Record<string, string>>;
  readonly status?: number;
  readonly statusMessage?: string;
  readonly body?: string;
  readonly headers?: Readonly<Record<string, string>>;
};

type Registry = {
  readonly url: string;
  readonly requests: Recorded[];
  readonly packages: Record<string, string>;
};

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(close));
});

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

function listening(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });
}

/** A registry on a free port that answers every request as `options` say, listing `packages`. */
async function aRegistry(options: RegistryOptions = {}): Promise<Registry> {
  const requests: Recorded[] = [];
  const packages = { ...options.packages };
  const server = createServer((request, response) => {
    const { authorization, accept } = request.headers;
    requests.push({ path: request.url ?? '', authorization, accept });
    const headers = { 'content-type': 'application/json', ...options.headers };
    response.writeHead(options.status ?? 200, options.statusMessage, headers);
    response.end(options.body ?? JSON.stringify(packages));
  });
  servers.push(server);
  return { url: await listening(server), requests, packages };
}

/** The URL of a port nothing listens on. */
async function aClosedRegistry(): Promise<string> {
  const server = createServer();
  const url = await listening(server);
  await close(server);
  return url;
}

function messageOf(listed: Listed): string {
  return listed.kind === 'failed' ? listed.message : '';
}

describe('npm', () => {
  test('an npm directory lists the organization’s packages in its scope', async () => {
    const registry = await aRegistry({
      packages: {
        '@org/contract-orders-service': 'write',
        '@org/contract-billing-service': 'write',
      },
    });
    const directory = npm({ org: 'org', token, registry: registry.url });

    const listed = await directory.list();

    expect(listed).toEqual({
      kind: 'listed',
      names: ['@org/contract-orders-service', '@org/contract-billing-service'],
    });
  });

  test('an npm directory keeps only names in the scope, not the unscoped or other-scope packages npm lists', async () => {
    const registry = await aRegistry({
      packages: {
        'babel-preset-es2018': 'write',
        '@org/contract-orders-service': 'write',
        '@other/contract-orders-service': 'write',
        '@organization/contract-orders-service': 'write',
      },
    });
    const directory = npm({ org: 'org', token, registry: registry.url });

    const listed = await directory.list();

    expect(listed).toEqual({ kind: 'listed', names: ['@org/contract-orders-service'] });
  });

  test('an organization with no packages lists an empty scope, not a failure', async () => {
    const registry = await aRegistry({ packages: {} });
    const directory = npm({ org: 'org', token, registry: registry.url });

    const listed = await directory.list();

    expect(listed).toEqual({ kind: 'listed', names: [] });
  });

  test('an npm directory asks for the organization’s package listing with its token as a bearer token', async () => {
    const registry = await aRegistry();
    const directory = npm({ org: 'org', token, registry: registry.url });

    await directory.list();

    expect(registry.requests).toEqual([
      { path: '/-/org/org/package', authorization: `Bearer ${token}`, accept: 'application/json' },
    ]);
  });

  test('without a token it fails and makes no request', async () => {
    const registry = await aRegistry();
    const directory = npm({ org: 'org', token: undefined, registry: registry.url });

    const listed = await directory.list();

    expect(listed).toEqual({
      kind: 'failed',
      message: "npm({ org: 'org' }) has no token, and npm lists only public packages without one",
    });
    expect(registry.requests).toEqual([]);
  });

  test.each(['', '   ', '\n'])(
    'a blank token (%j) fails as no token and makes no request',
    async (blank) => {
      const registry = await aRegistry();
      const directory = npm({ org: 'org', token: blank, registry: registry.url });

      const listed = await directory.list();

      expect(messageOf(listed)).toContain('has no token');
      expect(registry.requests).toEqual([]);
    },
  );

  test('a token that is not a string fails as no token and makes no request', async () => {
    const registry = await aRegistry();
    const directory = npm({ org: 'org', token: 42 as unknown as string, registry: registry.url });

    const listed = await directory.list();

    expect(messageOf(listed)).toContain('has no token');
    expect(registry.requests).toEqual([]);
  });

  test('a registry with a path keeps its path', async () => {
    const registry = await aRegistry();
    const directory = npm({ org: 'org', token, registry: `${registry.url}/registry/npm` });

    await directory.list();

    expect(registry.requests.map((request) => request.path)).toEqual([
      '/registry/npm/-/org/org/package',
    ]);
  });

  test.each(['/', '/registry/', '/registry//'])(
    'a registry ending in %j has no doubled slash in the request',
    async (ending) => {
      const registry = await aRegistry();
      const directory = npm({ org: 'org', token, registry: `${registry.url}${ending}` });

      await directory.list();

      const [request] = registry.requests;
      expect(request?.path).toBe(`${ending.replace(/\/+$/, '')}/-/org/org/package`);
    },
  );

  test('the organization is URL-encoded in the path', async () => {
    const registry = await aRegistry();
    const directory = npm({ org: 'a b/c', token, registry: registry.url });

    await directory.list();

    expect(registry.requests.map((request) => request.path)).toEqual(['/-/org/a%20b%2Fc/package']);
  });

  test('an organization that cannot be encoded in a URL is a failure, not a throw', async () => {
    const registry = await aRegistry();
    const directory = npm({ org: '\uD800', token, registry: registry.url });

    const listed = await directory.list();

    expect(listed).toEqual({
      kind: 'failed',
      message: 'npm({ org }) has an organization that cannot be put in a URL',
    });
    expect(registry.requests).toEqual([]);
  });

  test.each([
    [404, '{"error":"Scope not found"}', 'Scope not found'],
    [
      401,
      '{"error":"You must be logged in to publish packages."}',
      'You must be logged in to publish packages.',
    ],
    [
      500,
      '{"error":"bind message has 25816 parameter formats but 0 parameters"}',
      'bind message has 25816 parameter formats but 0 parameters',
    ],
  ])('a %i answer is a failure naming the status and npm’s error', async (status, body, error) => {
    const registry = await aRegistry({ status, body });
    const directory = npm({ org: 'org', token, registry: registry.url });

    const listed = await directory.list();

    expect(listed).toEqual({
      kind: 'failed',
      message: `${registry.url} answered ${status} listing the packages of the npm organization org: ${error}`,
    });
  });

  test('a 429 whose body is not JSON is a failure naming the status text', async () => {
    const registry = await aRegistry({
      status: 429,
      statusMessage: 'Too Many Requests',
      body: 'error code: 1015',
      headers: { 'content-type': 'text/plain' },
    });
    const directory = npm({ org: 'org', token, registry: registry.url });

    const listed = await directory.list();

    expect(listed).toEqual({
      kind: 'failed',
      message: `${registry.url} answered 429 listing the packages of the npm organization org: Too Many Requests`,
    });
  });

  test.each(['not json', '[]', 'null', '"@org/a"', '{"@org/a":1}', '{"@org/a":null}'])(
    'a 200 whose body is %s is a failure, not a partial list',
    async (body) => {
      const registry = await aRegistry({ body });
      const directory = npm({ org: 'org', token, registry: registry.url });

      const listed = await directory.list();

      expect(listed).toEqual({
        kind: 'failed',
        message: `${registry.url} answered the npm organization org with no map of package names`,
      });
    },
  );

  test('a refused connection is a failure, not a throw', async () => {
    const url = await aClosedRegistry();
    const directory = npm({ org: 'org', token, registry: url });

    const listed = await directory.list();

    expect(listed).toEqual({
      kind: 'failed',
      message: expect.stringMatching(new RegExp(`^${url} cannot be reached: .+`)),
    });
  });

  test.each(['not a url', '', 'ftp://registry.example'])(
    'a registry that is %j is a failure, not a throw',
    async (registry) => {
      const directory = npm({ org: 'org', token, registry });

      const listed = await directory.list();

      expect(listed).toEqual({
        kind: 'failed',
        message: "npm({ org: 'org' }) has a registry that is no http or https URL",
      });
    },
  );

  test('a redirect is a failure, and the token is not sent to the redirect’s target', async () => {
    const target = await aRegistry();
    const registry = await aRegistry({
      status: 302,
      headers: { location: `${target.url}/-/org/org/package` },
    });
    const directory = npm({ org: 'org', token, registry: registry.url });

    const listed = await directory.list();

    expect(listed).toEqual({
      kind: 'failed',
      message: `${registry.url} answered with a redirect listing the packages of the npm organization org; redirects are refused so the token stays with the registry`,
    });
    expect(target.requests).toEqual([]);
  });

  test('npm’s error loses its control and ANSI characters, and the message is one line', async () => {
    const error = '\u001b[31mScope\r\nnot\tfound\u001b[0m\u0007 !';
    const registry = await aRegistry({ status: 404, body: JSON.stringify({ error }) });
    const directory = npm({ org: 'org', token, registry: registry.url });

    const listed = await directory.list();

    expect(messageOf(listed)).toBe(
      `${registry.url} answered 404 listing the packages of the npm organization org: Scope not found !`,
    );
  });

  test('a message does not contain the token, even when npm’s error repeats it', async () => {
    const error = `${token} is not a token`;
    const registry = await aRegistry({ status: 401, body: JSON.stringify({ error }) });
    const directory = npm({ org: 'org', token, registry: registry.url });

    const listed = await directory.list();

    expect(listed.kind).toBe('failed');
    expect(messageOf(listed)).not.toContain(token);
  });

  test.each([
    ['an ANSI sequence', '\u001b[0m'],
    ['a control character', '\u0007'],
  ])(
    'a message does not contain the token, even when npm’s error splits it with %s',
    async (_, splitter) => {
      const error = `${token.slice(0, 4)}${splitter}${token.slice(4)} is not a token`;
      const registry = await aRegistry({ status: 401, body: JSON.stringify({ error }) });
      const directory = npm({ org: 'org', token, registry: registry.url });

      const listed = await directory.list();

      expect(listed.kind).toBe('failed');
      expect(messageOf(listed)).toContain('is not a token');
      expect(messageOf(listed)).not.toContain(token);
    },
  );

  test('a token with a trailing newline is used without it, in the request and in the message', async () => {
    const error = `${token} is not a token`;
    const registry = await aRegistry({ status: 401, body: JSON.stringify({ error }) });
    const directory = npm({ org: 'org', token: `${token}\n`, registry: registry.url });

    const listed = await directory.list();

    expect(registry.requests.map((request) => request.authorization)).toEqual([`Bearer ${token}`]);
    expect(messageOf(listed)).not.toContain(token);
  });

  test('a token with a newline fails without the token in the message', async () => {
    const registry = await aRegistry();
    const directory = npm({ org: 'org', token: 'npm_xqz\nvwk', registry: registry.url });

    const listed = await directory.list();

    expect(listed.kind).toBe('failed');
    expect(messageOf(listed)).not.toMatch(/xqz|vwk/);
    expect(registry.requests).toEqual([]);
  });

  test('a message quotes the registry without its credentials, query or fragment', async () => {
    const registry = await aRegistry({ status: 500, body: '{"error":"down"}' });
    const withExtras = registry.url.replace('http://', 'http://user:pass@');
    const directory = npm({ org: 'org', token, registry: `${withExtras}/npm?key=secret#top` });

    const listed = await directory.list();

    expect(listed).toEqual({
      kind: 'failed',
      message: `${registry.url}/npm answered 500 listing the packages of the npm organization org: down`,
    });
    expect(registry.requests.map((request) => request.path)).toEqual(['/npm/-/org/org/package']);
  });

  test('npm makes no request until list is called', async () => {
    const registry = await aRegistry();

    const directory = npm({ org: 'org', token, registry: registry.url });

    expect(registry.requests).toEqual([]);
    await directory.list();
    expect(registry.requests).toHaveLength(1);
  });

  test('each list reads the registry again, so a package published since the last list is listed', async () => {
    const registry = await aRegistry({ packages: { '@org/contract-orders-service': 'write' } });
    const directory = npm({ org: 'org', token, registry: registry.url });
    await directory.list();

    registry.packages['@org/contract-billing-service'] = 'write';
    const listed = await directory.list();

    expect(listed).toEqual({
      kind: 'listed',
      names: ['@org/contract-orders-service', '@org/contract-billing-service'],
    });
  });

  test('the token is a required key, so a configuration that forgets it is a type error', () => {
    // @ts-expect-error: `token` is required, as `undefined` when there is none
    const directory = npm({ org: 'org' });

    expect(directory).toHaveProperty('list');
  });
});
