import type { Command, Event } from '@cf-loom/contract';
import type { OutgoingMessage } from '../broker/index.ts';
import type { ServiceVersion } from '../subjects/index.ts';
import { jsonBodyOf } from './bodies.ts';
import type { RecordedMessage } from './types.ts';

/** The Messages the Broker took, each broker message id once for the Broker's whole life. */
export class Recorded {
  readonly #messages: RecordedMessage[] = [];
  readonly #messageIds = new Set<string>();

  /** Records a Message, unless its broker message id was taken before: then it is a duplicate. */
  add(message: OutgoingMessage): 'recorded' | 'duplicate' {
    if (this.#messageIds.has(message.messageId)) {
      return 'duplicate';
    }
    this.#messageIds.add(message.messageId);
    const { subject, messageId, factId, headers, body } = message;
    this.#messages.push({ subject, messageId, factId, headers, body: jsonBodyOf(body) });
    return 'recorded';
  }

  messages(): readonly RecordedMessage[] {
    return [...this.#messages];
  }
}

/** Whether a recorded Message travelled on a subject, so that its body is what the writer of the Message Version on that subject wrote. */
function isRecordedOn<M extends Event | Command>(subject: string) {
  return (message: RecordedMessage): message is RecordedMessage<M> => message.subject === subject;
}

/** The Messages among `messages` that the Service published or sent as `version`, found among the `versions` it lists by the declaration itself; none for any other. */
export function recordedOf<const M extends Event | Command>(
  messages: readonly RecordedMessage[],
  versions: readonly ServiceVersion[],
  version: M,
): readonly RecordedMessage<M>[] {
  const listed = versions.find(({ message }) => message === version);
  if (listed === undefined) {
    return [];
  }
  return messages.filter(isRecordedOn<M>(listed.subject));
}
