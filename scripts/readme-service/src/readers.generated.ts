import { readersOf } from '@cf-loom/handlers';
import { paymentSettledEventV1 } from '@org/contract-payments-service';
import { chargeCardV1 } from './contract/commands/orders/charge-card.v1.command.ts';
import { notifyOnSettled } from './contract/subscriptions/orders/notify-on-settled.subscription.ts';

export const readers = readersOf({
  commands: { chargeCardV1: { declaration: chargeCardV1, reader: chargeCardV1.body } },
  subscriptions: {
    notifyOnSettled: { declaration: notifyOnSettled, reader: paymentSettledEventV1.body },
  },
});
