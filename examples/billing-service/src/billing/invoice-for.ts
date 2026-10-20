import { randomUUID } from 'node:crypto';
import type { ReceivedOutcome } from '@casitafeliz/loom-client';
import type { ordersDeps } from '../contract/dependencies/orders-service.dependencies.ts';
import type { OrdersClient } from '../orders-client/orders-client.ts';

type OrderOutcome = ReceivedOutcome<typeof ordersDeps, 'getOrder'>;
type Order = Extract<OrderOutcome, { kind: 'success' }>['value'];
type OrderRejection = Extract<OrderOutcome, { kind: 'rejection' }>;

/** An invoice for one paid order, for its total. */
export type Invoice = {
  readonly id: string;
  readonly orderId: string;
  readonly total: Order['total'];
};

/** What billing an order came to: its invoice, or why there is none. */
export type Invoicing =
  | { readonly kind: 'invoice'; readonly invoice: Invoice }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'not-billable'; readonly orderStatus: string }
  | { readonly kind: 'unavailable' };

/** Bills the order if orders-service says it is paid; only a paid order can be billed. */
export async function invoiceFor(orders: OrdersClient, orderId: string): Promise<Invoicing> {
  const outcome = await orderOf(orders, orderId);
  switch (outcome.kind) {
    case 'success':
      return invoicingOf(outcome.value);
    case 'rejection':
      return invoicingOfRejection(outcome);
    case 'fault':
      return { kind: 'unavailable' };
  }
}

/** Asks for the order, and asks once more only when nothing happened and asking again may work. */
async function orderOf(orders: OrdersClient, orderId: string): Promise<OrderOutcome> {
  const input = { params: { orderId } };
  const outcome = await orders.getOrder(input);
  const isWorthRetrying =
    outcome.kind === 'fault' && outcome.committed === 'no' && outcome.retryable;
  if (isWorthRetrying) return orders.getOrder(input);
  return outcome;
}

function invoicingOf(order: Order): Invoicing {
  if (order.status !== 'paid') return { kind: 'not-billable', orderStatus: statusText(order) };
  const invoice = { id: randomUUID(), orderId: order.id, total: order.total };
  return { kind: 'invoice', invoice };
}

function statusText(order: Order): string {
  return typeof order.status === 'string' ? order.status : order.status.unknown;
}

function invoicingOfRejection(rejection: OrderRejection): Invoicing {
  if (!rejection.known) return { kind: 'unavailable' };
  switch (rejection.code) {
    case 'NOT_FOUND':
      return { kind: 'not-found' };
    case 'ORDER_LOCKED':
      return { kind: 'not-billable', orderStatus: 'locked' };
    case 'UNAUTHENTICATED':
    case 'INVALID_INPUT':
    case 'NOT_IMPLEMENTED':
      return { kind: 'unavailable' };
  }
}
