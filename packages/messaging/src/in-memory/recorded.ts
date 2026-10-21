import type { OutgoingMessage } from '../broker/index.ts';
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
