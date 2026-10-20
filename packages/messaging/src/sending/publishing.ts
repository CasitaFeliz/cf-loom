import { messageIdentityOf } from '@cf-loom/contract/internal';
import { ownOf } from '@cf-loom/handlers/internal';
import type { BrokerConnection } from '../broker/index.ts';
import { publishedRoutesOf, type Routes, sentRouteOf } from '../routing/index.ts';
import { PublishError } from './errors.ts';
import { type Outgoing, outgoingOf } from './outgoing.ts';
import type { MessageOptions } from './types.ts';

/** The connection publishing and sending go through, which throws when there is none. */
export type ConnectionOf = () => BrokerConnection;

/** `publish`: every live version of the named Event, checked, then sent in version order. */
export function publishOf(routes: Routes, connectionOf: ConnectionOf) {
  return async (name: string, bodies: unknown, options?: MessageOptions): Promise<void> => {
    const connection = connectionOf();
    const given = publishedRoutesOf(routes, name).map((route) => ({
      route,
      body: ownOf(bodies, `v${route.message.version}`),
    }));
    await publishedInOrder(connection, name, outgoingOf(given, options));
  };
}

/** `send`: the named Command's one Active version; a broker failure is the broker's error. */
export function sendOf(routes: Routes, connectionOf: ConnectionOf) {
  return async (name: string, body: unknown, options?: MessageOptions): Promise<void> => {
    const connection = connectionOf();
    const outgoing = outgoingOf([{ route: sentRouteOf(routes, name), body }], options);
    for (const { message } of outgoing) {
      await connection.publish(message);
    }
  };
}

/** Sends one at a time, so a failure names the versions already sent. */
async function publishedInOrder(
  connection: BrokerConnection,
  event: string,
  outgoing: readonly Outgoing[],
): Promise<void> {
  const sent: string[] = [];
  for (const { version, message } of outgoing) {
    try {
      await connection.publish(message);
    } catch (e) {
      throw new PublishError(event, { factId: message.factId, sent: [...sent] }, e);
    }
    sent.push(messageIdentityOf(version.name, version.version));
  }
}
