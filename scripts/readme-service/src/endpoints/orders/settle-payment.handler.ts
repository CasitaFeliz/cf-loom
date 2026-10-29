import { fault, handle, success } from '@cf-loom/handlers';
import { settlePayment } from '../../contract/endpoints/orders/settle-payment.endpoint.ts';
import type { Needs } from '../../resources.ts';
import { received } from '../../service-code.ts';

/** The most getPayment calls the Handler makes: the testing README scripts six Outcomes before its Success. */
const attempts = 7;

/** Asks getPayment until the Provider answers a Success, at most `attempts` times, and records each Outcome it receives. */
export default handle(
  settlePayment,
  async ({ params }, _call, { resources: { payments } }: Needs<'payments'>) => {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const outcome = await payments.getPayment({ params: { paymentId: params.paymentId } });
      received.push(outcome);
      if (outcome.kind === 'success') return success({ amount: outcome.body.amount });
    }
    return fault({ committed: 'no', retryable: true });
  },
);
