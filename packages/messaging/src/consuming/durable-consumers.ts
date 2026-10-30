import { logOf } from '@cf-loom/contract/internal';
import type { HandlerMap } from '@cf-loom/handlers';
import { isStub, mappedMessageHandlerOf, nameOf } from '@cf-loom/handlers/internal';
import type { Consumed } from '../subjects/index.ts';
import type { DeliveryEnds } from './deadline.ts';
import type { CoreDurableConsumer, Received } from './details.ts';
import type { Report } from './faults.ts';
import { settlementOf } from './receive.ts';

/** What of the Handler map `consume` reads: the Handlers of Commands and Subscriptions, and the `readers` that pair each with the Reader it reads with. */
export type ConsumedHandlers = Pick<HandlerMap, 'commands' | 'subscriptions' | 'readers'>;

/**
 * What one `consume` runs its Handlers with: where it reports faults, the Resources it hands them,
 * `received`, which wraps each Durable consumer's run as the messaging's life allows it, and what ends a delivery early.
 */
type DurableConsumersRun = {
  readonly report: Report;
  readonly resources: unknown;
  readonly received: Received;
  readonly ends: DeliveryEnds;
};

/**
 * The Durable consumers of one `consume`: each Handler looked up as `serve` looks one up, and required to
 * be written for the very pairing the map's `readers` hold, which gives the Reader its Messages
 * are read with; a Stub left out with a warning, since `consume` does not pull from it; the rest
 * run with `consume`'s Resources.
 */
export function durableConsumersOf(
  toConsume: readonly Consumed[],
  handlers: ConsumedHandlers,
  { report, resources, received, ends }: DurableConsumersRun,
): readonly CoreDurableConsumer[] {
  const pulled = toConsume.map((consumed) => ({
    consumed,
    ...mappedMessageHandlerOf(handlers, consumed.at, consumed.declaration),
  }));
  for (const { consumed } of pulled.filter(({ handler }) => isStub(handler))) {
    const notPulled = `${nameOf(consumed.declaration)}'s Handler is a Stub: consume does not pull its Messages`;
    console.warn(...logOf(notPulled));
  }
  return pulled
    .filter(({ handler }) => !isStub(handler))
    .map(({ consumed, handler, reader }) => {
      const { durable, stream, subject, declaration } = consumed;
      const name = nameOf(declaration);
      const settle = received(
        (delivery) => settlementOf({ consumed, handler, resources }, delivery, { report, ends }),
        { name, subject },
      );
      return { durable, stream, subject, declaration, name, reader, settle };
    });
}
