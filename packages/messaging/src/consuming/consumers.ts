import type { HandlerMap } from '@cf-loom/handlers';
import { elementNameOf, isStub, mappedHandlerOf, readerOf } from '@cf-loom/handlers/internal';
import type { BrokerConsumer } from '../broker/index.ts';
import type { ConsumedRoute } from '../routing/index.ts';
import type { Report } from './faults.ts';
import { settlementOf } from './receive.ts';

/** What of the Handler map `consume` reads: the Handlers of Commands and Subscriptions. */
export type ConsumedHandlers = Pick<HandlerMap, 'commands' | 'subscriptions'>;

/**
 * The consumers of one `consume`: each route's Handler looked up as `serve` looks one up, a stub
 * left out with a warning, since `consume` does not pull from it.
 */
export function consumersOf(
  routes: readonly ConsumedRoute[],
  handlers: ConsumedHandlers,
  report: Report,
): readonly BrokerConsumer[] {
  const pulled = routes.map((route) => ({
    route,
    handler: mappedHandlerOf(handlers[route.at.map], route.at, route.element),
  }));
  for (const { route } of pulled.filter(({ handler }) => isStub(handler))) {
    console.warn(
      `${elementNameOf(route.element)}'s Handler is a stub: consume does not pull its Messages`,
    );
  }
  return pulled
    .filter(({ handler }) => !isStub(handler))
    .map(({ route, handler }) => ({
      durable: route.durable,
      stream: route.stream,
      subject: route.subject,
      element: route.element,
      reader: readerOf(handler),
      receive: (delivery) => settlementOf({ route, handler }, delivery, report),
    }));
}
