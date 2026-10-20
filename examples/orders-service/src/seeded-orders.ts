/** An order as the Service keeps it: what `getOrder` answers, and when it was locked, if it was. */
export type SeededOrder = {
  readonly id: string;
  readonly customerId: string;
  readonly status: 'pending' | 'paid' | 'shipped' | 'cancelled';
  readonly total: { readonly amount: number; readonly currency: string };
  readonly placedAt: string;
  readonly lockedAt?: string;
};

const CUSTOMER_ID = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';

/** The orders this fictional Service starts with, since it keeps no database. */
const seededOrders: readonly SeededOrder[] = [
  {
    id: '7d4f0a52-3c1b-4e8a-9f6d-1a2b3c4d5e6f',
    customerId: CUSTOMER_ID,
    status: 'paid',
    total: { amount: 4200, currency: 'EUR' },
    placedAt: '2026-01-10T12:00:00Z',
  },
  {
    id: 'c2a9e1f4-8b7d-4f3a-a6e5-0d1c2b3a4f5e',
    customerId: CUSTOMER_ID,
    status: 'pending',
    total: { amount: 1800, currency: 'EUR' },
    placedAt: '2026-01-12T08:15:00Z',
  },
  {
    id: '5e8b2c7a-1d4f-4a9e-b3c6-7f8e9d0a1b2c',
    customerId: CUSTOMER_ID,
    status: 'shipped',
    total: { amount: 7500, currency: 'EUR' },
    placedAt: '2026-01-14T17:45:00Z',
    lockedAt: '2026-01-15T09:30:00Z',
  },
];

/** The seeded order with this id, if there is one. */
export function seededOrderOf(orderId: string): SeededOrder | undefined {
  return seededOrders.find((seeded) => seeded.id === orderId);
}
