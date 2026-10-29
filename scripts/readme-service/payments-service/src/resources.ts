import type { WithResources } from '@cf-loom/handlers';

export type Payment = { readonly id: string; readonly amount: number };
export type Resources = {
  readonly payments: {
    byKey(key: string): Promise<Payment | undefined>;
    create(key: string, amount: number): Promise<Payment>;
  };
};
export type Needs<Key extends keyof Resources> = WithResources<Pick<Resources, Key>>;

const created = new Map<string, Payment>();
export const stored: ReadonlyMap<string, Payment> = created;
export const resources: Resources = {
  payments: {
    byKey: async (key) => created.get(key),
    create: async (key, amount) => {
      const payment = { id: `p-${created.size + 1}`, amount };
      created.set(key, payment);
      return payment;
    },
  },
};
export function resetPayments(): void {
  created.clear();
}
