import {
  defineCommand,
  defineEvent,
  defineGroup,
  defineService,
  defineSubscription,
  openEnum,
  providedEvent,
} from '@cf-loom/contract';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  type Broker,
  InvalidMessageError,
  MessageNotSentError,
  MessagingClosedError,
  messaging,
  type OutgoingMessage,
} from './index.ts';
import { memory } from './memory/index.ts';

const ORDER_ID = '7f1c3a52-1b2c-4d3e-8f4a-5b6c7d8e9f00';

const statuses = ['pending', 'paid'] as const;

const orderCreatedV1 = defineEvent({
  name: 'OrderCreated',
  version: 1,
  visibility: 'internal',
  lifecycle: 'retired',
  description: 'An order was created',
  body: z.object({ orderId: z.uuid() }),
});

const orderCreatedV2 = defineEvent({
  name: 'OrderCreated',
  version: 2,
  visibility: 'internal',
  lifecycle: 'deprecated',
  description: 'An order was created, with its total',
  body: z.object({ orderId: z.uuid(), total: z.number().min(0) }),
});

const orderCreatedV3 = defineEvent({
  name: 'OrderCreated',
  version: 3,
  visibility: 'internal',
  description: 'An order was created, with its total and status',
  body: z.object({
    orderId: z.uuid(),
    total: z.object({ amount: z.number().min(0), currency: z.string() }),
    status: openEnum(statuses),
  }),
});

const chargeCardV1 = defineCommand({
  name: 'ChargeCard',
  version: 1,
  lifecycle: 'deprecated',
  description: 'Charges the order’s card',
  body: z.object({ orderId: z.uuid() }),
});

const chargeCardV2 = defineCommand({
  name: 'ChargeCard',
  version: 2,
  description: 'Charges the order’s card, for an amount',
  body: z.object({ orderId: z.uuid(), amount: z.number().min(0) }),
});

const grownV9 = defineEvent({
  name: 'Grown',
  version: 9,
  visibility: 'internal',
  lifecycle: 'deprecated',
  description: 'A tree grew',
  body: z.object({ treeId: z.string() }),
});

const grownV10 = defineEvent({
  name: 'Grown',
  version: 10,
  visibility: 'internal',
  description: 'A tree grew, ten times over',
  body: z.object({ treeId: z.string() }),
});

const contract = defineService({
  name: 'orders-service',
  groups: [
    defineGroup({
      name: 'orders',
      description: 'Orders',
      events: [orderCreatedV1, orderCreatedV2, grownV9, grownV10],
      commands: [chargeCardV1],
    }),
    defineGroup({
      name: 'payments',
      description: 'Payments',
      events: [orderCreatedV3],
      commands: [chargeCardV2],
    }),
  ],
});

const sizedBody = z.object({ note: z.string() });

/** An Event of three versions whose message ids take as many bytes each, so only their bodies order them by size. */
const sizedService = defineService({
  name: 'sized-service',
  groups: [
    defineGroup({
      name: 'sized',
      description: 'Sized',
      events: [
        defineEvent({
          name: 'Sized',
          version: 2,
          visibility: 'internal',
          lifecycle: 'deprecated',
          description: 'Sized, the first',
          body: sizedBody,
        }),
        defineEvent({
          name: 'Sized',
          version: 3,
          visibility: 'internal',
          lifecycle: 'deprecated',
          description: 'Sized, the second',
          body: sizedBody,
        }),
        defineEvent({
          name: 'Sized',
          version: 4,
          visibility: 'internal',
          description: 'Sized, the third',
          body: sizedBody,
        }),
      ],
    }),
  ],
});

const v2 = { orderId: ORDER_ID, total: 12 };

const v3 = {
  orderId: ORDER_ID,
  total: { amount: 12, currency: 'EUR' },
  status: 'paid',
} as const;

const charge = { orderId: ORDER_ID, amount: 12 };

const tree = { treeId: 't-1' };

/** A broker that records what messaging publishes, failing the publish numbered `failingAt`. */
function aBroker(failingAt?: number) {
  const published: OutgoingMessage[] = [];
  const error = new Error('broker down');
  let publishes = 0;
  const broker: Broker = {
    connect: async () => ({
      publish: async (message) => {
        publishes += 1;
        if (publishes === failingAt) {
          throw error;
        }
        published.push(message);
        return { duplicate: false };
      },
      consume: async () => undefined,
      close: async () => undefined,
    }),
  };
  return { broker, published, error };
}

/** A broker that records what messaging publishes, refusing each Message whose body takes more than `limit` bytes. */
function aBrokerRefusingOver(limit: number) {
  const published: OutgoingMessage[] = [];
  const broker: Broker = {
    connect: async () => ({
      publish: async (message) => {
        if (message.body.byteLength > limit) {
          throw new Error('message size exceeds maximum allowed');
        }
        published.push(message);
        return { duplicate: false };
      },
      consume: async () => undefined,
      close: async () => undefined,
    }),
  };
  return { broker, published };
}

async function opened(failingAt?: number) {
  const recording = aBroker(failingAt);
  const { publisher, sender, close } = await messaging(contract, recording.broker);
  return { ...recording, publisher, sender, close };
}

/** A messaging over memory(), which reports a broker message id it already took as a duplicate. */
async function overMemory() {
  const broker = memory();
  const { publisher, sender } = await messaging(contract, broker);
  return { broker, publisher, sender };
}

const fact = { factId: 'o-1' };

const factIdRule =
  'A Fact id is a non-empty string with no CR or LF, no whitespace leading or trailing and no lone surrogate';

function decoded(message: OutgoingMessage | undefined): unknown {
  return JSON.parse(new TextDecoder().decode(message?.body));
}

async function rejectionOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => undefined,
    (e: unknown) => e,
  );
}

describe('publisher.publish', () => {
  test('publish sends one Message per Active and Deprecated version on <service>.event.<Name>.v<n> whatever Group lists each version', async () => {
    const { publisher, published } = await opened();

    await publisher.publish('OrderCreated', { v2, v3 }, fact);

    expect(published.map((message) => message.subject).toSorted()).toEqual([
      'orders-service.event.OrderCreated.v2',
      'orders-service.event.OrderCreated.v3',
    ]);
  });

  test('publish sends the largest Message of a call first, versions of the same size in version order', async () => {
    const { broker, published } = aBroker();
    const { publisher } = await messaging(sizedService, broker);
    const bodies = { v2: { note: 'a' }, v3: { note: 'abcdef' }, v4: { note: 'b' } };

    await publisher.publish('Sized', bodies, fact);

    expect(published.map((message) => message.subject)).toEqual([
      'sized-service.event.Sized.v3',
      'sized-service.event.Sized.v2',
      'sized-service.event.Sized.v4',
    ]);
  });

  test('a Broker that refuses each Message over a limit takes every version of a call or none, the largest first (seed 327)', async () => {
    const next = seededNext(327);
    for (let round = 0; round < 200; round += 1) {
      const total = Number('1'.repeat(1 + Math.floor(next() * 15)));
      const currency = 'c'.repeat(Math.floor(next() * 60));
      const bodies = {
        v2: { orderId: ORDER_ID, total },
        v3: { ...v3, total: { amount: 1, currency } },
      };
      const limit = 60 + Math.floor(next() * 140);
      const { broker, published } = aBrokerRefusingOver(limit);
      const { publisher } = await messaging(contract, broker);

      const refused = await rejectionOf(publisher.publish('OrderCreated', bodies, fact));

      const sizes = published.map((message) => message.body.byteLength);
      const sent = refused instanceof MessageNotSentError ? refused.sent : undefined;
      const wholeOrNone = [
        { published: 2, sent: undefined },
        { published: 0, sent: [] },
      ];
      expect(wholeOrNone).toContainEqual({ published: published.length, sent });
      expect(sizes).toEqual(sizes.toSorted((left, right) => right - left));
    }
  });

  test('a Retired version is never sent, even given a body', async () => {
    const { publisher, published } = await opened();

    await publisher.publish('OrderCreated', { v1: { orderId: ORDER_ID }, v2, v3 } as never, fact);

    expect(published.map((message) => message.subject)).not.toContain(
      'orders-service.event.OrderCreated.v1',
    );
  });

  test('each body leaves as the UTF-8 JSON of the parsed body, unknown keys stripped', async () => {
    const { publisher, published } = await opened();
    const withExtra = { ...v2, extra: 'dropped' };

    await publisher.publish('OrderCreated', { v2: withExtra, v3 }, fact);

    expect(published.map(decoded)).toEqual([v3, v2]);
  });

  test('the Fact id given is the Fact id every Message of the call is sent with', async () => {
    const { publisher, published } = await opened();

    await publisher.publish('OrderCreated', { v2, v3 }, { factId: 'o-1:created' });

    expect(published.map((message) => message.factId)).toEqual(['o-1:created', 'o-1:created']);
  });

  test('each broker message id is event.<Name>.v<n>:<factId>', async () => {
    const { publisher, published } = await opened();

    await publisher.publish('OrderCreated', { v2, v3 }, { factId: 'o-1:created' });

    expect(published.map((message) => message.messageId)).toEqual([
      'event.OrderCreated.v3:o-1:created',
      'event.OrderCreated.v2:o-1:created',
    ]);
  });

  test('publish resolves to its Fact id and no duplicates the first time', async () => {
    const { publisher } = await overMemory();

    const result = await publisher.publish('OrderCreated', { v2, v3 }, { factId: 'o-1:created' });

    expect(result).toEqual({ factId: 'o-1:created', duplicates: [] });
  });

  test('publishing again with the same Fact id resolves to every version as a duplicate, and records none twice', async () => {
    const { broker, publisher } = await overMemory();
    await publisher.publish('OrderCreated', { v2, v3 }, { factId: 'o-1:created' });

    const again = await publisher.publish('OrderCreated', { v2, v3 }, { factId: 'o-1:created' });

    expect(again).toEqual({
      factId: 'o-1:created',
      duplicates: ['OrderCreated@3', 'OrderCreated@2'],
    });
    expect(broker.messages).toHaveLength(2);
  });

  test('transport headers reach the broker as given', async () => {
    const { publisher, published } = await opened();
    const headers = { traceparent: '00-abc-def-01' };

    await publisher.publish('OrderCreated', { v2, v3 }, { ...fact, headers });

    expect(published.map((message) => message.headers)).toEqual([headers, headers]);
  });

  test('an undefined header is left out of the Message', async () => {
    const { publisher, published } = await opened();
    const headers = { traceparent: '00-abc-def-01', tracestate: undefined };

    await publisher.publish('OrderCreated', { v2, v3 }, { ...fact, headers });

    expect(published.map((message) => message.headers)).toEqual([
      { traceparent: '00-abc-def-01' },
      { traceparent: '00-abc-def-01' },
    ]);
  });

  test('a Fact id and transport headers that travel unchanged reach the broker exactly as given', async () => {
    const { publisher, published } = await opened();
    const headers = {
      'x-note': 'café  con\tleche',
      'x-empty': '',
      'x-ctl': 'a\u0001b',
      'x-text': '日本 🎉',
      traceparent: 'A',
      // biome-ignore lint/style/useNamingConvention: a header name that differs from the one above only in case
      Traceparent: 'B',
    };

    await publisher.publish('OrderCreated', { v2, v3 }, { factId: 'pedido ñ\t1', headers });

    expect(published.map(({ factId, headers: sent }) => ({ factId, headers: sent }))).toEqual([
      { factId: 'pedido ñ\t1', headers },
      { factId: 'pedido ñ\t1', headers },
    ]);
  });

  test.each([
    'Nats-Msg-Id',
    'Cf-Loom-Fact-Id',
    'nats-msg-id',
    'CF-LOOM-FACT-ID',
    'Nats-TTL',
    'nats-expected-stream',
    'Cf-Loom-Tenant',
  ])(
    'a header named %s rejects with InvalidMessageError naming headers.<name>, and nothing is sent',
    async (name) => {
      const { publisher, published } = await opened();
      const headers = { [name]: 'x' };

      const error = await rejectionOf(
        publisher.publish('OrderCreated', { v2, v3 }, { ...fact, headers }),
      );

      expect(error).toBeInstanceOf(InvalidMessageError);
      expect(error).toMatchObject({
        message: `headers.${name}: The transport header ${name} takes a name cf-loom or NATS reserves: any starting with Cf-Loom- or Nats-`,
        invalid: [{ kind: 'header', name, fit: 'reserved-name' }],
      });
      expect(published).toEqual([]);
    },
  );

  test.each([
    ['trace id', '"trace id"'],
    ['a:b', '"a:b"'],
    ['café', '"café"'],
    ['', '""'],
  ])(
    'a header whose name is %j cannot travel over NATS: it rejects with InvalidMessageError naming headers.<name>, and nothing is sent',
    async (name, quoted) => {
      const { publisher, published } = await opened();
      const headers = { [name]: 'x' };

      const error = await rejectionOf(
        publisher.publish('OrderCreated', { v2, v3 }, { ...fact, headers }),
      );

      expect(error).toBeInstanceOf(InvalidMessageError);
      expect(error).toMatchObject({
        message: `headers.${quoted}: The transport header name ${quoted} cannot travel over NATS: it is empty or holds a colon, a space, a control or a non-ASCII character`,
        invalid: [{ kind: 'header', name, fit: 'uncarried-name' }],
      });
      expect(published).toEqual([]);
    },
  );

  test.each([' x', 'x\n', 'x ', 'x\uD800'])(
    'a header whose value is %j would not arrive as given over NATS: it rejects with InvalidMessageError naming headers.<name>, and nothing is sent',
    async (value) => {
      const { publisher, published } = await opened();
      const headers = { 'x-note': value };

      const error = await rejectionOf(
        publisher.publish('OrderCreated', { v2, v3 }, { ...fact, headers }),
      );

      expect(error).toBeInstanceOf(InvalidMessageError);
      expect(error).toMatchObject({
        message:
          'headers.x-note: The transport header x-note has a value that would not arrive as given over NATS: not a string, a CR or LF, whitespace leading or trailing, or a lone surrogate',
        invalid: [{ kind: 'header', name: 'x-note', fit: 'uncarried-value' }],
      });
      expect(published).toEqual([]);
    },
  );

  test.each(['', ' o-1', 'o-1 ', 'o-1\n', 'o-1\r', 'o-1\uD800'])(
    'a Fact id of %j rejects with InvalidMessageError at factId, and nothing is sent',
    async (factId) => {
      const { publisher, published } = await opened();

      const error = await rejectionOf(publisher.publish('OrderCreated', { v2, v3 }, { factId }));

      expect(error).toBeInstanceOf(InvalidMessageError);
      expect(error).toMatchObject({
        message: `factId: ${factIdRule}`,
        invalid: [{ kind: 'id', at: 'factId' }],
      });
      expect(published).toEqual([]);
    },
  );

  test('a bad Fact id and bad headers are all listed in one InvalidMessageError, the Fact id first, then the headers as the record lists them', async () => {
    const { publisher, published } = await opened();
    const headers = { 'x-a': 'x ', 'Nats-TTL': '1' };

    const error = await rejectionOf(
      publisher.publish('OrderCreated', { v2, v3 }, { factId: 'o-1 ', headers }),
    );

    expect(error).toMatchObject({
      invalid: [
        { kind: 'id', at: 'factId' },
        { kind: 'header', name: 'x-a', fit: 'uncarried-value' },
        { kind: 'header', name: 'Nats-TTL', fit: 'reserved-name' },
      ],
    });
    expect(published).toEqual([]);
  });

  test('broker headers over 65,535 bytes reject with InvalidMessageError naming the version and its bytes, and nothing is sent', async () => {
    const { publisher, published } = await opened();

    const error = await rejectionOf(
      publisher.publish('OrderCreated', { v2, v3 }, { factId: 'o'.repeat(33_000) }),
    );

    expect(error).toBeInstanceOf(InvalidMessageError);
    expect(error).toMatchObject({
      invalid: [
        { kind: 'too-large', identity: 'OrderCreated@2', bytes: 66068 },
        { kind: 'too-large', identity: 'OrderCreated@3', bytes: 66068 },
      ],
    });
    expect((error as Error).message.split('\n')[0]).toBe(
      'OrderCreated@2: The broker headers would take 66068 bytes, over the 65535 JetStream stores; the Fact id counts twice, in Cf-Loom-Fact-Id and in Nats-Msg-Id',
    );
    expect(published).toEqual([]);
  });

  test('transport headers that together take more bytes than JetStream stores are refused the same way, though each one alone travels', async () => {
    const { publisher, published } = await opened();
    const headers = {
      'x-a': 'a'.repeat(30_000),
      'x-b': 'b'.repeat(30_000),
      'x-c': 'c'.repeat(30_000),
    };

    const publishing = publisher.publish('OrderCreated', { v2, v3 }, { factId: 'o-1', headers });

    await expect(publishing).rejects.toThrow(
      /^OrderCreated@2: The broker headers would take 90095 bytes, over the 65535 JetStream stores/,
    );
    expect(published).toEqual([]);
  });

  test('broker headers of exactly the bytes JetStream stores reach the broker as given', async () => {
    const { publisher, published } = await opened();
    const headers = { 'x-pad': 'p'.repeat(65_452) };

    await publisher.publish('OrderCreated', { v2, v3 }, { factId: 'o-1', headers });

    expect(published).toMatchObject([
      { factId: 'o-1', headers },
      { factId: 'o-1', headers },
    ]);
  });

  test('each Message Version’s broker headers are measured with its own broker message id, so one that does not fit refuses the whole publish', async () => {
    const { publisher, published } = await opened();
    const factId = 'g'.repeat(32_737);
    const bodies = { v9: { treeId: 't-1' }, v10: { treeId: 't-1' } };

    const error = await rejectionOf(publisher.publish('Grown', bodies, { factId }));

    expect(error).toMatchObject({
      invalid: [{ kind: 'too-large', identity: 'Grown@10', bytes: 65536 }],
    });
    expect(published).toEqual([]);
  });

  test('a refused header and a body that breaks its schema are both listed in one InvalidMessageError', async () => {
    const { publisher, published } = await opened();
    const broken = { ...v3, total: { amount: -1, currency: 'EUR' } };
    const headers = { 'Nats-TTL': '1' };

    const error = await rejectionOf(
      publisher.publish('OrderCreated', { v2, v3: broken }, { ...fact, headers }),
    );

    expect(error).toMatchObject({
      invalid: [
        { kind: 'header', name: 'Nats-TTL', fit: 'reserved-name' },
        { kind: 'body', identity: 'OrderCreated@3' },
      ],
    });
    expect((error as Error).message.split('\n')).toEqual([
      expect.stringMatching(/^headers\.Nats-TTL: The transport header Nats-TTL takes a name /),
      expect.stringMatching(/^OrderCreated@3: body\.total\.amount too_small: /),
    ]);
    expect(published).toEqual([]);
  });

  test('broker headers too large are listed before a body that breaks its schema', async () => {
    const { publisher } = await opened();
    const broken = { ...v3, total: { amount: -1, currency: 'EUR' } };

    const error = await rejectionOf(
      publisher.publish('OrderCreated', { v2, v3: broken }, { factId: 'o'.repeat(33_000) }),
    );

    expect(error).toMatchObject({
      invalid: [
        { kind: 'too-large', identity: 'OrderCreated@2' },
        { kind: 'too-large', identity: 'OrderCreated@3' },
        { kind: 'body', identity: 'OrderCreated@3' },
      ],
    });
  });

  test('a body that breaks its version’s schema throws InvalidMessageError naming the version and the path, and no version is sent', async () => {
    const { publisher, published } = await opened();
    const broken = { ...v3, total: { amount: -1, currency: 'EUR' } };

    const error = await rejectionOf(publisher.publish('OrderCreated', { v2, v3: broken }, fact));

    expect(error).toBeInstanceOf(InvalidMessageError);
    expect(error).toMatchObject({
      message: expect.stringMatching(/^OrderCreated@3: body\.total\.amount too_small: /),
      invalid: [
        {
          kind: 'body',
          identity: 'OrderCreated@3',
          issues: [{ part: 'body', path: ['total', 'amount'], code: 'too_small' }],
        },
      ],
    });
    expect(published).toEqual([]);
  });

  test('InvalidMessageError groups the Issues by version, one line per Issue in its message', async () => {
    const { publisher } = await opened();
    const brokenV2 = { ...v2, total: -1 };
    const brokenV3 = { ...v3, orderId: 'nope' };

    const error = await rejectionOf(
      publisher.publish('OrderCreated', { v2: brokenV2, v3: brokenV3 }, fact),
    );

    expect(error).toMatchObject({
      invalid: [
        { identity: 'OrderCreated@2', issues: [{ path: ['total'], code: 'too_small' }] },
        { identity: 'OrderCreated@3', issues: [{ path: ['orderId'], code: 'invalid_format' }] },
      ],
    });
    expect(error instanceof Error && error.message.split('\n')).toEqual([
      expect.stringMatching(/^OrderCreated@2: body\.total too_small: /),
      expect.stringMatching(/^OrderCreated@3: body\.orderId invalid_format: /),
    ]);
  });

  test('a Broker that fails on the second Message sent rejects publish with MessageNotSentError naming the Fact id and the one sent, the Broker’s error as cause', async () => {
    const { publisher, error } = await opened(2);

    const thrown = await rejectionOf(
      publisher.publish('OrderCreated', { v2, v3 }, { factId: 'o-1:created' }),
    );

    expect(thrown).toBeInstanceOf(MessageNotSentError);
    expect(thrown).toMatchObject({
      message: 'OrderCreated with Fact id o-1:created was not sent whole; sent: OrderCreated@3',
      factId: 'o-1:created',
      sent: ['OrderCreated@3'],
      cause: error,
    });
  });

  test('retrying with the same Fact id sends the same broker message ids', async () => {
    const { publisher, published } = await opened(2);
    await publisher.publish('OrderCreated', { v2, v3 }, { factId: 'o-1' }).catch(() => undefined);

    await publisher.publish('OrderCreated', { v2, v3 }, { factId: 'o-1' });

    expect(published.map((message) => message.messageId)).toEqual([
      'event.OrderCreated.v3:o-1',
      'event.OrderCreated.v3:o-1',
      'event.OrderCreated.v2:o-1',
    ]);
  });

  test('a name the Root does not publish throws at runtime', async () => {
    const { publisher } = await opened();

    const publishing = publisher.publish('OrderShipped' as never, {} as never, fact);

    await expect(publishing).rejects.toThrow('OrderShipped is no Event the Contract publishes');
  });

  test('bodies missing a live version throw InvalidMessageError at runtime', async () => {
    const { publisher, published } = await opened();

    const error = await rejectionOf(publisher.publish('OrderCreated', { v3 } as never, fact));

    expect(error).toMatchObject({
      invalid: [
        {
          kind: 'body',
          identity: 'OrderCreated@2',
          issues: [{ part: 'body', path: [], code: 'required' }],
        },
      ],
    });
    expect(published).toEqual([]);
  });

  test('publish after close rejects with MessagingClosedError', async () => {
    const { publisher, published, close } = await opened();
    await close();

    const error = await rejectionOf(publisher.publish('OrderCreated', { v2, v3 }, fact));

    expect(error).toBeInstanceOf(MessagingClosedError);
    expect(error).toMatchObject({ message: 'messaging is closed' });
    expect(published).toEqual([]);
  });
});

describe('sender.send', () => {
  test('send sends the Command’s one Active version on <service>.command.<Name>.v<n>, never a Deprecated one, whatever Group lists it', async () => {
    const { sender, published } = await opened();

    await sender.send('ChargeCard', charge, fact);

    expect(published.map((message) => message.subject)).toEqual([
      'orders-service.command.ChargeCard.v2',
    ]);
  });

  test('send’s Message carries a Fact id and a broker message id as publish’s does', async () => {
    const { sender, published } = await opened();

    await sender.send('ChargeCard', charge, { factId: 'o-1:charge' });

    expect(published).toMatchObject([
      { factId: 'o-1:charge', messageId: 'command.ChargeCard.v2:o-1:charge', headers: {} },
    ]);
    expect(decoded(published[0])).toEqual(charge);
  });

  test('send resolves duplicate false, then true for the same Fact id', async () => {
    const { sender } = await overMemory();

    const first = await sender.send('ChargeCard', charge, { factId: 'o-1:charge' });
    const second = await sender.send('ChargeCard', charge, { factId: 'o-1:charge' });

    expect([first, second]).toEqual([
      { factId: 'o-1:charge', duplicate: false },
      { factId: 'o-1:charge', duplicate: true },
    ]);
  });

  test('send refuses a Fact id or a transport header publish refuses with InvalidMessageError, and sends nothing', async () => {
    const { sender, published } = await opened();

    const refusals = [
      await rejectionOf(sender.send('ChargeCard', charge, { factId: 'o-1 ' })),
      await rejectionOf(
        sender.send('ChargeCard', charge, { ...fact, headers: { 'Nats-TTL': '1h' } }),
      ),
      await rejectionOf(
        sender.send('ChargeCard', charge, { ...fact, headers: { 'trace id': 'x' } }),
      ),
      await rejectionOf(
        sender.send('ChargeCard', charge, { ...fact, headers: { 'x-note': 'x\n' } }),
      ),
    ];

    expect(refusals.every((error) => error instanceof InvalidMessageError)).toBe(true);
    expect(refusals.map((error) => (error as Error).message)).toEqual([
      `factId: ${factIdRule}`,
      expect.stringMatching(/^headers\.Nats-TTL: The transport header Nats-TTL takes a name /),
      expect.stringMatching(
        /^headers\."trace id": The transport header name "trace id" cannot travel /,
      ),
      expect.stringMatching(/^headers\.x-note: The transport header x-note has a value /),
    ]);
    expect(published).toEqual([]);
  });

  test('send refuses broker headers too large for JetStream, naming the Command’s Message Version, and sends nothing', async () => {
    const { sender, published } = await opened();

    const sending = sender.send('ChargeCard', charge, { factId: 'o'.repeat(33_000) });

    await expect(sending).rejects.toThrow(
      'ChargeCard@2: The broker headers would take 66068 bytes, over the 65535 JetStream stores; the Fact id counts twice, in Cf-Loom-Fact-Id and in Nats-Msg-Id',
    );
    expect(published).toEqual([]);
  });

  test('a body that breaks the schema throws InvalidMessageError and nothing is sent', async () => {
    const { sender, published } = await opened();

    const error = await rejectionOf(sender.send('ChargeCard', { ...charge, amount: -1 }, fact));

    expect(error).toBeInstanceOf(InvalidMessageError);
    expect(error).toMatchObject({ message: expect.stringMatching(/^ChargeCard@2: body\.amount /) });
    expect(published).toEqual([]);
  });

  test('a Broker that fails rejects send with MessageNotSentError, nothing sent, the Broker’s error as cause', async () => {
    const { sender, error } = await opened(1);

    const thrown = await rejectionOf(sender.send('ChargeCard', charge, { factId: 'o-1:charge' }));

    expect(thrown).toBeInstanceOf(MessageNotSentError);
    expect(thrown).toMatchObject({
      message: 'ChargeCard with Fact id o-1:charge was not sent whole; sent: none',
      factId: 'o-1:charge',
      sent: [],
      cause: error,
    });
  });

  test('send after close rejects with MessagingClosedError', async () => {
    const { sender, published, close } = await opened();
    await close();

    const error = await rejectionOf(sender.send('ChargeCard', charge, fact));

    expect(error).toBeInstanceOf(MessagingClosedError);
    expect(published).toEqual([]);
  });
});

describe('messaging() over memory(): publish and send', () => {
  test('an Event and a Command with one name and version, published and sent with one Fact id, both reach the Broker', async () => {
    const chargeEvent = defineEvent({
      name: 'Charge',
      version: 1,
      visibility: 'internal',
      description: 'A charge was made',
      body: z.object({ orderId: z.uuid() }),
    });
    const chargeCommand = defineCommand({
      name: 'Charge',
      version: 1,
      description: 'Makes a charge',
      body: z.object({ orderId: z.uuid() }),
    });
    const sameName = defineService({
      name: 'probe-service',
      groups: [
        defineGroup({
          name: 'charges',
          description: 'Charges',
          events: [chargeEvent],
          commands: [chargeCommand],
        }),
      ],
    });
    const broker = memory();
    const { publisher, sender } = await messaging(sameName, broker);
    const body = { orderId: ORDER_ID };

    await publisher.publish('Charge', { v1: body }, { factId: 'o-1' });
    await sender.send('Charge', body, { factId: 'o-1' });

    expect(broker.messages.map(({ messageId }) => messageId)).toEqual([
      'event.Charge.v1:o-1',
      'command.Charge.v1:o-1',
    ]);
  });
});

/** A seeded generator of the same sequence every run, so a failing sequence can be replayed. */
function seededNext(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe('memory().messagesOf', () => {
  test('lists the Messages of one Message Version among those the Service published and sent, in the order the Broker took them', async () => {
    const { broker, publisher, sender } = await overMemory();
    await publisher.publish('OrderCreated', { v2, v3 }, { factId: 'o-1' });
    await sender.send('ChargeCard', charge, { factId: 'o-1' });
    await publisher.publish('OrderCreated', { v2, v3 }, { factId: 'o-2' });

    const lists = [orderCreatedV2, orderCreatedV3, chargeCardV2].map((version) =>
      broker.messagesOf(version).map(({ messageId }) => messageId),
    );

    expect(lists).toEqual([
      ['event.OrderCreated.v2:o-1', 'event.OrderCreated.v2:o-2'],
      ['event.OrderCreated.v3:o-1', 'event.OrderCreated.v3:o-2'],
      ['command.ChargeCard.v2:o-1'],
    ]);
  });

  test('lists each Message with the body the Broker took', async () => {
    const { broker, publisher } = await overMemory();
    await publisher.publish('OrderCreated', { v2, v3 }, fact);

    const recorded = broker.messagesOf(orderCreatedV3);

    expect(recorded).toMatchObject([
      { subject: 'orders-service.event.OrderCreated.v3', factId: 'o-1', body: v3 },
    ]);
  });

  test('lists nothing yet for a version the Service publishes or sends but has not', async () => {
    const { broker, publisher } = await overMemory();
    const beforeAnyPublish = broker.messagesOf(orderCreatedV2);
    await publisher.publish('OrderCreated', { v2, v3 }, fact);

    const notSentYet = broker.messagesOf(chargeCardV2);

    expect([beforeAnyPublish, notSentYet]).toEqual([[], []]);
  });

  test.for([
    ['a Retired Event version', orderCreatedV1, 'OrderCreated@1'],
    ['a Deprecated Command version', chargeCardV1, 'ChargeCard@1'],
  ] as const)('throws for %s, naming it', async ([, version, identity]) => {
    const { broker, publisher } = await overMemory();
    await publisher.publish('OrderCreated', { v2, v3 }, fact);

    const asked = () => broker.messagesOf(version);

    expect(asked).toThrow(`${identity} is no Message Version the Service publishes or sends`);
  });

  test('lists nothing before the Service connects, whatever the declaration', () => {
    const outside = defineEvent({
      name: 'Elsewhere',
      version: 1,
      visibility: 'internal',
      description: 'An event of no Contract here',
      body: z.object({ id: z.string() }),
    });
    const broker = memory();

    const lists = [orderCreatedV1, orderCreatedV2, outside].map((version) =>
      broker.messagesOf(version),
    );

    expect(lists).toEqual([[], [], []]);
  });

  test('leaves out a duplicate the Broker dropped', async () => {
    const { broker, publisher } = await overMemory();
    await publisher.publish('OrderCreated', { v2, v3 }, fact);
    await publisher.publish('OrderCreated', { v2, v3 }, fact);

    const recorded = broker.messagesOf(orderCreatedV2);

    expect(recorded).toHaveLength(1);
  });

  test('throws for a Provided Event, even when the Service publishes an Event of its name and version', async () => {
    const paymentSettledV1 = providedEvent('payments-service', {
      name: 'PaymentSettled',
      version: 1,
      visibility: 'internal',
      description: 'A payment was settled',
      body: z.object({ paymentId: z.string() }),
    });
    const ownSettledV1 = defineEvent({
      name: 'PaymentSettled',
      version: 1,
      visibility: 'internal',
      description: 'A payment was settled, as this Service tells it',
      body: z.object({ paymentId: z.string() }),
    });
    const settling = defineService({
      name: 'orders-service',
      groups: [
        defineGroup({
          name: 'payments',
          description: 'Payments',
          events: [ownSettledV1],
          subscriptions: [
            defineSubscription({
              name: 'onSettled',
              description: 'On settled',
              event: paymentSettledV1,
            }),
          ],
        }),
      ],
    });
    const broker = memory();
    const { publisher } = await messaging(settling, broker);
    await publisher.publish('PaymentSettled', { v1: { paymentId: 'p-1' } }, fact);

    const asked = () => broker.messagesOf(paymentSettledV1);

    expect(asked).toThrow('PaymentSettled@1 is no Message Version the Service publishes or sends');
    expect(broker.messagesOf(ownSettledV1)).toHaveLength(1);
  });

  test('throws for a declaration outside the Contract, whatever its name and version', async () => {
    const outsideOrderCreatedV2 = defineEvent({
      name: 'OrderCreated',
      version: 2,
      visibility: 'internal',
      description: 'An order was created, as another Contract declares it',
      body: z.object({ total: z.number() }),
    });
    const { broker, publisher } = await overMemory();
    await publisher.publish('OrderCreated', { v2, v3 }, fact);

    const asked = () => broker.messagesOf(outsideOrderCreatedV2);

    expect(asked).toThrow('OrderCreated@2 is no Message Version the Service publishes or sends');
  });

  test('the lists of every Message Version partition messages, each in order (seed 305)', async () => {
    const versions = [orderCreatedV2, orderCreatedV3, grownV9, grownV10, chargeCardV2];
    const next = seededNext(305);
    for (let round = 0; round < 60; round += 1) {
      const { broker, publisher, sender } = await overMemory();
      for (let step = 0; step < 24; step += 1) {
        const given = { factId: `f-${Math.floor(next() * 4)}` };
        const draw = next();
        if (draw < 0.4) await publisher.publish('OrderCreated', { v2, v3 }, given);
        else if (draw < 0.7) await publisher.publish('Grown', { v9: tree, v10: tree }, given);
        else await sender.send('ChargeCard', charge, given);
      }
      const ids = broker.messages.map(({ messageId }) => messageId);

      const lists = versions.map((version) =>
        broker.messagesOf(version).map(({ messageId }) => ids.indexOf(messageId)),
      );

      const everyPosition = lists.flat().toSorted((left, right) => left - right);
      expect(everyPosition).toEqual(ids.map((_id, position) => position));
      expect(lists.map((list) => list.toSorted((left, right) => left - right))).toEqual(lists);
    }
  });
});

describe('publisher.publish, given a body nested past the stack', () => {
  test('rejects with InvalidMessageError at the body, one malformed Issue, and nothing is sent', async () => {
    const tree: z.ZodType = z.object({
      get next() {
        return tree.optional();
      },
    });
    const nestedV1 = defineEvent({
      name: 'Nested',
      version: 1,
      visibility: 'internal',
      description: 'A deep body',
      body: tree,
    });
    const nesting = defineService({
      name: 'nesting-service',
      groups: [defineGroup({ name: 'nesting', description: 'Nesting', events: [nestedV1] })],
    });
    const { broker, published } = aBroker();
    const { publisher } = await messaging(nesting, broker);
    let v1: object = {};
    for (let depth = 0; depth < 5000; depth += 1) {
      v1 = { next: v1 };
    }

    const error = await rejectionOf(publisher.publish('Nested', { v1 }, fact));

    expect(error).toBeInstanceOf(InvalidMessageError);
    expect(error).toMatchObject({
      invalid: [
        {
          kind: 'body',
          identity: 'Nested@1',
          issues: [
            {
              part: 'body',
              path: [],
              code: 'malformed',
              message: 'The value is nested too deeply to read',
            },
          ],
        },
      ],
    });
    expect(published).toEqual([]);
  });
});
