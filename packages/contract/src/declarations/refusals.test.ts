import { describe, expect, test } from 'vitest';
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
  providedEndpoint,
} from '../index.ts';
import type { Root } from '../internal/index.ts';
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
    sentence: internal.oneProviderSentence('payments-service, refunds-service'),
  },
  exactParamsSentence: {
    root: () => serviceOf(defineEndpoint({ ...listOrders, path: '/orders/:orderId' } as never)),
    sentence: internal.exactParamsSentence('orderId'),
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
    sentence: internal.requiresEarlierSentence('member', 'tenant'),
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
