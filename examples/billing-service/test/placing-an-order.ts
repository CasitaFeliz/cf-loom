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
