import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { summarized } from '../../test/failures.ts';
import { aProvider } from '../../test/providers.ts';
import { anInstalledPackage, aRootPackage } from '../../test/root-package.ts';
import {
  defineApplication,
  defineCommand,
  defineDefinitions,
  defineDependency,
  defineEndpoint,
  defineEvent,
  defineGroup,
  defineGuard,
  defineRejection,
  defineService,
  defineSubscription,
  type Endpoint,
  type Group,
  providedEndpoint,
  providedEvent,
} from '../index.ts';
import {
  failureLineOf,
  isPlainObject,
  type Root,
  rootNameProblemOf,
  validateRoot,
} from '../internal/index.ts';

/** Validates a Root as the package it names: its package.json named as the Root is. */
function validateInPackage(root: Root) {
  return summarized(validateRoot(root, aRootPackage(root)));
}

const listing = {
  name: 'listOrders',
  method: 'GET',
  path: '/orders',
  visibility: 'public',
  description: 'Every order',
  success: { status: 200, body: z.array(z.object({ id: z.uuid() })) },
} as const;

const creating = {
  name: 'createOrder',
  method: 'POST',
  path: '/orders',
  visibility: 'public',
  description: 'Creates an order',
  success: { status: 201, body: z.object({ id: z.uuid() }) },
} as const;

const listOrders = defineEndpoint(listing);
const createOrder = defineEndpoint(creating);

function aGroup(name: string, endpoints: readonly [Endpoint, ...Endpoint[]]): Group {
  return defineGroup({ name, description: 'Orders', endpoints });
}

function validateGroups(groups: readonly Group[]) {
  return validateInPackage(defineService({ name: 'orders-service', groups }));
}

function failed(location: string, rule: string, message: string) {
  return { kind: 'invalid', failures: [{ kind: 'declaration', location, rule, message }] };
}

describe('validateRoot: name grammars', () => {
  test('a kebab-case Service name validates', () => {
    const contract = defineService({
      name: 'orders-service-2',
      groups: [aGroup('orders', [listOrders])],
    });

    expect(validateInPackage(contract).kind).toBe('valid');
  });

  test('a Service name that is not kebab-case fails', () => {
    const contract = defineService({
      name: 'OrdersService',
      groups: [aGroup('orders', [listOrders])],
    });

    expect(validateInPackage(contract)).toEqual(
      failed('(root) name', 'name-grammar', 'A Service name is kebab-case: "OrdersService"'),
    );
  });

  test('a Service name with a line break is quoted on one line', () => {
    const contract = defineService({
      name: 'orders-service\n',
      groups: [aGroup('orders', [listOrders])],
    });

    expect(validateInPackage(contract)).toEqual(
      failed('(root) name', 'name-grammar', 'A Service name is kebab-case: "orders-service\\n"'),
    );
  });

  test('a Group name that is not kebab-case fails', () => {
    expect(validateGroups([aGroup('Orders', [listOrders])])).toEqual(
      failed('groups.Orders name', 'name-grammar', 'A Group name is kebab-case: "Orders"'),
    );
  });

  test('an Endpoint name that is not camelCase fails', () => {
    const endpoint = defineEndpoint({ ...listing, name: 'list_orders' });

    expect(validateGroups([aGroup('orders', [endpoint])])).toEqual(
      failed(
        'endpoints.GET /orders (list_orders) name',
        'name-grammar',
        'An Endpoint name is camelCase words: "list_orders"',
      ),
    );
  });

  test('a Guard name that is not camelCase fails', () => {
    const apiKey = defineGuard({ name: 'ApiKey', description: 'A key' });
    const endpoint = defineEndpoint({ ...listing, guards: [apiKey] });

    expect(validateGroups([aGroup('orders', [endpoint])])).toEqual(
      failed('guards.ApiKey name', 'name-grammar', 'A Guard name is camelCase words: "ApiKey"'),
    );
  });

  test.each([
    ['getURL', 'getUrl'],
    ['getURLs', 'getUrLs'],
    ['URLs', undefined],
    ['listIDs', undefined],
    ['getX', undefined],
    ['settle2X', undefined],
  ])('an Endpoint named %s, with a capital that starts no word, fails', (name, written) => {
    const endpoint = defineEndpoint({ ...listing, name });
    const hint = written === undefined ? '' : ` (write ${written})`;

    expect(validateGroups([aGroup('orders', [endpoint])])).toEqual(
      failed(
        `endpoints.GET /orders (${name}) name`,
        'name-grammar',
        `An Endpoint name is camelCase words: "${name}"${hint}`,
      ),
    );
  });

  test('a Guard named useAPI, whose last capital starts no word, fails with the name to write', () => {
    const apiKey = defineGuard({ name: 'useAPI', description: 'A key' });
    const endpoint = defineEndpoint({ ...listing, guards: [apiKey] });

    expect(validateGroups([aGroup('orders', [endpoint])])).toEqual(
      failed(
        'guards.useAPI name',
        'name-grammar',
        'A Guard name is camelCase words: "useAPI" (write useApi)',
      ),
    );
  });

  test.each(['getUrl', 'getOrderById', 'createOrderV2', 'settle2', 'settle2Xy', 'a'])(
    'an Endpoint named %s, whose every capital starts a word, validates',
    (name) => {
      const endpoint = defineEndpoint({ ...listing, name });

      expect(validateGroups([aGroup('orders', [endpoint])]).kind).toBe('valid');
    },
  );

  test('a path param written :orderID, which is never re-spelled, validates', () => {
    const endpoint = defineEndpoint({
      ...listing,
      path: '/orders/:orderID',
      // biome-ignore lint/style/useNamingConvention: the param under test ends in a capital
      input: { params: z.object({ orderID: z.string() }) },
    });

    expect(validateGroups([aGroup('orders', [endpoint])]).kind).toBe('valid');
  });

  test('a recursion id written nodeID, which is never re-spelled, validates', () => {
    const node = z
      .object({
        value: z.string(),
        get children() {
          return z.array(node);
        },
      })
      .meta({ id: 'nodeID' });
    const endpoint = defineEndpoint({ ...listing, success: { status: 200, body: node } });

    expect(validateGroups([aGroup('orders', [endpoint])]).kind).toBe('valid');
  });

  test.each(['delete', 'yield', 'await', 'eval', 'default', 'handle'])(
    'an Endpoint named %s, a word code cannot name it by, fails',
    (name) => {
      const endpoint = defineEndpoint({ ...listing, name });

      expect(validateGroups([aGroup('orders', [endpoint])])).toEqual(
        failed(
          `endpoints.GET /orders (${name}) name`,
          'name-grammar',
          `An Endpoint name is camelCase words and no reserved word: "${name}"`,
        ),
      );
    },
  );

  test.each([
    'then',
    'constructor',
    'hasOwnProperty',
    'isPrototypeOf',
    'propertyIsEnumerable',
    'toLocaleString',
    'toString',
    'valueOf',
  ])('an Endpoint named %s, a name every object has or JavaScript calls, fails', (name) => {
    const endpoint = defineEndpoint({ ...listing, name });

    expect(validateGroups([aGroup('orders', [endpoint])])).toEqual(
      failed(
        `endpoints.GET /orders (${name}) name`,
        'name-grammar',
        `An Endpoint name is camelCase words and no reserved word: "${name}"`,
      ),
    );
  });

  test('an Endpoint named toJSON, which breaks the words and is a name JavaScript calls, reads both', () => {
    // @ts-expect-error TS2322 a literal reserved name is a type error
    const endpoint = defineEndpoint({ ...listing, name: 'toJSON' });

    expect(validateGroups([aGroup('orders', [endpoint])])).toEqual(
      failed(
        'endpoints.GET /orders (toJSON) name',
        'name-grammar',
        'An Endpoint name is camelCase words and no reserved word: "toJSON" (write toJson)',
      ),
    );
  });

  test.each([...Object.getOwnPropertyNames(Object.prototype), 'then', 'toJSON'])(
    'an Endpoint named %s, a name of every object or one JavaScript reads, fails the name grammar',
    (name) => {
      const endpoint = defineEndpoint({ ...listing, name });

      expect(validateGroups([aGroup('orders', [endpoint])])).toMatchObject({
        kind: 'invalid',
        failures: [{ location: `endpoints.GET /orders (${name}) name`, rule: 'name-grammar' }],
      });
    },
  );

  test.each(['thenable', 'toStringValue', 'getConstructor'])(
    'an Endpoint named %s, which only contains a reserved name, is valid',
    (name) => {
      const endpoint = defineEndpoint({ ...listing, name });

      expect(validateGroups([aGroup('orders', [endpoint])]).kind).toBe('valid');
    },
  );

  test.each(['class', 'arguments', 'handle', 'toString'])(
    'a Guard named %s, in a Definitions Package too, fails',
    (name) => {
      const guard = defineGuard({ name, description: 'A guard' });
      const definitions = defineDefinitions({});
      const rootExports = { guard };

      const validated = summarized(
        validateRoot(definitions, aRootPackage(definitions, { rootExports })),
      );

      expect(validated).toEqual(
        failed(
          `guards.${name} name`,
          'name-grammar',
          `A Guard name is camelCase words and no reserved word: "${name}"`,
        ),
      );
    },
  );

  test('a path param named as a reserved word is still allowed', () => {
    const endpoint = defineEndpoint({
      ...listing,
      path: '/orders/:class',
      input: { params: z.object({ class: z.string() }) },
    });

    expect(validateGroups([aGroup('orders', [endpoint])]).kind).toBe('valid');
  });

  test('a Rejection code that is not UPPER_SNAKE_CASE fails', () => {
    const locked = defineRejection({ code: 'orderLocked', status: 409, message: 'Locked' });
    const endpoint = defineEndpoint({ ...listing, rejections: [locked] });

    expect(validateGroups([aGroup('orders', [endpoint])])).toEqual(
      failed(
        'codes.orderLocked code',
        'name-grammar',
        'A Rejection code is UPPER_SNAKE_CASE: "orderLocked"',
      ),
    );
  });

  test('a Standard Rejection code a Definitions Package declares follows the code grammar', () => {
    const definitions = defineDefinitions({
      standardRejections: { notFound: { code: 'not-found', status: 404, message: 'Not found' } },
    });

    expect(validateInPackage(definitions)).toEqual(
      failed(
        'standardRejections.notFound code',
        'name-grammar',
        'A Rejection code is UPPER_SNAKE_CASE: "not-found"',
      ),
    );
  });
});

describe('validateRoot: unique names and identities', () => {
  test('two Endpoints with the same name fail', () => {
    const listAgain = defineEndpoint({ ...listing, path: '/orders/latest' });

    expect(validateGroups([aGroup('orders', [listOrders, listAgain])])).toEqual(
      failed(
        'endpoints.GET /orders/latest (listOrders) name',
        'duplicate-endpoint-name',
        'An Endpoint name is unique among the Endpoints that are not Retired: "listOrders"',
      ),
    );
  });

  test('a Retired Endpoint may share its name with an Active one', () => {
    const retired = defineEndpoint({ ...listing, path: '/orders/all', lifecycle: 'retired' });

    expect(validateGroups([aGroup('orders', [retired, listOrders])]).kind).toBe('valid');
  });

  test('two Endpoints with the same method and path fail', () => {
    const getLatest = defineEndpoint({
      ...listing,
      name: 'getLatestOrder',
      path: '/orders/:id',
      input: { params: z.object({ id: z.uuid() }) },
    });
    const getOrder = defineEndpoint({
      ...listing,
      name: 'getOrder',
      path: '/orders/:orderId',
      input: { params: z.object({ orderId: z.uuid() }) },
    });

    expect(validateGroups([aGroup('orders', [getLatest, getOrder])])).toEqual(
      failed(
        'endpoints.GET /orders/{} (getOrder) path',
        'duplicate-endpoint-identity',
        'An Endpoint is identified by its method and path, once: GET /orders/{}',
      ),
    );
  });

  test('the same path under two methods validates', () => {
    expect(validateGroups([aGroup('orders', [listOrders, createOrder])]).kind).toBe('valid');
  });

  test('two Guards with the same name fail', () => {
    const apiKey = defineGuard({ name: 'apiKey', description: 'A key' });
    const anotherApiKey = defineGuard({ name: 'apiKey', description: 'Another key' });
    const first = defineEndpoint({ ...listing, guards: [apiKey] });
    const second = defineEndpoint({ ...creating, guards: [anotherApiKey] });

    expect(validateGroups([aGroup('orders', [first, second])])).toEqual(
      failed(
        'guards.apiKey name',
        'duplicate-guard-name',
        'A Guard name is unique across the Contract and its Definitions Packages: "apiKey"',
      ),
    );
  });

  test('a Service’s own Guard named like an unreached Guard of its standardRejections package is valid', () => {
    const shared = defineGuard({ name: 'apiKey', description: 'A key' });
    const local = defineGuard({ name: 'apiKey', description: 'A local key' });
    const definitions = defineDefinitions({});
    const endpoint = defineEndpoint({ ...listing, guards: [local] });
    const contract = defineService({
      name: 'orders-service',
      standardRejections: definitions,
      groups: [aGroup('orders', [endpoint])],
    });
    const packages = [anInstalledPackage(definitions, { shared })];

    const validated = validateRoot(contract, aRootPackage(contract, { packages }));

    expect(validated.kind).toBe('valid');
  });

  test('a Guard named like an attached one, reached only through another Guard’s guards, fails as a duplicate', () => {
    const apiKey = defineGuard({ name: 'apiKey', description: 'A key' });
    const anotherApiKey = defineGuard({ name: 'apiKey', description: 'Another key' });
    const session = defineGuard({
      name: 'session',
      description: 'Builds on another key',
      guards: [anotherApiKey],
    });
    const endpoint = defineEndpoint({ ...listing, guards: [apiKey, session] });

    const validated = validateGroups([aGroup('orders', [endpoint])]);

    expect(validated).toEqual(
      failed(
        'guards.apiKey name',
        'duplicate-guard-name',
        'A Guard name is unique across the Contract and its Definitions Packages: "apiKey"',
      ),
    );
  });

  test('the same Guard attached by two Endpoints is one Guard', () => {
    const apiKey = defineGuard({ name: 'apiKey', description: 'A key' });
    const first = defineEndpoint({ ...listing, guards: [apiKey] });
    const second = defineEndpoint({ ...creating, guards: [apiKey] });

    expect(validateGroups([aGroup('orders', [first, second])]).kind).toBe('valid');
  });
});

describe('validateRoot: Groups', () => {
  test('two Groups with one name fail', () => {
    expect(
      validateGroups([aGroup('orders', [listOrders]), aGroup('orders', [createOrder])]),
    ).toEqual(
      failed(
        'groups.orders name',
        'duplicate-group-name',
        'A Group name is unique in the Contract: "orders"',
      ),
    );
  });
});

describe('validateRoot: the Root is named as its package', () => {
  const roots = [
    ['a Contract', defineService({ name: 'orders-service', groups: [] })],
    ['an Application', defineApplication({ name: 'orders-service', dependencies: [] })],
  ] as const;

  test.each(roots)('%s named as its package.json without the scope is valid', (_, root) => {
    const validated = validateRoot(root, aRootPackage(root, { packageName: 'orders-service' }));

    expect(validated.kind).toBe('valid');
  });

  test.each(roots)('%s named otherwise fails package-name', (_, root) => {
    const validated = summarized(
      validateRoot(root, aRootPackage(root, { packageName: 'billing-service' })),
    );

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          location: '(root) name',
          rule: 'package-name',
          message: `A Root is named as its package.json, without the scope: "orders-service" is written, package.json names "billing-service"`,
        },
      ],
    });
  });

  test('a wrong package name is reported with every other failure at once', () => {
    const root = defineService({ name: 'Orders', groups: [] });

    const validated = validateRoot(root, aRootPackage(root, { packageName: 'orders' }));

    const rules = validated.kind === 'invalid' ? validated.failures.map(ruleOf) : [];
    expect(rules).toEqual(['name-grammar', 'package-name']);
  });

  test('a Service is named as its package.json without the scope', () => {
    const root = defineService({ name: 'orders-service', groups: [] });

    const validated = validateRoot(
      root,
      aRootPackage(root, { packageName: '@payments/orders-service' }),
    );

    expect(validated.kind).toBe('valid');
  });

  test('a Definitions Package takes the name of its package.json, whatever it is', () => {
    const root = defineDefinitions({});

    const validated = validateRoot(root, aRootPackage(root, { packageName: 'shared' }));

    expect(validated.kind).toBe('valid');
  });
});

function ruleOf(failure: { readonly kind: string } & { readonly rule?: string }): string {
  return failure.rule ?? failure.kind;
}

describe('rootNameProblemOf', () => {
  test.for([
    ['service', 'orders-service', undefined],
    ['service', 'orders_service', 'a Service name is kebab-case'],
    ['service', 'OrdersService', 'a Service name is kebab-case'],
    ['service', '', 'a Service name is kebab-case'],
    ['service', 'a'.repeat(64), undefined],
    ['service', 'a'.repeat(65), 'a Service name is at most 64 characters'],
    ['application', 'web-admin', undefined],
    ['application', 'web_admin', 'an Application name is kebab-case'],
    ['application', 'a'.repeat(65), 'an Application name is at most 64 characters'],
    ['definitions', 'any_name', undefined],
    ['definitions', '', undefined],
  ] as const)('a %s named %j has the problem %j', ([kind, name, problem]) => {
    expect(rootNameProblemOf(kind, name)).toBe(problem);
  });

  test('the problem is the sentence validation fails a Service name with', () => {
    const contract = defineService({
      name: 'orders_service',
      groups: [aGroup('orders', [listOrders])],
    });

    const problem = rootNameProblemOf('service', 'orders_service');

    expect(validateInPackage(contract)).toMatchObject({
      failures: [{ message: expect.stringMatching(/^A Service name is kebab-case:/) }],
    });
    expect(problem).toBe('a Service name is kebab-case');
  });
});

const textOfTheValue = 'the source of the function or the description of the symbol';

/** A function written where a string belongs, as untyped code can: converting it to text throws, and its source is what no line may show. */
function aFunctionThatIsNoText(): never {
  const written = () => textOfTheValue;
  const toText = () => {
    throw new Error('the function was converted to text');
  };
  return Object.assign(written, { [Symbol.toPrimitive]: toText }) as never;
}

/** A Symbol written where a string belongs, whose description of many characters no line may show. */
function aSymbolOfManyCharacters(): never {
  return Symbol(textOfTheValue.repeat(1_000)) as never;
}

/** What untyped code can write where a string belongs, and no line may show the text of. */
const unwritable: readonly { readonly written: string; readonly make: () => never }[] = [
  { written: 'a function', make: aFunctionThatIsNoText },
  { written: 'a symbol', make: aSymbolOfManyCharacters },
];

describe('validateRoot: a function where a name belongs', () => {
  test.each([
    ['a Root', '(root) name', (name: string) => defineService({ name })],
    [
      'a Group',
      '(root) groups[0].name',
      (name: string) =>
        defineService({
          name: 'orders-service',
          groups: [defineGroup({ name, description: 'Orders', endpoints: [listOrders] })],
        }),
    ],
    [
      'an Endpoint',
      'groups.orders endpoints[0].name',
      (name: string) =>
        defineService({
          name: 'orders-service',
          groups: [aGroup('orders', [defineEndpoint({ ...listing, name })])],
        }),
    ],
    [
      'a Guard',
      'endpoints.GET /orders (listOrders) guards[0].name',
      (name: string) =>
        defineService({
          name: 'orders-service',
          groups: [
            aGroup('orders', [
              defineEndpoint({ ...listing, guards: [defineGuard({ name, description: 'A key' })] }),
            ]),
          ],
        }),
    ],
  ])('%s named by a function is refused as a name that is no string', (_, location, rootOf) => {
    const root = rootOf(aFunctionThatIsNoText());

    const validated = validateInPackage(root);

    expect(validated).toEqual(failed(location, 'not-a-string', 'name is a string'));
  });

  test('a Success status that is a function is shown as a function, never as its source', () => {
    const success = { ...listing.success, status: aFunctionThatIsNoText() };
    const endpoint = defineEndpoint({ ...listing, success });

    const validated = validateGroups([aGroup('orders', [endpoint])]);

    expect(validated).toEqual(
      failed(
        'endpoints.GET /orders (listOrders) success.status',
        'success-status',
        'A Success status is 200, 201, 202, 203 or 204: a function',
      ),
    );
  });
});

type Fields = Readonly<Record<string, unknown>>;

/** A kind of declaration: every field a valid one writes, and the Root that holds one written from fields. */
type Kit = {
  readonly kind: string;
  readonly fields: Fields;
  readonly rootOf: (fields: Fields) => Root;
};

const apiKey = defineGuard({ name: 'apiKey', description: 'A key' });
const tooManyRequests = defineRejection({ code: 'TOO_MANY', status: 429, message: 'Slow down' });
const orderLocked = defineRejection({
  code: 'ORDER_LOCKED',
  status: 409,
  message: 'Locked',
  headers: z.object({ 'x-lock': z.string() }),
  body: z.object({ by: z.string() }),
});
const getPayment = providedEndpoint(
  aProvider('payments-service'),
  {
    name: 'getPayment',
    method: 'GET',
    path: '/payments/:paymentId',
    visibility: 'public',
    description: 'One payment by id',
    input: { params: z.object({ paymentId: z.uuid() }) },
    success: { status: 200, body: z.object({ amount: z.int() }) },
  },
  undefined,
);
const paymentSettled = providedEvent('payments-service', {
  name: 'PaymentSettled',
  version: 1,
  visibility: 'internal',
  description: 'A payment was settled',
  body: z.object({ paymentId: z.uuid() }),
});
const standardRejections = {
  invalidInput: { code: 'INVALID_INPUT', status: 400, message: 'Invalid input' },
  notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
  notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
};

const eventFields = {
  name: 'OrderCreated',
  version: 1,
  visibility: 'internal',
  description: 'An order was placed',
  body: z.object({ orderId: z.uuid() }),
  lifecycle: 'active',
} as const;
const commandFields = {
  name: 'ChargeCard',
  version: 1,
  description: 'Charges the card',
  body: z.object({ orderId: z.uuid() }),
  lifecycle: 'active',
} as const;
const subscriptionFields = {
  name: 'notifyOnSettled',
  description: 'Receives it',
  event: paymentSettled,
} as const;

/** A Group of one list of Elements. */
function groupOf(elements: object): Group {
  return defineGroup({ name: 'orders', description: 'Orders', ...elements } as never);
}

/** The Root that holds a Group's Element. */
function serviceOf(group: Group): Root {
  return defineService({ name: 'orders-service', groups: [group] });
}

/** An Endpoint of the Service that holds what a test writes. */
function endpointWith(declared: object): Endpoint {
  return defineEndpoint({ ...listing, ...declared });
}

const kits: readonly Kit[] = [
  {
    kind: 'Service',
    fields: {
      name: 'orders-service',
      standardRejections: defineDefinitions({}),
      groups: [aGroup('orders', [listOrders])],
      dependencies: [defineDependency({ endpoints: [getPayment] })],
    },
    rootOf: (fields) => defineService(fields as never),
  },
  {
    kind: 'Application',
    fields: { name: 'web-admin', dependencies: [defineDependency({ endpoints: [getPayment] })] },
    rootOf: (fields) => defineApplication(fields as never),
  },
  {
    kind: 'Definitions',
    fields: { standardRejections },
    rootOf: (fields) => defineDefinitions(fields as never),
  },
  {
    kind: 'Group',
    fields: {
      name: 'orders',
      description: 'Orders',
      endpoints: [listOrders],
      events: [defineEvent(eventFields)],
      commands: [defineCommand(commandFields)],
      subscriptions: [defineSubscription(subscriptionFields)],
    },
    rootOf: (fields) => serviceOf(defineGroup(fields as never)),
  },
  {
    kind: 'Endpoint',
    fields: {
      name: 'updateOrder',
      method: 'PUT',
      path: '/orders/:orderId',
      visibility: 'public',
      description: 'Updates an order',
      input: {
        params: z.object({ orderId: z.string() }),
        query: z.object({ dryRun: z.string() }),
        headers: z.object({ 'x-request-id': z.string() }),
        body: z.object({ total: z.int() }),
      },
      success: {
        status: 200,
        headers: z.object({ 'x-version': z.string() }),
        body: z.object({ total: z.int() }),
      },
      guards: [apiKey],
      rejections: [orderLocked],
      lifecycle: 'deprecated',
      deprecatedAt: '2026-11-01T00:00:00Z',
    },
    rootOf: (fields) => serviceOf(aGroup('orders', [defineEndpoint(fields as never)])),
  },
  {
    kind: 'Guard',
    fields: {
      name: 'quota',
      description: 'The Caller stays within a quota',
      demands: {
        headers: z.object({ 'x-tenant': z.string() }),
        query: z.object({ plan: z.string() }),
      },
      guards: [apiKey],
      context: z.object({ tenant: z.string() }),
      qualifier: z.object({ perMinute: z.int() }),
      rejections: [tooManyRequests],
    },
    rootOf: (fields) => {
      const quota = defineGuard(fields as never);
      const guards = [apiKey, { guard: quota, qualifier: { perMinute: 1 } }];
      return serviceOf(aGroup('orders', [endpointWith({ guards })]));
    },
  },
  {
    kind: 'Rejection',
    fields: {
      code: 'ORDER_LOCKED',
      status: 409,
      message: 'Locked',
      headers: z.object({ 'x-lock': z.string() }),
      body: z.object({ by: z.string() }),
    },
    rootOf: (fields) => {
      const rejections = [defineRejection(fields as never)];
      return serviceOf(aGroup('orders', [endpointWith({ rejections })]));
    },
  },
  {
    kind: 'Event',
    fields: eventFields,
    rootOf: (fields) => serviceOf(groupOf({ events: [defineEvent(fields as never)] })),
  },
  {
    kind: 'Command',
    fields: commandFields,
    rootOf: (fields) => serviceOf(groupOf({ commands: [defineCommand(fields as never)] })),
  },
  {
    kind: 'Subscription',
    fields: subscriptionFields,
    rootOf: (fields) =>
      serviceOf(groupOf({ subscriptions: [defineSubscription(fields as never)] })),
  },
  {
    kind: 'Dependency',
    fields: { endpoints: [getPayment] },
    rootOf: (fields) =>
      defineService({
        name: 'orders-service',
        dependencies: [defineDependency(fields as never)],
      }),
  },
];

type FieldPath = readonly [string, ...string[]];

/** Every field of a declaration, and every field of each plain object it holds, as a path. */
function pathsOf(fields: Fields, above: readonly string[] = []): readonly FieldPath[] {
  const paths: FieldPath[] = [];
  for (const [key, value] of Object.entries(fields)) {
    const path: FieldPath = [...above, key] as unknown as FieldPath;
    paths.push(path);
    for (const nested of isPlainObject(value) ? pathsOf(value, path) : []) {
      paths.push(nested);
    }
  }
  return paths;
}

/** The fields with what `make` writes at the path, a copy of what holds it. */
function withWrittenAt(fields: Fields, [key, ...below]: FieldPath, make: () => never): Fields {
  const [next, ...later] = below;
  const held =
    next === undefined ? make() : withWrittenAt(fields[key] as Fields, [next, ...later], make);
  return { ...fields, [key]: held };
}

describe('validateRoot: a function or a symbol in any field of any declaration', () => {
  test('the declarations written here are one of each kind a Root holds', () => {
    expect(kits.map(({ kind }) => kind)).toEqual([
      'Service',
      'Application',
      'Definitions',
      'Group',
      'Endpoint',
      'Guard',
      'Rejection',
      'Event',
      'Command',
      'Subscription',
      'Dependency',
    ]);
  });

  test.each(kits)('the $kind declaration written with every field validates', (kit) => {
    const root = kit.rootOf(kit.fields);

    const validated = validateRoot(root, aRootPackage(root));

    const lines = validated.kind === 'invalid' ? validated.failures.map(failureLineOf) : [];
    expect(lines).toEqual([]);
  });

  const rows = kits.flatMap((kit) =>
    pathsOf(kit.fields).flatMap((path) =>
      unwritable.map(({ written, make }) => ({
        kind: kit.kind,
        field: path.join('.'),
        written,
        kit,
        path,
        make,
      })),
    ),
  );

  test.each(rows)(
    'the $kind declaration with $written as its $field fails validation, never throwing and never showing its text',
    ({ kit, path, make }) => {
      const root = kit.rootOf(withWrittenAt(kit.fields, path, make));

      const validated = validateRoot(root, aRootPackage(root));

      const lines = validated.kind === 'invalid' ? validated.failures.map(failureLineOf) : [];
      const showingTheText = lines.filter((line) => line.includes(textOfTheValue));
      expect({ kind: validated.kind, showingTheText }).toEqual({
        kind: 'invalid',
        showingTheText: [],
      });
    },
  );
});
