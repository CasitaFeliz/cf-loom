import { jsonOfBytes } from '@cf-loom/contract/internal';
import type { Fault } from '@cf-loom/handlers';
import { elementNameOf, type MessageRun, runMessage } from '@cf-loom/handlers/internal';
import type { ConsumedFault, Delivery, Settlement } from '../broker/index.ts';
import type { ConsumedRoute } from '../routing/index.ts';
import type { Report } from './faults.ts';

/** A pulled Subscription or Command Version: its route, and the Handler the map holds for it. */
export type Pulled = {
  readonly route: ConsumedRoute;
  readonly handler: { readonly element: ConsumedRoute['element'] };
};

/** What became of one delivery once its Handler ran, reported when it ended or failed. */
export async function settlementOf(
  pulled: Pulled,
  delivery: Delivery,
  report: Report,
): Promise<Settlement> {
  const run = await runOf(pulled, delivery);
  const settlement = settlementOfRun(run, aboutOf(pulled, delivery));
  if (settlement.kind !== 'acked' && settlement.fault !== undefined) {
    report(settlement.fault);
  }
  return settlement;
}

/** The Handler's run on the body received, or the body's one Issue when it is no UTF-8 JSON. */
async function runOf({ handler }: Pulled, delivery: Delivery): Promise<MessageRun> {
  const json = jsonOfBytes(delivery.body);
  if (json.kind === 'malformed') {
    const issue = { part: 'body', path: [], code: 'malformed', message: json.message } as const;
    return { kind: 'invalid-input', issues: [issue] };
  }
  const { messageId, factId, deliveryCount, headers } = delivery;
  const meta = { messageId, factId, deliveryCount, headers };
  return await runMessage(handler, { body: json.value, meta });
}

/** What a fault says of where it came from: the Element handled and the Message. */
type About = Pick<ConsumedFault, 'element' | 'subject' | 'messageId' | 'factId'>;

function aboutOf({ route }: Pulled, { messageId, factId }: Delivery): About {
  return { element: elementNameOf(route.element), subject: route.subject, messageId, factId };
}

/** A run as the broker settles it: a body that breaks its Reader ends, a throw stays pending. */
function settlementOfRun(run: MessageRun, about: About): Settlement {
  switch (run.kind) {
    case 'invalid-input':
      return { kind: 'ended', fault: { ...about, kind: 'invalid-body', issues: run.issues } };
    case 'thrown':
      return { kind: 'pending', fault: { ...about, kind: 'thrown', cause: run.cause } };
    case 'answered':
      return answeredSettlementOf(run.answer, about);
  }
}

/** Nothing acknowledges; a retryable Fault waits for redelivery; any other Fault ends it. */
function answeredSettlementOf(answer: Fault | undefined, about: About): Settlement {
  if (answer === undefined) {
    return { kind: 'acked' };
  }
  if (answer.retryable) {
    return { kind: 'pending', fault: undefined };
  }
  return { kind: 'ended', fault: { ...about, kind: 'returned', fault: answer } };
}
