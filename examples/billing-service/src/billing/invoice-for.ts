import { randomUUID } from 'node:crypto';
import type { ReceivedOutcome } from '@cf-loom/client';
import type { ordersDependency } from '../contract/dependencies/orders-service.dependency.ts';
import type { OrdersClient } from '../orders-client/orders-client.ts';

type OrderOutcome = ReceivedOutcome<typeof ordersDependency, 'getOrder'>;
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
  | { readonly kind: 'locked'; readonly lockedAt: string }
  | { readonly kind: 'not-billable'; readonly orderStatus: string }
  | { readonly kind: 'unavailable'; readonly retryable: boolean };

/** Bills the order if orders-service says it was paid; only a paid order can be billed. */
export async function invoiceFor(orders: OrdersClient, orderId: string): Promise<Invoicing> {
  const outcome = await orderOf(orders, orderId);
  switch (outcome.kind) {
    case 'success':
      return invoicingOf(outcome.value);
    case 'rejection':
      return invoicingOfRejection(outcome);
    case 'fault':
      return { kind: 'unavailable', retryable: outcome.retryable };
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
  if (typeof order.status !== 'string') {
    return { kind: 'not-billable', orderStatus: order.status.unknown };
  }
  switch (order.status) {
    case 'paid':
    case 'shipped':
      return { kind: 'invoice', invoice: invoiceOf(order) };
    case 'pending':
    case 'cancelled':
      return { kind: 'not-billable', orderStatus: order.status };
  }
}

function invoiceOf(order: Order): Invoice {
  return { id: randomUUID(), orderId: order.id, total: order.total };
}

function invoicingOfRejection(rejection: OrderRejection): Invoicing {
  if (!rejection.known) return { kind: 'unavailable', retryable: false };
  switch (rejection.code) {
    case 'RESOURCE_NOT_FOUND':
      return { kind: 'not-found' };
    case 'ORDER_LOCKED':
      return { kind: 'locked', lockedAt: rejection.body.lockedAt };
    case 'UNAUTHENTICATED':
    case 'BAD_REQUEST':
    case 'NOT_YET_IMPLEMENTED':
      return { kind: 'unavailable', retryable: false };
  }
}
