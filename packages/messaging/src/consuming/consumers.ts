import type { HandlerMap } from '@cf-loom/handlers';
import { elementNameOf, isStub, mappedMessageHandlerOf } from '@cf-loom/handlers/internal';
import type { BrokerConsumer } from '../broker/index.ts';
import type { Consumed } from '../subjects/index.ts';
import type { Report } from './faults.ts';
import { settlementOf } from './receive.ts';

/** What of the Handler map `consume` reads: the Handlers of Commands and Subscriptions, and the `readers` that pair each with the Reader it reads with. */
export type ConsumedHandlers = Pick<HandlerMap, 'commands' | 'subscriptions' | 'readers'>;

/** What one `consume` runs its Handlers with: where it reports faults and the Resources it hands them. */
type ConsumersRun = { readonly report: Report; readonly resources: unknown };

/**
 * The consumers of one `consume`: each Handler looked up as `serve` looks one up, and required to
 * be written for the very pairing the map's `readers` hold, which gives the Reader its Messages
 * are read with; a stub left out with a warning, since `consume` does not pull from it; the rest
 * run with `consume`'s Resources.
 */
export function consumersOf(
  toConsume: readonly Consumed[],
  handlers: ConsumedHandlers,
  { report, resources }: ConsumersRun,
): readonly BrokerConsumer[] {
  const pulled = toConsume.map((consumed) => ({
    consumed,
    ...mappedMessageHandlerOf(handlers, consumed.at, consumed.element),
  }));
  for (const { consumed } of pulled.filter(({ handler }) => isStub(handler))) {
    console.warn(
      `${elementNameOf(consumed.element)}'s Handler is a stub: consume does not pull its Messages`,
    );
  }
  return pulled
    .filter(({ handler }) => !isStub(handler))
    .map(({ consumed, handler, reader }) => ({
      durable: consumed.durable,
      stream: consumed.stream,
      subject: consumed.subject,
      element: consumed.element,
      reader,
      receive: (delivery) => settlementOf({ consumed, handler, resources }, delivery, report),
    }));
}
