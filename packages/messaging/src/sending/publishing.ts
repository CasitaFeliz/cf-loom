import { messageIdentityOf, ownOf } from '@cf-loom/contract/internal';
import type { BrokerConnection } from '../broker/index.ts';
import { publishedVersionsOf, type Subjects, sentVersionOf } from '../subjects/index.ts';
import { MessageNotSentError } from './errors.ts';
import { type Outgoing, outgoingOf } from './outgoing.ts';
import type { MessageOptions, Published, Sent } from './types.ts';

/** The broker connection publishing and sending go through, which throws once messaging is closed. */
type ConnectionOf = () => BrokerConnection;

/** `publish`: every live version of the named Event, checked, then sent in version order. */
export function publishOf(subjects: Subjects, connectionOf: ConnectionOf) {
  return async (name: string, bodies: unknown, options: MessageOptions): Promise<Published> => {
    const connection = connectionOf();
    const given = publishedVersionsOf(subjects, name).map((version) => ({
      version,
      body: ownOf(bodies, `v${version.message.version}`),
    }));
    const duplicates = await sentInOrder(connection, name, outgoingOf(given, options));
    return { factId: options.factId, duplicates };
  };
}

/** `send`: the named Command's one Active version. */
export function sendOf(subjects: Subjects, connectionOf: ConnectionOf) {
  return async (name: string, body: unknown, options: MessageOptions): Promise<Sent> => {
    const connection = connectionOf();
    const outgoing = outgoingOf([{ version: sentVersionOf(subjects, name), body }], options);
    const duplicates = await sentInOrder(connection, name, outgoing);
    return { factId: options.factId, duplicate: duplicates.length > 0 };
  };
}

/**
 * Sends one at a time, so a failure names the versions already sent; resolves to the identities
 * of those the Broker dropped as duplicates.
 */
async function sentInOrder(
  connection: BrokerConnection,
  name: string,
  outgoing: readonly Outgoing[],
): Promise<readonly string[]> {
  const sent: string[] = [];
  const duplicates: string[] = [];
  for (const { version, message } of outgoing) {
    const identity = messageIdentityOf(version.name, version.version);
    try {
      const { duplicate } = await connection.publish(message);
      if (duplicate) {
        duplicates.push(identity);
      }
    } catch (e) {
      throw new MessageNotSentError(name, { factId: message.factId, sent: [...sent] }, e);
    }
    sent.push(identity);
  }
  return duplicates;
}
