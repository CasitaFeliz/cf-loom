import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { aProvider } from '../../test/providers.ts';
import { aRootPackage } from '../../test/root-package.ts';
import {
  defineApplication,
  defineCommand,
  defineDependency,
  defineEndpoint,
  defineEvent,
  defineGroup,
  defineGuard,
  defineRejection,
  defineService,
  defineSubscription,
  type ProvidedEndpoint,
  providedEndpoint,
} from '../index.ts';
import type { IsOneLiteral, Root } from '../internal/index.ts';
import * as internal from '../internal/index.ts';

/** Every sentence the types and `generate` share, by the name `./internal` exports it under. */
type SentenceName = Extract<keyof typeof internal, `${string}Sentence`>;

/** A Root `generate` refuses with one shared sentence, and that sentence for the names it holds. */
type Row = { readonly root: () => Root; readonly sentence: string };

/** The messages `generate` fails a Root with. */
function messagesOf(root: Root): readonly string[] {
  const validated = internal.validateRoot(root, aRootPackage(root));
  return validated.kind === 'invalid' ? validated.failures.map(failureMessageOf) : [];
}

function failureMessageOf(failure: internal.Failure): string {
  return failure.kind === 'declaration' ? failure.message : failure.construct;
}

/** A Service whose one Group lists the Endpoint given. */
function serviceOf(endpoint: unknown): Root {
  const group = defineGroup({
    name: 'orders',
    description: 'Orders',
    endpoints: [endpoint],
  } as never);
  return defineService({ name: 'orders-service', groups: [group] });
}

const listOrders = {
  name: 'listOrders',
  method: 'GET',
  path: '/orders',
  visibility: 'public',
  description: 'Every order',
  success: { status: 200, body: z.object({ count: z.int() }) },
} as const;

const createOrder = { ...listOrders, name: 'createOrder', method: 'POST' } as const;

const unauthenticated = defineRejection({
  code: 'UNAUTHENTICATED',
  status: 401,
  message: 'Unauthenticated',
});

const orderPaid = {
  name: 'OrderPaid',
  version: 1,
  visibility: 'internal',
  description: 'An order was paid',
  body: z.object({ orderId: z.uuid() }),
} as const;

/** An Endpoint of a Provider's Contract Package, of the Visibility given. */
function providedBy(provider: string, name: string, visibility: 'public' | 'internal') {
  return providedEndpoint(
    aProvider(provider),
    { ...listOrders, name, path: `/${name}`, visibility },
    undefined,
  );
}

const rows: Record<SentenceName, Row> = {
  guardDemandsSentence: {
    root: () => {
      const signed = defineGuard({
        name: 'signed',
        description: 'Signed',
        demands: { body: z.object({}) },
      } as never);
      return serviceOf(defineEndpoint({ ...listOrders, guards: [signed] } as never));
    },
    sentence: internal.guardDemandsSentence,
  },
  groupListsSentence: {
    root: () =>
      defineService({
        name: 'orders-service',
        groups: [defineGroup({ name: 'orders', description: 'Orders' } as never)],
      }),
    sentence: internal.groupListsSentence,
  },
  noParamsSentence: {
    root: () =>
      serviceOf(
        defineEndpoint({ ...listOrders, input: { params: z.object({ id: z.uuid() }) } } as never),
      ),
    sentence: internal.noParamsSentence,
  },
  getBodySentence: {
    root: () =>
      serviceOf(defineEndpoint({ ...listOrders, input: { body: z.object({}) } } as never)),
    sentence: internal.getBodySentence,
  },
  noContentBodySentence: {
    root: () =>
      serviceOf(
        defineEndpoint({ ...listOrders, success: { status: 204, body: z.object({}) } } as never),
      ),
    sentence: internal.noContentBodySentence,
  },
  messageBodySentence: {
    root: () => {
      const event = defineEvent({ ...orderPaid, body: z.string() } as never);
      const group = defineGroup({ name: 'orders', description: 'Orders', events: [event] });
      return defineService({ name: 'orders-service', groups: [group] });
    },
    sentence: `${internal.messageBodySentence}: OrderPaid@1`,
  },
  messageVersionSentence: {
    root: () => {
      const event = defineEvent({ ...orderPaid, version: 0 } as never);
      const group = defineGroup({ name: 'orders', description: 'Orders', events: [event] });
      return defineService({ name: 'orders-service', groups: [group] });
    },
    sentence: `${internal.messageVersionSentence}: 0`,
  },
  commandSubscribedSentence: {
    root: () => {
      const command = defineCommand({
        name: 'PayOrder',
        version: 1,
        description: 'Pays an order',
        body: z.object({ orderId: z.uuid() }),
      });
      const subscription = defineSubscription({
        name: 'onPay',
        description: 'Pays',
        event: command,
      } as never);
      const group = defineGroup({
        name: 'orders',
        description: 'Orders',
        commands: [command],
        subscriptions: [subscription],
      } as never);
      return defineService({ name: 'orders-service', groups: [group] });
    },
    sentence: internal.commandSubscribedSentence,
  },
  undeclaredFieldSentence: {
    root: () => serviceOf(defineEndpoint({ ...listOrders, audience: 'all' } as never)),
    sentence: internal.undeclaredFieldSentence('audience'),
  },
  reservedNameSentence: {
    root: () => serviceOf(defineEndpoint({ ...listOrders, name: 'delete' } as never)),
    sentence: internal.reservedNameSentence(internal.nameNouns.endpoint, 'delete'),
  },
  listedTwiceSentence: {
    root: () =>
      serviceOf(
        defineEndpoint({ ...listOrders, rejections: [unauthenticated, unauthenticated] } as never),
      ),
    sentence: internal.listedTwiceSentence('UNAUTHENTICATED'),
  },
  needsQualifierSentence: {
    root: () => {
      const tenant = defineGuard({
        name: 'tenant',
        description: 'A tenant',
        qualifier: z.string(),
      });
      return serviceOf(defineEndpoint({ ...listOrders, guards: [tenant] } as never));
    },
    sentence: internal.needsQualifierSentence('tenant'),
  },
  takesNoQualifierSentence: {
    root: () => {
      const apiKey = defineGuard({ name: 'apiKey', description: 'A key' });
      const guards = [{ guard: apiKey, qualifier: 'x' }];
      return serviceOf(defineEndpoint({ ...listOrders, guards } as never));
    },
    sentence: internal.takesNoQualifierSentence('apiKey'),
  },
  oneProviderSentence: {
    root: () => {
      const endpoints = [
        providedBy('payments-service', 'getPayment', 'public'),
        providedBy('refunds-service', 'getRefund', 'public'),
      ];
      const dependency = defineDependency({ endpoints } as never);
      return defineService({ name: 'orders-service', dependencies: [dependency] });
    },
    sentence: internal.oneProviderSentence(['payments-service', 'refunds-service']),
  },
  exactParamsSentence: {
    root: () => serviceOf(defineEndpoint({ ...listOrders, path: '/orders/:orderId' } as never)),
    sentence: internal.exactParamsSentence(['orderId']),
  },
  successBodySentence: {
    root: () => serviceOf(defineEndpoint({ ...listOrders, success: { status: 200 } } as never)),
    sentence: internal.successBodySentence(200),
  },
  requiresEarlierSentence: {
    root: () => {
      const tenant = defineGuard({ name: 'tenant', description: 'A tenant' });
      const member = defineGuard({ name: 'member', description: 'A member', guards: [tenant] });
      return serviceOf(defineEndpoint({ ...listOrders, guards: [member] } as never));
    },
    sentence: internal.requiresEarlierSentence('member', ['tenant']),
  },
  headerCaseSentence: {
    root: () =>
      serviceOf(
        defineEndpoint({
          ...createOrder,
          input: { headers: z.object({ 'X-Tenant': z.string() }) },
        } as never),
      ),
    sentence: internal.headerCaseSentence('X-Tenant'),
  },
  notPublicSentence: {
    root: () => {
      const dependency = defineDependency({
        endpoints: [providedBy('payments-service', 'refundPayment', 'internal')],
      });
      return defineApplication({ name: 'web-admin', dependencies: [dependency] } as never);
    },
    sentence: internal.notPublicSentence('payments-service', 'refundPayment', 'internal'),
  },
  ownProviderSentence: {
    root: () => {
      const dependency = defineDependency({
        endpoints: [providedBy('orders-service', 'getOrder', 'public')],
      });
      return defineService({ name: 'orders-service', dependencies: [dependency] } as never);
    },
    sentence: internal.ownProviderSentence('orders-service'),
  },
};

describe('the refusal sentences the types and generate share', () => {
  test.each(Object.entries(rows))(
    'generate writes %s as its sentence',
    (_name, { root, sentence }) => {
      expect(messagesOf(root())).toEqual([sentence]);
    },
  );
});

describe('a sentence that lists names', () => {
  test('is written from a list of names, which it joins in the order given, as its type does', () => {
    const exact = internal.exactParamsSentence(['orderId', 'itemId', 'partId']);
    const requires = internal.requiresEarlierSentence('member', ['tenant', 'org']);
    const oneProvider = internal.oneProviderSentence(['zeta-service', 'alpha-service']);

    expectTypeOf(
      exact,
    ).toEqualTypeOf<"params declares exactly the path's :names: orderId, itemId and partId">();
    expectTypeOf(requires).toEqualTypeOf<'member requires tenant and org earlier in guards'>();
    expectTypeOf(
      oneProvider,
    ).toEqualTypeOf<"A Dependency lists one Provider's Endpoints: zeta-service and alpha-service">();
    expect([exact, requires, oneProvider]).toEqual([
      "params declares exactly the path's :names: orderId, itemId and partId",
      'member requires tenant and org earlier in guards',
      "A Dependency lists one Provider's Endpoints: zeta-service and alpha-service",
    ]);
  });
});

/** The sentences a part of a declaration is refused with: the keys of its type that no value has. */
type SentencesOf<Part> = {
  [Key in keyof Part]-?: [Part[Key]] extends [never] ? Key : never;
}[keyof Part];

/** The Endpoint of a Provider's Contract Package, named and of the Visibility given, as literals. */
function providedAs<
  const Provider extends string,
  const Name extends string,
  const Visibility extends 'public' | 'internal',
>(provider: Provider, name: Name, visibility: Visibility) {
  const declaration = { ...listOrders, name, visibility } as const;
  return providedEndpoint(aProvider(provider), declaration, undefined);
}

const guardOf = <const Name extends string>(name: Name) => ({ name, description: `The ${name}` });

describe('a refusal that lists names reads as generate writes it', () => {
  const orderAndItem = "params declares exactly the path's :names: orderId and itemId";

  test('params that are not a path’s :names are refused by type and by generate, listing the names in path order closed by and', () => {
    const declaration = {
      ...listOrders,
      path: '/orders/:orderId/items/:itemId',
      input: { params: z.object({ id: z.uuid() }) },
    } as const;
    type Written = Parameters<typeof defineEndpoint<typeof declaration>>[0];

    const messages = messagesOf(serviceOf(defineEndpoint(declaration as never)));

    expectTypeOf<SentencesOf<Written['input']['params']>>().toEqualTypeOf<typeof orderAndItem>();
    expect(messages).toEqual([orderAndItem]);
  });

  test('params of a path with three :names list them in path order', () => {
    const declaration = {
      ...listOrders,
      path: '/orders/:orderId/items/:itemId/parts/:partId',
      input: { params: z.object({ id: z.uuid() }) },
    } as const;
    type Written = Parameters<typeof defineEndpoint<typeof declaration>>[0];

    const messages = messagesOf(serviceOf(defineEndpoint(declaration as never)));

    const listed = "params declares exactly the path's :names: orderId, itemId and partId";
    expectTypeOf<SentencesOf<Written['input']['params']>>().toEqualTypeOf<typeof listed>();
    expect(messages).toEqual([listed]);
  });

  test('a path that repeats a :name is refused by generate for the repeat, and its params by the type list the name once', () => {
    const declaration = { ...listOrders, path: '/a/:id/b/:other/c/:id' } as const;
    type Written = Parameters<typeof defineEndpoint<typeof declaration>>[0];

    const messages = messagesOf(serviceOf(defineEndpoint(declaration as never)));

    const once = "params declares exactly the path's :names: id and other";
    expectTypeOf<SentencesOf<Written['input']['params']>>().toEqualTypeOf<typeof once>();
    expect(messages).toEqual(['A path param appears once: ":id"']);
  });

  test('an Endpoint whose path is a union of two paths is refused once for each path', () => {
    const declaration = {
      ...listOrders,
      path: '/a/:orderId/b/:itemId' as '/a/:orderId/b/:itemId' | '/c/:zeta',
      input: { params: z.object({ id: z.uuid() }) },
    } as const;
    type Written = Parameters<typeof defineEndpoint<typeof declaration>>[0];

    expectTypeOf<SentencesOf<Written['input']['params']>>().toEqualTypeOf<
      | "params declares exactly the path's :names: orderId and itemId"
      | "params declares exactly the path's :names: zeta"
    >();
  });

  test('an Endpoint whose path is a union with a path of no :names is refused for each path by its own rule', () => {
    const declaration = {
      ...listOrders,
      path: '/a/:x' as '/a/:x' | '/b',
      input: { params: z.object({ id: z.uuid() }) },
    } as const;
    type Written = Parameters<typeof defineEndpoint<typeof declaration>>[0];

    type Sentences = SentencesOf<Written['input']['params']>;

    expectTypeOf<Sentences>().toEqualTypeOf<
      "params declares exactly the path's :names: x" | 'A path without :names takes no params'
    >();
  });

  test('a Guard listed before two Guards it requires is refused by type and by generate, closed by and', () => {
    const tenant = defineGuard(guardOf('tenant'));
    const org = defineGuard(guardOf('org'));
    const member = defineGuard({ ...guardOf('member'), guards: [tenant, org] });
    const declaration = { ...listOrders, guards: [member] } as const;
    type Written = Parameters<typeof defineEndpoint<typeof declaration>>[0];

    const messages = messagesOf(serviceOf(defineEndpoint(declaration as never)));

    const sentence = 'member requires tenant and org earlier in guards';
    expectTypeOf<SentencesOf<NonNullable<Written['guards']>>>().toEqualTypeOf<typeof sentence>();
    expect(messages).toEqual([sentence]);
  });

  test('a Guard listed after one of the two Guards it requires is refused for the other alone', () => {
    const tenant = defineGuard(guardOf('tenant'));
    const org = defineGuard(guardOf('org'));
    const member = defineGuard({ ...guardOf('member'), guards: [tenant, org] });
    const declaration = { ...listOrders, guards: [tenant, member] } as const;
    type Written = Parameters<typeof defineEndpoint<typeof declaration>>[0];

    const messages = messagesOf(serviceOf(defineEndpoint(declaration as never)));

    const sentence = 'member requires org earlier in guards';
    expectTypeOf<SentencesOf<NonNullable<Written['guards']>>>().toEqualTypeOf<typeof sentence>();
    expect(messages).toEqual([sentence]);
  });

  test('a Guard listed before three Guards it requires lists them in the order its guards list them', () => {
    const tenant = defineGuard(guardOf('tenant'));
    const org = defineGuard(guardOf('org'));
    const region = defineGuard(guardOf('region'));
    const member = defineGuard({ ...guardOf('member'), guards: [region, tenant, org] });
    const declaration = { ...listOrders, guards: [member] } as const;
    type Written = Parameters<typeof defineEndpoint<typeof declaration>>[0];

    const messages = messagesOf(serviceOf(defineEndpoint(declaration as never)));

    const sentence = 'member requires region, tenant and org earlier in guards';
    expectTypeOf<SentencesOf<NonNullable<Written['guards']>>>().toEqualTypeOf<typeof sentence>();
    expect(messages).toEqual([sentence]);
  });

  test('a Dependency of three Providers lists them in the order its Endpoints list them, each once, closed by and', () => {
    const endpoints = [
      providedAs('zeta-service', 'getZeta', 'public'),
      providedAs('alpha-service', 'getAlpha', 'public'),
      providedAs('zeta-service', 'getZetaAgain', 'public'),
      providedAs('mid-service', 'getMid', 'public'),
    ] as const;
    type Written = Parameters<typeof defineDependency<{ readonly endpoints: typeof endpoints }>>[0];
    const dependency = defineDependency({ endpoints } as never);

    const messages = messagesOf(
      defineService({ name: 'orders-service', dependencies: [dependency] }),
    );

    const sentence =
      "A Dependency lists one Provider's Endpoints: zeta-service, alpha-service and mid-service";
    expectTypeOf<SentencesOf<Written['endpoints']>>().toEqualTypeOf<typeof sentence>();
    expect(messages).toEqual([sentence]);
  });

  test('two header names that are not lower-case are two refusals by type and two lines of generate', () => {
    const declaration = {
      ...createOrder,
      input: { headers: z.object({ 'X-Alpha': z.string(), 'X-Beta': z.string() }) },
    } as const;
    type Written = Parameters<typeof defineEndpoint<typeof declaration>>[0];

    const messages = messagesOf(serviceOf(defineEndpoint(declaration as never)));

    const alpha = 'Header names are lower-case: X-Alpha';
    const beta = 'Header names are lower-case: X-Beta';
    expectTypeOf<SentencesOf<Written['input']['headers']>>().toEqualTypeOf<
      typeof alpha | typeof beta
    >();
    expect(messages).toEqual([alpha, beta]);
  });

  test('two Endpoints an Application lists that are not Public are two refusals by type and two lines of generate', () => {
    const dependency = defineDependency({
      endpoints: [
        providedAs('payments-service', 'refundPayment', 'internal'),
        providedAs('payments-service', 'voidPayment', 'internal'),
      ],
    });
    type Written = Parameters<
      typeof defineApplication<{
        readonly name: 'web-admin';
        readonly dependencies: readonly [typeof dependency];
      }>
    >[0];

    const messages = messagesOf(
      defineApplication({ name: 'web-admin', dependencies: [dependency] } as never),
    );

    const refund =
      "An Application depends on Public Endpoints only: payments-service's refundPayment is internal";
    const voided =
      "An Application depends on Public Endpoints only: payments-service's voidPayment is internal";
    expectTypeOf<SentencesOf<NonNullable<Written['dependencies']>>>().toEqualTypeOf<
      typeof refund | typeof voided
    >();
    expect(messages).toEqual([refund, voided]);
  });
});

describe('the types of a refusal that lists names, beyond the plain tuple', () => {
  test('a Dependency whose Endpoints end in an open part lists the Provider of that part last', () => {
    const zeta = providedAs('zeta-service', 'getZeta', 'public');
    const alpha = providedAs('alpha-service', 'getAlpha', 'public');
    type Written = Parameters<
      typeof defineDependency<{ readonly endpoints: readonly [typeof zeta, ...(typeof alpha)[]] }>
    >[0];

    const sentence = "A Dependency lists one Provider's Endpoints: zeta-service and alpha-service";
    expectTypeOf<SentencesOf<Written['endpoints']>>().toEqualTypeOf<typeof sentence>();
  });

  test('a Dependency whose Provider is named by a widened string or by any is not refused by its type', () => {
    const zeta = providedAs('zeta-service', 'getZeta', 'public');
    const widened = providedAs('alpha-service' as string, 'getAlpha', 'public');
    // biome-ignore lint/suspicious/noExplicitAny: the any this test is about
    const anything = providedAs('alpha-service' as any, 'getAlpha', 'public');
    type Widened = Parameters<
      typeof defineDependency<{ readonly endpoints: readonly [typeof zeta, typeof widened] }>
    >[0];
    type Anything = Parameters<
      typeof defineDependency<{ readonly endpoints: readonly [typeof zeta, typeof anything] }>
    >[0];

    expectTypeOf<readonly [typeof zeta, typeof widened]>().toExtend<Widened['endpoints']>();
    expectTypeOf<readonly [typeof zeta, typeof anything]>().toExtend<Anything['endpoints']>();
  });

  test('a Guard whose guards list ends in an open part is refused with one sentence, listing the Guard of that part last', () => {
    const tenant = defineGuard(guardOf('tenant'));
    const org = defineGuard(guardOf('org'));
    const required: readonly [typeof tenant, ...(typeof org)[]] = [tenant, org];
    const member = defineGuard({ ...guardOf('member'), guards: required });
    const declaration = { ...listOrders, guards: [member] } as const;
    type Written = Parameters<typeof defineEndpoint<typeof declaration>>[0];

    const messages = messagesOf(serviceOf(defineEndpoint(declaration as never)));

    const sentence = 'member requires tenant and org earlier in guards';
    expectTypeOf<SentencesOf<NonNullable<Written['guards']>>>().toEqualTypeOf<typeof sentence>();
    expect(messages).toEqual([sentence]);
  });

  test('an Endpoint on a path with :names that declares no input is refused, listing the names', () => {
    const declaration = { ...listOrders, path: '/orders/:orderId/items/:itemId' } as const;
    type Written = Parameters<typeof defineEndpoint<typeof declaration>>[0];

    const messages = messagesOf(serviceOf(defineEndpoint(declaration as never)));

    const sentence = "params declares exactly the path's :names: orderId and itemId";
    expectTypeOf<SentencesOf<Written['input']['params']>>().toEqualTypeOf<typeof sentence>();
    expect(messages).toEqual([sentence]);
  });

  test('a generic wrapper that builds an Endpoint from a path or from Guards it is given is refused in its own body', () => {
    const tenant = defineGuard(guardOf('tenant'));
    const endpointAt = <const Path extends string>(path: Path) => {
      const input = { params: z.object({ id: z.string() }) };
      // @ts-expect-error TS2345 the path is a type parameter here, so its :names are unknown
      return defineEndpoint({ ...listOrders, path, input });
    };
    const endpointRequiring = <const Required extends readonly (typeof tenant)[]>(
      guards: Required,
    ) => {
      const member = defineGuard({ ...guardOf('member'), guards });
      // @ts-expect-error TS2322 which Guards the member requires is a type parameter here
      return defineEndpoint({ ...listOrders, guards: [member] });
    };

    expect(endpointAt('/orders/:id').path).toBe('/orders/:id');
    expect(endpointRequiring([tenant]).guards).toHaveLength(1);
  });

  test('a Dependency of a thousand Endpoints of one Provider is accepted by its type', () => {
    const getZeta = providedAs('zeta-service', 'getZeta', 'public');
    type Twice<List extends readonly unknown[]> = readonly [...List, ...List];
    type Thousand = Twice<
      Twice<Twice<Twice<Twice<Twice<Twice<Twice<Twice<Twice<readonly [typeof getZeta]>>>>>>>>>
    >;
    type Written = Parameters<typeof defineDependency<{ readonly endpoints: Thousand }>>[0];

    expectTypeOf<Thousand>().toExtend<Written['endpoints']>();
    expectTypeOf<Thousand['length']>().toEqualTypeOf<1024>();
  });
});

/** The names a sentence lists after its colon: `a, b and c` lists `a`, `b` and `c`. */
type NamesListedIn<Sentence> = Sentence extends `${string}: ${infer Tail}`
  ? NamesOfList<Tail>
  : never;

type NamesOfList<Tail> = Tail extends `${infer Head}, ${infer Rest}`
  ? Head | NamesOfList<Rest>
  : Tail extends `${infer Head} and ${infer Last}`
    ? Head | Last
    : Tail;

/** The sentences a Dependency of these Endpoints is refused with by its type. */
type DependencySentences<Endpoints extends readonly [ProvidedEndpoint, ...ProvidedEndpoint[]]> =
  SentencesOf<
    Parameters<typeof defineDependency<{ readonly endpoints: Endpoints }>>[0]['endpoints']
  >;

describe('the Providers a Dependency is refused for are the ones its refusal lists', () => {
  const inAlpha = providedAs('a-service', 'getAlpha', 'public');
  const inAlphaAgain = providedAs('a-service', 'getAlphaAgain', 'public');
  const inBeta = providedAs('b-service', 'getBeta', 'public');
  const inGamma = providedAs('c-service', 'getGamma', 'public');
  type Alpha = typeof inAlpha;
  type AlphaAgain = typeof inAlphaAgain;
  type Beta = typeof inBeta;
  type Gamma = typeof inGamma;

  test('a closed list, a repeated Provider and an open tail are refused by one sentence naming each Provider once', () => {
    type Closed = DependencySentences<readonly [Alpha, Beta]>;
    type Repeated = DependencySentences<readonly [Alpha, Beta, AlphaAgain]>;
    type OpenTail = DependencySentences<readonly [Alpha, ...Beta[]]>;

    expectTypeOf<IsOneLiteral<Closed>>().toEqualTypeOf<true>();
    expectTypeOf<NamesListedIn<Closed>>().toEqualTypeOf<'a-service' | 'b-service'>();
    expectTypeOf<IsOneLiteral<Repeated>>().toEqualTypeOf<true>();
    expectTypeOf<NamesListedIn<Repeated>>().toEqualTypeOf<'a-service' | 'b-service'>();
    expectTypeOf<IsOneLiteral<OpenTail>>().toEqualTypeOf<true>();
    expectTypeOf<NamesListedIn<OpenTail>>().toEqualTypeOf<'a-service' | 'b-service'>();
  });

  test('a middle rest and an open tail of a union are refused by one sentence naming each Provider once', () => {
    type Middle = DependencySentences<readonly [Alpha, ...Gamma[], Beta]>;
    type UnionTail = DependencySentences<readonly [Alpha, ...(Alpha | Beta)[]]>;

    expectTypeOf<IsOneLiteral<Middle>>().toEqualTypeOf<true>();
    expectTypeOf<NamesListedIn<Middle>>().toEqualTypeOf<'a-service' | 'b-service' | 'c-service'>();
    expectTypeOf<IsOneLiteral<UnionTail>>().toEqualTypeOf<true>();
    expectTypeOf<NamesListedIn<UnionTail>>().toEqualTypeOf<'a-service' | 'b-service'>();
  });

  test('an Endpoint typed as a union and a union of lists are refused by one sentence naming each Provider', () => {
    type UnionElement = DependencySentences<readonly [Alpha | Beta]>;
    type UnionOfLists = DependencySentences<readonly [Alpha, Beta] | readonly [Beta]>;

    expectTypeOf<IsOneLiteral<UnionElement>>().toEqualTypeOf<true>();
    expectTypeOf<NamesListedIn<UnionElement>>().toEqualTypeOf<'a-service' | 'b-service'>();
    expectTypeOf<IsOneLiteral<UnionOfLists>>().toEqualTypeOf<true>();
    expectTypeOf<NamesListedIn<UnionOfLists>>().toEqualTypeOf<'a-service' | 'b-service'>();
  });
});
