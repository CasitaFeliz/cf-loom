import { messageIdentityOf, ownOf } from '@cf-loom/contract/internal';
import type { BrokerConnection } from '../broker/index.ts';
import { publishedVersionsOf, type Subjects, sentVersionOf } from '../subjects/index.ts';
import { PublishError } from './errors.ts';
import { type Outgoing, outgoingOf } from './outgoing.ts';
import type { MessageOptions } from './types.ts';

/** The broker connection publishing and sending go through, which throws once messaging is closed. */
export type ConnectionOf = () => BrokerConnection;

/** `publish`: every live version of the named Event, checked, then sent in version order. */
export function publishOf(subjects: Subjects, connectionOf: ConnectionOf) {
  return async (name: string, bodies: unknown, options?: MessageOptions): Promise<void> => {
    const connection = connectionOf();
    const given = publishedVersionsOf(subjects, name).map((version) => ({
      version,
      body: ownOf(bodies, `v${version.message.version}`),
    }));
    await publishedInOrder(connection, name, outgoingOf(given, options));
  };
}

/** `send`: the named Command's one Active version; a broker failure is the broker's error. */
export function sendOf(subjects: Subjects, connectionOf: ConnectionOf) {
  return async (name: string, body: unknown, options?: MessageOptions): Promise<void> => {
    const connection = connectionOf();
    const outgoing = outgoingOf([{ version: sentVersionOf(subjects, name), body }], options);
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
