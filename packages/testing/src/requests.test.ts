import {
  defineDependency,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineService,
  type Endpoint,
} from '@cf-loom/contract';
import {
  exportedSnapshotOf,
  reservedResponseOf,
  snapshotOf,
  validateRoot,
} from '@cf-loom/contract/internal';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { type Exportable, providedEndpointsOf } from '../test/provided.ts';
import { aRootPackage } from '../test/root-package.ts';
import { providedStandardRejections } from '../test/standard-rejections.ts';
import { FakeProviderError, fakeProvider } from './index.ts';

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'A key per Caller',
  demands: { headers: z.object({ 'x-api-key': z.string() }) },
});

const getPayment = defineEndpoint({
  name: 'getPayment',
  method: 'GET',
  path: '/payments/:paymentId',
  visibility: 'internal',
  description: 'One payment',
  guards: [apiKey],
  input: {
    params: z.object({ paymentId: z.string().min(3) }),
    query: z.object({ expand: z.array(z.string()).optional() }),
    headers: z.object({ 'x-api-key': z.string() }),
  },
  success: { status: 200, body: z.object({ id: z.string() }) },
});

const capturePayment = defineEndpoint({
  name: 'capturePayment',
  method: 'POST',
  path: '/payments/:paymentId/capture',
  visibility: 'internal',
  description: 'Captures a payment',
  input: {
    params: z.object({ paymentId: z.string().min(3) }),
    body: z.object({ amount: z.int().positive() }),
  },
  success: { status: 200, body: z.object({ id: z.string(), amount: z.int() }) },
});

const getSummary = defineEndpoint({
  name: 'getSummary',
  method: 'GET',
  path: '/payments/summary',
  visibility: 'internal',
  description: 'Every payment summed up',
  success: { status: 200, body: z.object({ total: z.int() }) },
});

/** An Endpoint whose literal path would beat `getPayment`'s param, of the Visibility and lifecycle given. */
function latestPayment(fields: {
  readonly visibility: 'private' | 'internal';
  readonly lifecycle: 'active' | 'retired';
}) {
  return defineEndpoint({
    name: 'getLatestPayment',
    method: 'GET',
    path: '/payments/latest',
    description: 'The latest payment',
    ...fields,
    success: { status: 200, body: z.object({ id: z.string() }) },
  });
}

/** A Private `latestPayment` that is Deprecated, which a Private Endpoint may be and stays live. */
const deprecatedLatestPayment = defineEndpoint({
  name: 'getLatestPayment',
  method: 'GET',
  path: '/payments/latest',
  visibility: 'private',
  description: 'The latest payment',
  lifecycle: 'deprecated',
  deprecatedAt: '2026-11-01T00:00:00Z',
  success: { status: 200, body: z.object({ id: z.string() }) },
});

/** The Provider's Contract Package, as `cf-loom package` writes it from its declarations. */
function contractPackageOf<const Endpoints extends Readonly<Record<string, Exportable>>>(
  endpoints: Endpoints,
  declared: readonly Endpoint[] = Object.values(endpoints),
) {
  const listed = declared as unknown as [Endpoint];
  const group = defineGroup({ name: 'payments', description: 'Payments', endpoints: listed });
  const root = defineService({ name: 'payments-service', groups: [group] });
  const rootPackage = aRootPackage(root, { packageName: 'payments-service' });
  const validated = validateRoot(root, rootPackage);
  if (validated.kind !== 'valid') {
    throw new Error(`The fixture is invalid: ${JSON.stringify(validated.failures)}`);
  }
  const snapshot = snapshotOf(validated);
  if (snapshot.kind !== 'service') {
    throw new Error('The fixture is no Service');
  }
  const exportedSnapshot = exportedSnapshotOf(snapshot);
  const standardRejections = providedStandardRejections({
    invalidInput: { code: 'BAD_REQUEST', status: 422, message: 'The request is invalid' },
  });
  const name = 'payments-service';
  const provided = providedEndpointsOf(name, endpoints);
  return {
    name,
    endpoints: provided,
    events: {},
    standardRejections,
    exportedSnapshot,
  };
}

const payments = contractPackageOf({ getPayment, capturePayment, getSummary });

/** The Provider's Contract Package with an exported Snapshot of any shape, as a package built by another cf-loom might carry. */
type Carrying = Omit<typeof payments, 'exportedSnapshot'> & { readonly exportedSnapshot: unknown };

/** The Provider's Contract Package as another cf-loom wrote it: a `format` of its own and no entry a listed Endpoint could find. */
function inFormat(contractPackage: typeof payments, format: unknown): Carrying {
  const exportedSnapshot = { ...contractPackage.exportedSnapshot, format, endpoints: {} };
  return { ...contractPackage, exportedSnapshot };
}

/** The Provider's Contract Package with the entry of one of its Endpoints without `field`. */
function withoutField(contractPackage: typeof payments, identity: string, field: string): Carrying {
  const exportedSnapshot = structuredClone(contractPackage.exportedSnapshot);
  const entry: Record<string, unknown> | undefined = Reflect.get(
    exportedSnapshot.endpoints,
    identity,
  );
  if (entry === undefined) {
    throw new Error(`The fixture has no ${identity}`);
  }
  delete entry[field];
  return { ...contractPackage, exportedSnapshot };
}

/** The Provider's Contract Package with `entry` under `key` of its exported Snapshot's `map`. */
function withKey(map: 'endpoints' | 'shadowing', key: string, entry: unknown): Carrying {
  const exportedSnapshot = structuredClone(payments.exportedSnapshot);
  Reflect.set(exportedSnapshot[map], key, entry);
  return { ...payments, exportedSnapshot };
}

const paymentsDependency = defineDependency({
  provider: payments,
  endpoints: [payments.endpoints.getPayment, payments.endpoints.capturePayment],
});

const at = 'https://payments-service.test';

/** A fake whose every listed Endpoint counts the steps it took. */
function countingFake(options: { readonly baseUrl?: string } = {}) {
  const fake = fakeProvider(paymentsDependency, options);
  const taken = { getPayment: 0, capturePayment: 0 };
  fake.on('getPayment').otherwise((builder, { params }) => {
    taken.getPayment += 1;
    return builder.success({ id: params.paymentId });
  });
  fake.on('capturePayment').otherwise((builder, { params, body }) => {
    taken.capturePayment += 1;
    return builder.success({ id: params.paymentId, amount: body.amount });
  });
  return { fake, taken };
}

/** A fake of `getPayment` whose Provider also declares `latest`, which its Contract Package does not export. */
function fakeBesides(latest: Endpoint) {
  const declared = [getPayment, capturePayment, getSummary, latest];
  const provider = contractPackageOf({ getPayment, capturePayment, getSummary }, declared);
  const dependency = defineDependency({ provider, endpoints: [provider.endpoints.getPayment] });
  const fake = fakeProvider(dependency);
  const taken = { getPayment: 0 };
  fake.on('getPayment').otherwise((builder, { params }) => {
    taken.getPayment += 1;
    return builder.success({ id: params.paymentId });
  });
  return { fake, taken };
}

/**
 * A fake over a Provider that exports `GET /p/:x/b` and also declares a Retired `GET /p/a/:y`,
 * which `shadowing` lists, and a live Private `GET /p/a/c`, which it does not.
 */
function fakeOverPaths() {
  const base = { method: 'GET', description: 'An Endpoint', success: { status: 204 } } as const;
  const first = defineEndpoint({
    ...base,
    name: 'getFirst',
    path: '/p/:x/b',
    visibility: 'internal',
    input: { params: z.object({ x: z.string() }) },
  });
  const retired = defineEndpoint({
    ...base,
    name: 'getRetired',
    path: '/p/a/:y',
    visibility: 'internal',
    lifecycle: 'retired',
    input: { params: z.object({ y: z.string() }) },
  });
  const hidden = defineEndpoint({
    ...base,
    name: 'getHidden',
    path: '/p/a/c',
    visibility: 'private',
  });
  const provider = contractPackageOf({ getFirst: first }, [first, retired, hidden]);
  const dependency = defineDependency({ provider, endpoints: [provider.endpoints.getFirst] });
  const fake = fakeProvider(dependency);
  const taken = { getFirst: 0 };
  fake.on('getFirst').otherwise((builder) => {
    taken.getFirst += 1;
    return builder.success();
  });
  return { fake, taken };
}

function captureInit(body: string, contentType = 'application/json'): RequestInit {
  return { method: 'POST', headers: { 'content-type': contentType }, body };
}

const tagPayment = defineEndpoint({
  name: 'tagPayment',
  method: 'POST',
  path: '/payments/:paymentId/tags',
  visibility: 'internal',
  description: 'Tags a payment',
  input: {
    params: z.object({ paymentId: z.string() }),
    query: z.object({ expand: z.array(z.string()) }),
    headers: z.object({ 'x-trace': z.string() }),
    body: z.object({ labels: z.array(z.string()), detail: z.object({ note: z.string() }) }),
  },
  success: { status: 204 },
});

const taggingDependencyPackage = contractPackageOf({ tagPayment });
const taggingDependency = defineDependency({
  provider: taggingDependencyPackage,
  endpoints: [taggingDependencyPackage.endpoints.tagPayment],
});

/** The Input of a tagPayment call, as a test that wrote to it would see it. */
type Tagged = {
  params: { paymentId: string };
  query: { expand: string[] };
  headers: { 'x-trace': string };
  body: { labels: string[]; detail: { note: string } };
};

/** An invalid call, as a test that wrote to it would see it. */
type Invalid = {
  issues: { in: string; path: (string | number)[]; code: string; message: string }[];
};

/** A fake of tagPayment that took one request, and the call it recorded. */
async function taggedOnce() {
  const fake = fakeProvider(taggingDependency);
  fake.on('tagPayment').otherwise((builder) => builder.success());
  const init = captureInit('{"labels":["a"],"detail":{"note":"n"}}');
  const headers = { ...init.headers, 'x-trace': 't-1' };
  await fake.fetch(new Request(`${at}/payments/pay-1/tags?expand=x`, { ...init, headers }));
  return fake.calls('tagPayment')[0] as unknown as Tagged;
}

describe('fakeProvider: requests', () => {
  test('a param that breaks its schema answers the invalid-input Rejection, takes no step and is recorded', async () => {
    const { fake, taken } = countingFake();

    const response = await fake.fetch(
      new Request(`${at}/payments/ab`, { headers: { 'x-api-key': 'k' } }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      rejection: {
        code: 'BAD_REQUEST',
        message: 'The request is invalid',
        body: {
          issues: [
            { in: 'params', path: ['paymentId'], code: 'too_small', message: expect.any(String) },
          ],
        },
      },
    });
    expect(taken.getPayment).toBe(0);
    expect(fake.invalidCalls('getPayment')).toEqual([
      {
        issues: [
          { in: 'params', path: ['paymentId'], code: 'too_small', message: expect.any(String) },
        ],
      },
    ]);
  });

  test('a missing demanded header answers alone, before the Input is read', async () => {
    const { fake } = countingFake();

    const response = await fake.fetch(new Request(`${at}/payments/ab`));

    expect(await response.json()).toMatchObject({
      rejection: { body: { issues: [{ in: 'headers', path: ['x-api-key'], code: 'required' }] } },
    });
  });

  test.each([
    [
      'a wrong content type',
      captureInit('{"amount":1}', 'text/plain'),
      'The content type is not application/json',
    ],
    ['a body that is no JSON', captureInit('{'), 'The body is not JSON'],
  ])('%s answers malformed alone', async (_name, init, message) => {
    const { fake, taken } = countingFake();

    const response = await fake.fetch(new Request(`${at}/payments/ab/capture`, init));

    expect(await response.json()).toMatchObject({
      rejection: { body: { issues: [{ in: 'body', path: [], code: 'malformed', message }] } },
    });
    expect(taken.capturePayment).toBe(0);
  });

  test('a valid request reaches its step with its Input parsed, unknown keys stripped', async () => {
    const fake = fakeProvider(paymentsDependency);
    const inputs: unknown[] = [];
    fake.on('capturePayment').otherwise((builder, input) => {
      inputs.push(input);
      return builder.success({ id: input.params.paymentId, amount: input.body.amount });
    });

    await fake.fetch(
      new Request(`${at}/payments/pay-1/capture`, captureInit('{"amount":5,"note":"x"}')),
    );

    expect(inputs).toEqual([{ params: { paymentId: 'pay-1' }, body: { amount: 5 } }]);
    expect(fake.calls('capturePayment')).toEqual([inputs[0]]);
  });

  test('a step that writes to its Input leaves the recorded call as received', async () => {
    const fake = fakeProvider(paymentsDependency);
    fake.on('capturePayment').otherwise((builder, input) => {
      input.params.paymentId = 'rewritten';
      input.body.amount = 999;
      return builder.success({ id: input.params.paymentId, amount: input.body.amount });
    });

    await fake.fetch(new Request(`${at}/payments/pay-1/capture`, captureInit('{"amount":5}')));

    expect(fake.calls('capturePayment')).toEqual([
      { params: { paymentId: 'pay-1' }, body: { amount: 5 } },
    ]);
  });

  test('text parts are converted by their nodes, a repeated query key as a list', async () => {
    const fake = fakeProvider(paymentsDependency);
    fake.on('getPayment').otherwise((r, { params }) => r.success({ id: params.paymentId }));

    await fake.fetch(
      new Request(`${at}/payments/pay-1?expand=a&expand=b`, { headers: { 'x-api-key': 'k' } }),
    );

    expect(fake.calls('getPayment')).toEqual([
      {
        params: { paymentId: 'pay-1' },
        query: { expand: ['a', 'b'] },
        headers: { 'x-api-key': 'k' },
      },
    ]);
  });

  test('calls lists only the requests read as valid, each its parsed Input, in arrival order', async () => {
    const { fake } = countingFake();
    const headers = { 'x-api-key': 'k' };

    await fake.fetch(new Request(`${at}/payments/pay-1`, { headers }));
    await fake.fetch(new Request(`${at}/payments/ab`, { headers }));
    await fake.fetch(new Request(`${at}/payments/pay-2`, { headers }));

    expect(fake.calls('getPayment')).toEqual([
      { params: { paymentId: 'pay-1' }, query: {}, headers },
      { params: { paymentId: 'pay-2' }, query: {}, headers },
    ]);
  });

  test('invalidCalls lists the Issues of each request answered with invalid input, in arrival order', async () => {
    const { fake } = countingFake();
    const headers = { 'x-api-key': 'k' };

    await fake.fetch(new Request(`${at}/payments/ab`, { headers }));
    await fake.fetch(new Request(`${at}/payments/pay-1`, { headers }));
    await fake.fetch(new Request(`${at}/payments/pay-2`));

    const issueOf = (where: string, path: string, code: string) => ({
      in: where,
      path: [path],
      code,
      message: expect.any(String),
    });
    expect(fake.invalidCalls('getPayment')).toEqual([
      { issues: [issueOf('params', 'paymentId', 'too_small')] },
      { issues: [issueOf('headers', 'x-api-key', 'required')] },
    ]);
  });

  test('a Request is answered whole, with nothing given beside it', async () => {
    const { fake } = countingFake();
    const request = new Request(`${at}/payments/pay-1`, { headers: { 'x-api-key': 'k' } });

    const response = await fake.fetch(request);

    expect(await response.json()).toEqual({ id: 'pay-1' });
  });

  test('a request to another origin still reaches the fake', async () => {
    const { fake, taken } = countingFake();

    const response = await fake.fetch(
      new Request('http://elsewhere.example/payments/pay-1', {
        headers: { 'x-api-key': 'k' },
      }),
    );

    expect(response.status).toBe(200);
    expect(taken.getPayment).toBe(1);
  });

  test('a baseUrl’s path is a prefix its client calls under, and a path outside it is a mistake', async () => {
    const { fake } = countingFake({ baseUrl: 'https://gateway.test/payments-api/' });

    const outcome = await fake.client({ headers: { 'x-api-key': 'k' } }).getPayment({
      params: { paymentId: 'pay-1' },
    });
    const outside = fake.fetch(new Request('https://gateway.test/payments/pay-1'));

    expect(outcome).toEqual({ kind: 'success', status: 200, body: { id: 'pay-1' } });
    await expect(outside).rejects.toThrow(
      "payments-service: the path /payments/pay-1 is outside the base URL's path /payments-api/",
    );
  });

  test('an unlisted Endpoint whose literal beats a listed param is a mistake, not that param', async () => {
    const { fake, taken } = countingFake();

    const answering = fake.fetch(
      new Request(`${at}/payments/summary`, { headers: { 'x-api-key': 'k' } }),
    );

    await expect(answering).rejects.toThrow(FakeProviderError);
    await expect(answering).rejects.toThrow('does not list GET /payments/summary');
    expect(taken.getPayment).toBe(0);
  });

  test.each(['private', 'internal'] as const)(
    'a request a Retired %s Endpoint wins is answered RETIRED as serve answers it, and takes no step',
    async (visibility) => {
      const { fake, taken } = fakeBesides(latestPayment({ visibility, lifecycle: 'retired' }));

      const response = await fake.fetch(
        new Request(`${at}/payments/latest`, { headers: { 'x-api-key': 'k' } }),
      );

      const retired = reservedResponseOf('RETIRED');
      expect(response.status).toBe(retired.status);
      expect(response.headers.get('content-type')).toBe(retired.headers.get('content-type'));
      expect(await response.text()).toBe(await retired.text());
      expect(response.headers.has('deprecation')).toBe(false);
      expect(taken.getPayment).toBe(0);
    },
  );

  test.each([
    ['a live Private Endpoint takes', '/p/a/c'],
    ['only a Retired Endpoint shadowing lists would take', '/p/a/z'],
  ])(
    'a request no exported Endpoint matches, which %s, is the mistake of matching none',
    async (_, path) => {
      const { fake, taken } = fakeOverPaths();

      const answering = fake.fetch(new Request(`https://payments-service.test${path}`));

      await expect(answering).rejects.toThrow(FakeProviderError);
      await expect(answering).rejects.toThrow(
        `payments-service: no Endpoint it exports is GET ${path} under /`,
      );
      expect(taken.getFirst).toBe(0);
    },
  );

  test('a request an exported Endpoint matches and a shadowing Retired one wins is answered RETIRED', async () => {
    const { fake, taken } = fakeOverPaths();

    const response = await fake.fetch(new Request('https://payments-service.test/p/a/b'));

    const retired = reservedResponseOf('RETIRED');
    expect(response.status).toBe(retired.status);
    expect(await response.text()).toBe(await retired.text());
    expect(taken.getFirst).toBe(0);
  });

  test.each([
    ['Active', latestPayment({ visibility: 'private', lifecycle: 'active' })],
    ['Deprecated', deprecatedLatestPayment],
  ])(
    'a request a %s Private Endpoint wins is a mistake naming it, and takes no step',
    async (_, latest) => {
      const { fake, taken } = fakeBesides(latest);

      const answering = fake.fetch(
        new Request(`${at}/payments/latest`, { headers: { 'x-api-key': 'k' } }),
      );

      await expect(answering).rejects.toThrow(FakeProviderError);
      await expect(answering).rejects.toThrow(
        'payments-service: the Provider does not export GET /payments/latest, which GET /payments/latest reaches',
      );
      expect(taken.getPayment).toBe(0);
    },
  );

  test('a baseUrl with a query is a bug, refused when the fake is created', () => {
    const create = () =>
      fakeProvider(paymentsDependency, { baseUrl: 'https://gateway.test/api?x=1' });

    expect(create).toThrow('has a query or a fragment');
  });

  test('a baseUrl with a username or a password is a bug, refused when the fake is created', () => {
    const create = () =>
      fakeProvider(paymentsDependency, { baseUrl: 'https://ann:secret@gateway.test/' });

    expect(create).toThrow('has a username or a password');
  });

  test('a baseUrl that is no http or https URL is a bug, refused when the fake is created, without its credentials', () => {
    const create = () =>
      fakeProvider(paymentsDependency, { baseUrl: 'ftp://ann:secret@gateway.test/api?x=1' });

    expect(create).toThrow(new Error("The baseUrl's scheme ftp: is no http or https"));
  });

  test.each([
    {
      given: 'in a format the fake does not read',
      provider: inFormat(payments, 2),
      refusal:
        "payments-service's exported Snapshot is in format 2, newer than this cf-loom reads: upgrade the @cf-loom packages",
    },
    {
      given: 'with an Endpoint entry that lacks its name',
      provider: withoutField(payments, 'GET /payments/{}', 'name'),
      refusal:
        "payments-service's exported Snapshot is malformed: endpoints.GET /payments/{}.name is missing",
    },
    {
      given: 'with a shadowing key that is no Endpoint’s identity',
      provider: withKey('shadowing', 'garbage', { lifecycle: 'retired' }),
      refusal:
        "payments-service's exported Snapshot is malformed: shadowing.garbage is not an Endpoint’s identity: a method and a path with its params as {}",
    },
    {
      given: 'with an endpoints key that is no Endpoint’s identity',
      provider: withKey(
        'endpoints',
        'garbage',
        payments.exportedSnapshot.endpoints['GET /payments/{}'],
      ),
      refusal:
        "payments-service's exported Snapshot is malformed: endpoints.garbage is not an Endpoint’s identity: a method and a path with its params as {}",
    },
  ])(
    'a Contract Package $given is a bug, refused when the fake is created',
    ({ provider, refusal }) => {
      const refused = defineDependency({ provider, endpoints: [payments.endpoints.getPayment] });

      const create = () => fakeProvider(refused);

      expect(create).toThrow(refusal);
    },
  );

  test('a path that only begins like the base URL’s path lies outside it', async () => {
    const { fake } = countingFake({ baseUrl: 'https://gateway.test/api' });

    const answering = fake.fetch(new Request('https://gateway.test/apix/payments/pay-1'));

    await expect(answering).rejects.toThrow(
      "the path /apix/payments/pay-1 is outside the base URL's path /api/",
    );
  });

  test('a path that begins with an empty segment is matched as a path, never as a host', async () => {
    const { fake, taken } = countingFake();

    const answering = fake.fetch(
      new Request(`${at}//elsewhere/payments/pay-1`, {
        headers: { 'x-api-key': 'k' },
      }),
    );

    await expect(answering).rejects.toThrow(FakeProviderError);
    expect(taken.getPayment).toBe(0);
  });

  test('a signal already aborted rejects with its reason, recording no call and taking no step', async () => {
    const { fake, taken } = countingFake();
    const reason = new Error('Gave up');

    const answering = fake.fetch(
      new Request(`${at}/payments/pay-1`, {
        headers: { 'x-api-key': 'k' },
        signal: AbortSignal.abort(reason),
      }),
    );

    await expect(answering).rejects.toBe(reason);
    expect(fake.calls('getPayment')).toEqual([]);
    expect(taken.getPayment).toBe(0);
  });

  test('unknownRejection of the Provider’s not-found code answers it as declared, though no exported Endpoint lists it', async () => {
    const fake = fakeProvider(paymentsDependency);
    fake.on('getPayment').otherwise((r) => r.unknownRejection('NOT_FOUND'));

    const response = await fake.fetch(
      new Request(`${at}/payments/pay-1`, { headers: { 'x-api-key': 'k' } }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      rejection: { code: 'NOT_FOUND', message: 'Not found' },
    });
  });

  test.each([
    ['a param', (call: Tagged) => Object.assign(call.params, { paymentId: 'x' })],
    ['a query list that grows', (call: Tagged) => call.query.expand.push('y')],
    ['a query list item', (call: Tagged) => Object.assign(call.query.expand, ['y'])],
    ['a header', (call: Tagged) => Object.assign(call.headers, { 'x-trace': 'x' })],
    ['a body list', (call: Tagged) => Object.assign(call.body.labels, ['y'])],
    [
      'a nested object of the body',
      (call: Tagged) => Object.assign(call.body.detail, { note: 'y' }),
    ],
    ['the body', (call: Tagged) => Object.assign(call.body, { detail: {} })],
    ['the Input', (call: Tagged) => Object.assign(call, { params: {} })],
  ])('a write to %s of a recorded call throws', async (_part, write) => {
    const call = await taggedOnce();

    const writing = () => write(call);

    expect(writing).toThrow(TypeError);
  });

  test.each([
    ['the call', (call: Invalid) => Object.assign(call, { issues: [] })],
    [
      'its list of issues',
      (call: Invalid) => call.issues.push({ in: 'body', path: [], code: 'x', message: 'x' }),
    ],
    ['an issue', (call: Invalid) => Object.assign(call.issues[0] as object, { code: 'x' })],
    [
      'the path of an issue',
      (call: Invalid) => (call.issues[0] as Invalid['issues'][number]).path.push('x'),
    ],
  ])('%s of an invalid call cannot be written to', async (_part, write) => {
    const { fake } = countingFake();
    await fake.fetch(new Request(`${at}/payments/ab`, { headers: { 'x-api-key': 'k' } }));
    const [call] = fake.invalidCalls('getPayment') as unknown as Invalid[];

    const writing = () => write(call as Invalid);

    expect(writing).toThrow(TypeError);
  });

  test('calls and invalidCalls are frozen copies', async () => {
    const { fake } = countingFake();
    await fake.fetch(new Request(`${at}/payments/pay-1`, { headers: { 'x-api-key': 'k' } }));
    await fake.fetch(new Request(`${at}/payments/ab`, { headers: { 'x-api-key': 'k' } }));

    const calls = fake.calls('getPayment');
    const invalidCalls = fake.invalidCalls('getPayment');

    expect(Object.isFrozen(calls)).toBe(true);
    expect(Object.isFrozen(invalidCalls)).toBe(true);
    expect(fake.calls('getPayment')).not.toBe(calls);
    expect(fake.invalidCalls('getPayment')).not.toBe(invalidCalls);
  });

  test('a path no exported Endpoint matches is a mistake naming the path and the base URL', async () => {
    const { fake } = countingFake({ baseUrl: 'https://gateway.test/payments-api' });

    const answering = fake.fetch(new Request('https://gateway.test/payments-api/refunds/r-1'));

    await expect(answering).rejects.toThrow(
      'payments-service: no Endpoint it exports is GET /refunds/r-1 under /payments-api/',
    );
  });

  test('a method the exported path does not take is a mistake naming the path’s methods', async () => {
    const { fake } = countingFake({ baseUrl: 'https://gateway.test/payments-api' });

    const answering = fake.fetch(
      new Request('https://gateway.test/payments-api/payments/pay-1', {
        method: 'DELETE',
      }),
    );

    await expect(answering).rejects.toThrow(
      'payments-service: no Endpoint it exports is DELETE /payments/pay-1 under /payments-api/; that path takes GET',
    );
  });
});
