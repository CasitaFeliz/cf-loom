import { jsonOfBytes, malformedBodyIssueOf } from '@cf-loom/contract/internal';
import type { Fault } from '@cf-loom/handlers';
import { type MessageRun, runMessage } from '@cf-loom/handlers/internal';
import type { Delivery, Settlement } from '../broker/index.ts';
import type { Consumed } from '../subjects/index.ts';
import type { Settled } from './details.ts';
import { type About, aboutOf, type ConsumedFault, type Report } from './faults.ts';

/** A pulled Subscription or Command Version, the Handler the map holds for it and the Resources it runs with. */
export type Pulled = {
  readonly consumed: Consumed;
  readonly handler: { readonly element: Consumed['element'] };
  readonly resources: unknown;
};

/** A run as the Broker would settle it, before its Fault is reported. */
type Ran = { readonly settlement: Settlement; readonly fault: ConsumedFault | undefined };

/**
 * What became of one delivery once its Handler ran, every Fault it built reported; a hook that
 * failed leaves it pending, since the Service did not hear of the Fault.
 */
export async function settlementOf(
  pulled: Pulled,
  delivery: Delivery,
  report: Report,
): Promise<Settled> {
  const run = await runOf(pulled, delivery);
  const { settlement, fault } = ranOf(run, aboutOf(pulled.consumed, delivery));
  if (fault === undefined) {
    return { settlement, fault, hookFailure: undefined };
  }
  const hookFailure = await report(fault);
  if (hookFailure !== undefined) {
    return { settlement: 'pending', fault, hookFailure };
  }
  return { settlement, fault, hookFailure };
}

/** The Handler's run on the body received, or the body's one Issue when it is no UTF-8 JSON. */
async function runOf({ handler, resources }: Pulled, delivery: Delivery): Promise<MessageRun> {
  const json = jsonOfBytes(delivery.body);
  if (json.kind === 'malformed') {
    return { kind: 'invalid-input', issues: [malformedBodyIssueOf('body', json.message)] };
  }
  const { messageId, factId, deliveryCount, lastAttempt, headers } = delivery;
  const meta = { messageId, factId, deliveryCount, lastAttempt, headers };
  return await runMessage(handler, { body: json.value, meta, resources });
}

/** A run as the Broker settles it: a body that breaks its Reader ends, a throw stays pending. */
function ranOf(run: MessageRun, about: About): Ran {
  switch (run.kind) {
    case 'invalid-input':
      return { settlement: 'ended', fault: { ...about, kind: 'invalid-body', issues: run.issues } };
    case 'thrown':
      return { settlement: 'pending', fault: { ...about, kind: 'thrown', cause: run.cause } };
    case 'answered':
      return answeredOf(run.answer, about);
  }
}

/** Nothing acknowledges; a retryable Fault waits for redelivery; any other Fault ends it. */
function answeredOf(answer: Fault | undefined, about: About): Ran {
  if (answer === undefined) {
    return { settlement: 'acked', fault: undefined };
  }
  const fault: ConsumedFault = { ...about, kind: 'returned', fault: answer };
  return { settlement: answer.retryable ? 'pending' : 'ended', fault };
}
