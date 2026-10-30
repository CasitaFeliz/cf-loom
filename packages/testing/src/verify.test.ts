import {
  defineDependency,
  defineEndpoint,
  defineGroup,
  defineService,
  type Endpoint,
  notFound,
} from '@cf-loom/contract';
import { snapshotOf, validateRoot } from '@cf-loom/contract/internal';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { lineBreakPattern, lineBreaks } from '../../contract/test/line-breaks.ts';
import { type Exportable, providedEndpointsOf } from '../test/provided.ts';
import { aRootPackage } from '../test/root-package.ts';
import { providedStandardRejections } from '../test/standard-rejections.ts';
import {
  type FakeProvider,
  FakeProviderError,
  fakeProvider,
  type Script,
  type ScriptedAnswer,
  type Step,
  type StepBuilder,
} from './index.ts';

const getPayment = defineEndpoint({
  name: 'getPayment',
  method: 'GET',
  path: '/payments/:paymentId',
  visibility: 'internal',
  description: 'One payment',
  input: { params: z.object({ paymentId: z.string().min(3) }) },
  success: { status: 200, body: z.object({ id: z.string() }) },
  rejections: [notFound],
});

const getSummary = defineEndpoint({
  name: 'getSummary',
  method: 'GET',
  path: '/payments/summary',
  visibility: 'internal',
  description: 'Every payment summed up',
  success: { status: 200, body: z.object({ total: z.int() }) },
});

/** The Provider's Contract Package, as `cf-loom package` writes it from its declarations. */
function contractPackageOf<const Endpoints extends Readonly<Record<string, Exportable>>>(
  endpoints: Endpoints,
) {
  const listed = Object.values(endpoints) as unknown as [Endpoint];
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
  const standardRejections = providedStandardRejections();
  const name = 'payments-service';
  const provided = providedEndpointsOf({ name, standardRejections }, endpoints, snapshot);
  return {
    name,
    endpoints: provided,
    events: {},
    standardRejections,
  };
}

const paymentsDependencyPackage = contractPackageOf({ getPayment, getSummary });
const paymentsDependency = defineDependency({
  endpoints: [
    paymentsDependencyPackage.endpoints.getPayment,
    paymentsDependencyPackage.endpoints.getSummary,
  ],
});

type Builder = StepBuilder<typeof paymentsDependency, 'getPayment'>;

const at = 'https://payments-service.test';

const paid = (r: Builder) => r.success({ id: 'pay-1' });

/** A request the fake reads as valid, and one it answers with the invalid-input Rejection. */
const requests = {
  getPayment: `${at}/payments/pay-1`,
  getSummary: `${at}/payments/summary`,
  invalid: `${at}/payments/ab`,
} as const;

/** What a request threw, as the code under test that catches everything would swallow it. */
async function caughtFrom(fetching: Promise<unknown>): Promise<unknown> {
  return await fetching.then(
    () => undefined,
    (e: unknown) => e,
  );
}

/** What `verify()` threw, or undefined when it returned. */
function verifiedBy(verify: () => void): unknown {
  try {
    verify();
  } catch (e) {
    return e;
  }
  return undefined;
}

/** The errors `verify()` threw: none, the one, or those an AggregateError holds. */
function errorsOf(thrown: unknown): readonly Error[] {
  if (thrown instanceof AggregateError) {
    return thrown.errors as readonly Error[];
  }
  return thrown instanceof Error ? [thrown] : [];
}

/** The first line of each error `verify()` threw. */
function linesOf(thrown: unknown): readonly string[] {
  return errorsOf(thrown).map((error) => error.message.split('\n')[0] ?? '');
}

describe('fake.verify()', () => {
  test('returns when every request was scripted and every once step was taken', async () => {
    const payments = fakeProvider(paymentsDependency);
    payments.on('getPayment').once(paid).otherwise(paid);
    await payments.fetch(new Request(requests.getPayment));

    expect(() => payments.verify()).not.toThrow();
  });

  test('returns for a fake nothing was scripted on and nothing asked of', () => {
    const payments = fakeProvider(paymentsDependency);

    expect(() => payments.verify()).not.toThrow();
  });

  test('throws the mistake the code under test caught', async () => {
    const payments = fakeProvider(paymentsDependency);
    const caught = await caughtFrom(payments.fetch(new Request(requests.getPayment)));

    const thrown = verifiedBy(() => payments.verify());

    expect(caught).toBeInstanceOf(FakeProviderError);
    expect(thrown).toBe(caught);
    expect(linesOf(thrown)).toEqual([
      "payments-service: getPayment: it was never scripted: on('getPayment') gives it steps",
    ]);
  });

  test.each([
    [1, 'payments-service: getPayment: 1 once step left unused'],
    [2, 'payments-service: getPayment: 2 once steps left unused'],
  ])(
    'throws when %i once step(s) were left unused, naming the Endpoint and the count',
    (steps, line) => {
      const payments = fakeProvider(paymentsDependency);
      const script = payments.on('getPayment');
      for (let step = 0; step < steps; step += 1) {
        script.once(paid);
      }

      const thrown = verifiedBy(() => payments.verify());

      expect(thrown).toBeInstanceOf(FakeProviderError);
      expect(linesOf(thrown)).toEqual([line]);
    },
  );

  test('throws an AggregateError of every mistake and every unused step, one line each', async () => {
    const payments = fakeProvider(paymentsDependency);
    payments.on('getPayment').once(paid).once(paid);
    payments.on('getSummary').once((r) => r.success({ total: 1 }));
    await payments.fetch(new Request(requests.getPayment));
    await caughtFrom(payments.fetch(new Request(`${at}/payments`)));

    const thrown = verifiedBy(() => payments.verify());

    expect(thrown).toBeInstanceOf(AggregateError);
    expect(thrown).toMatchObject({
      message: [
        '3 mistakes:',
        'payments-service: no Endpoint the Dependency lists is GET /payments under /',
        'payments-service: getPayment: 1 once step left unused',
        'payments-service: getSummary: 1 once step left unused',
      ].join('\n'),
    });
  });

  test('an AggregateError summarises each mistake by its first line, though one lists Issues', async () => {
    const payments = fakeProvider(paymentsDependency);
    payments.on('getPayment').otherwise((r) => r.success({ id: 1 } as never));
    payments.on('getSummary').once((r) => r.success({ total: 1 }));
    const broken = await caughtFrom(payments.fetch(new Request(requests.getPayment)));

    const thrown = verifiedBy(() => payments.verify());

    expect(String((broken as Error).message).split('\n').length).toBeGreaterThan(1);
    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as Error).message).toBe(
      [
        '2 mistakes:',
        'payments-service: getPayment: the scripted Success breaks its readers',
        'payments-service: getSummary: 1 once step left unused',
      ].join('\n'),
    );
  });

  test.for(lineBreaks)(
    'an AggregateError of two mistakes naming a code holding %s is a count line and one line each',
    async ([, code, visible]) => {
      const scripted = `A${String.fromCharCode(code)}B`;
      const payments = fakeProvider(paymentsDependency);
      payments.on('getPayment').otherwise((r) => r.unknownRejection(scripted));
      payments.on('getSummary').otherwise((r) => r.unknownRejection(scripted));
      await caughtFrom(payments.fetch(new Request(requests.getPayment)));
      await caughtFrom(payments.fetch(new Request(requests.getSummary)));

      const thrown = verifiedBy(() => payments.verify());

      const refused = `A${visible}B is no UPPER_SNAKE_CASE of at most 64 characters, so no Contract can declare it`;
      expect((thrown as Error).message.split(lineBreakPattern)).toEqual([
        '2 mistakes:',
        `payments-service: getPayment: ${refused}`,
        `payments-service: getSummary: ${refused}`,
      ]);
      expect(errorsOf(thrown).map((error) => error.message.split(lineBreakPattern))).toEqual([
        [`payments-service: getPayment: ${refused}`],
        [`payments-service: getSummary: ${refused}`],
      ]);
    },
  );

  test('reports everything again on a second call, forgetting nothing', async () => {
    const payments = fakeProvider(paymentsDependency);
    await caughtFrom(payments.fetch(new Request(requests.getPayment)));

    const first = verifiedBy(() => payments.verify());
    const second = verifiedBy(() => payments.verify());

    expect(second).toBe(first);
    expect(second).toBeInstanceOf(FakeProviderError);
  });

  test('reports a once step added after a mistake, and no longer the one a request took', async () => {
    const payments = fakeProvider(paymentsDependency);
    await caughtFrom(payments.fetch(new Request(requests.getPayment)));
    payments.on('getPayment').once(paid);

    const before = linesOf(verifiedBy(() => payments.verify()));
    await payments.fetch(new Request(requests.getPayment));
    const after = linesOf(verifiedBy(() => payments.verify()));

    expect(before).toHaveLength(2);
    expect(after).toEqual([
      "payments-service: getPayment: it was never scripted: on('getPayment') gives it steps",
    ]);
  });

  test('a request answered as invalid input takes no step and counts as none', async () => {
    const payments = fakeProvider(paymentsDependency);
    payments.on('getPayment').once(paid);
    const invalid = await payments.fetch(new Request(requests.invalid));

    const thrown = verifiedBy(() => payments.verify());

    expect(invalid.status).toBe(400);
    expect(linesOf(thrown)).toEqual(['payments-service: getPayment: 1 once step left unused']);
  });

  test('a mistake a step makes after the Caller aborted its request is still reported', async () => {
    const payments = fakeProvider(paymentsDependency);
    const started = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    payments.on('getPayment').otherwise(async () => {
      started.resolve();
      await released.promise;
      throw new Error('A step broke');
    });
    const controller = new AbortController();
    const answering = caughtFrom(
      payments.fetch(new Request(requests.getPayment, { signal: controller.signal })),
    );
    await started.promise;

    controller.abort();
    const caught = await answering;
    released.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(caught).not.toBeInstanceOf(FakeProviderError);
    expect(linesOf(verifiedBy(() => payments.verify()))).toEqual([
      'payments-service: getPayment: a step threw',
    ]);
  });

  test('a request aborted before it took its step leaves its once step unused', async () => {
    const payments = fakeProvider(paymentsDependency);
    payments.on('getPayment').once(paid);
    const aborted = new Request(requests.getPayment, { signal: AbortSignal.abort() });

    const caught = await caughtFrom(payments.fetch(aborted));

    expect(caught).not.toBeInstanceOf(FakeProviderError);
    expect(linesOf(verifiedBy(() => payments.verify()))).toEqual([
      'payments-service: getPayment: 1 once step left unused',
    ]);
  });
});

/** A seeded generator of the same sequence every run, so a failing draw can be replayed. */
function seededNext(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

type Dependency = typeof paymentsDependency;

/** How many once steps an Endpoint is scripted with, its valid and invalid requests, and whether an otherwise answers the rest. */
type Plan = {
  readonly onces: number;
  readonly valid: number;
  readonly invalid: number;
  readonly hasOtherwise: boolean;
};

function planned(next: () => number): Plan {
  const draw = (below: number) => Math.floor(next() * below);
  return { onces: draw(6), valid: draw(8), invalid: draw(3), hasOtherwise: next() < 0.5 };
}

function scripted<Name extends 'getPayment' | 'getSummary'>(
  script: Script<Dependency, Name>,
  step: Step<Dependency, Name>,
  { onces, hasOtherwise }: Plan,
): void {
  for (let once = 0; once < onces; once += 1) {
    script.once(step);
  }
  if (hasOtherwise) {
    script.otherwise(step);
  }
}

/** The requests of a plan: its valid ones, then its invalid ones, to the Endpoint's path. */
function urlsOf(valid: string, { valid: validCount, invalid }: Plan): readonly string[] {
  const urls = Array.from({ length: validCount }, () => valid);
  return [...urls, ...Array.from({ length: invalid }, () => requests.invalid)];
}

describe('fake.verify(): the once steps no request took', () => {
  test('reports exactly max(n - m, 0) unused per Endpoint, and a mistake per request past n without an otherwise', async () => {
    const next = seededNext(220);
    for (let round = 0; round < 80; round += 1) {
      const payments = fakeProvider(paymentsDependency);
      const paymentPlan = planned(next);
      const summaryPlan = { ...planned(next), invalid: 0 };
      scripted(payments.on('getPayment'), paid, paymentPlan);
      scripted(payments.on('getSummary'), (r) => r.success({ total: 1 }), summaryPlan);
      const plans = { getPayment: paymentPlan, getSummary: summaryPlan };
      for (const url of [
        ...urlsOf(requests.getPayment, paymentPlan),
        ...urlsOf(requests.getSummary, summaryPlan),
      ]) {
        await caughtFrom(payments.fetch(new Request(url)));
      }

      const thrown = verifiedBy(() => payments.verify());

      const lines = linesOf(thrown);
      const unused = Object.entries(plans).flatMap(([name, { onces, valid }]) => {
        const count = Math.max(onces - valid, 0);
        const noun = count === 1 ? 'step' : 'steps';
        return count > 0 ? [`payments-service: ${name}: ${count} once ${noun} left unused`] : [];
      });
      let mistakes = unused.length;
      for (const { onces, valid, hasOtherwise } of Object.values(plans)) {
        mistakes += hasOtherwise ? 0 : Math.max(valid - onces, 0);
      }
      expect(lines.filter((line) => line.endsWith('left unused'))).toEqual(unused);
      expect(lines).toHaveLength(mistakes);
    }
  });
});

/** Each kind of mistake the README lists: how a test makes it, and the requests that meet it. */
const mistakeKinds: readonly {
  readonly kind: string;
  readonly script: (payments: FakeProvider<Dependency>) => void;
  readonly requests: readonly string[];
}[] = [
  { kind: 'an Endpoint never scripted', script: () => undefined, requests: [requests.getPayment] },
  {
    kind: 'no step left and no otherwise',
    script: (payments) => void payments.on('getPayment').once(paid),
    requests: [requests.getPayment, requests.getPayment],
  },
  {
    kind: 'a scripted value that breaks a reader',
    script: (payments) =>
      void payments.on('getPayment').otherwise((r) => r.success({ id: 1 } as never)),
    requests: [requests.getPayment],
  },
  {
    kind: 'a code the Endpoint does not answer',
    script: (payments) =>
      void payments.on('getPayment').otherwise((r) => r.reject('LOST' as never)),
    requests: [requests.getPayment],
  },
  {
    kind: 'a body for a code that declares none',
    script: (payments) =>
      void payments
        .on('getPayment')
        .otherwise((r) => r.reject(...(['NOT_FOUND', { x: 1 }] as never))),
    requests: [requests.getPayment],
  },
  {
    kind: 'a step that throws',
    script: (payments) =>
      void payments.on('getPayment').otherwise(() => {
        throw new Error('A step broke');
      }),
    requests: [requests.getPayment],
  },
  {
    kind: 'a step that returns no answer',
    script: (payments) => void payments.on('getPayment').otherwise(() => ({}) as ScriptedAnswer),
    requests: [requests.getPayment],
  },
  { kind: 'a path no Endpoint matches', script: () => undefined, requests: [`${at}/nowhere`] },
  {
    kind: 'a bad r.status',
    script: (payments) => void payments.on('getPayment').otherwise((r) => r.status(200)),
    requests: [requests.getPayment],
  },
  {
    kind: 'a bad r.fault',
    script: (payments) =>
      void payments
        .on('getPayment')
        .otherwise((r) => r.fault({ committed: 'maybe', retryable: true } as never)),
    requests: [requests.getPayment],
  },
];

describe('fake.verify(): every mistake fetch threw', () => {
  test.each(mistakeKinds)(
    '$kind, caught by the test, is the error verify() throws',
    async (mistake) => {
      const payments = fakeProvider(paymentsDependency);
      mistake.script(payments);
      const caught: unknown[] = [];

      for (const url of mistake.requests) {
        caught.push(await caughtFrom(payments.fetch(new Request(url))));
      }

      const mistakes = caught.filter((error) => error instanceof FakeProviderError);
      expect(mistakes).toHaveLength(1);
      expect(verifiedBy(() => payments.verify())).toBe(mistakes[0]);
    },
  );
});
