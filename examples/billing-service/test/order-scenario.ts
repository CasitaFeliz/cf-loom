import { join } from 'node:path';
import { brokerPrefix } from './environments.ts';

/** The directory of orders-service, one of the two Services of the scenario both acceptance tests over a Broker share: an order placed on orders over HTTP, which billing's Subscription and orders' own handle. */
export const ordersDir = join(import.meta.dirname, '../../orders-service');

/** The directory of billing-service, the other Service of that scenario. */
export const billingDir = join(import.meta.dirname, '..');

/** The Durable consumer of billing's Subscription that drafts an invoice on `OrderCreated`, as the Broker names it under `brokerPrefix`. */
export const billingDrafting = `${brokerPrefix}_billing-service_draft-invoice-on-created`;

/** The Durable consumer of orders' own Subscription that sends `ChargeCard` on `OrderCreated`. */
export const ordersCharging = `${brokerPrefix}_orders-service_charge-on-created`;

/** The Durable consumer of orders' Message Handler for `ChargeCard`. */
export const ordersHandlingCharge = `${brokerPrefix}_orders-service_command_ChargeCard_v1`;

const CUSTOMER_ID = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';

/** What every order a test places is for. */
export const ORDER_TOTAL = { amount: 990, currency: 'EUR' };

/** Places an order over HTTP at the orders-service at `ordersUrl`, as a Caller would, and answers its id. */
export async function placeAnOrder(ordersUrl: string): Promise<string> {
  const response = await fetch(`${ordersUrl}/orders`, {
    method: 'POST',
    headers: { 'x-api-key': 'billing-key', 'content-type': 'application/json' },
    body: JSON.stringify({ customerId: CUSTOMER_ID, total: ORDER_TOTAL }),
  });
  const placed = (await response.json()) as { readonly id: string };
  return placed.id;
}
