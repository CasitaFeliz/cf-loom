import type { Msg, MsgHdrs } from '@nats-io/nats-core';

const encoder = new TextEncoder();

/**
 * A Message the Broker delivered to a pull, with what its Handler needs of it and the
 * acknowledgements NATS understands; nats.js builds its own only for its own pulls.
 */
export type PulledMessage = {
  readonly headers: MsgHdrs | undefined;
  readonly data: Uint8Array;
  readonly deliveryCount: number;
  readonly ack: () => void;
  readonly nak: () => void;
  readonly term: (reason?: string) => void;
};

/** A delivered Message read for its delivery count, answerable with each acknowledgement. */
export function pulledMessageOf(message: Msg): PulledMessage {
  const answer = (text: string) => message.respond(encoder.encode(text));
  return {
    headers: message.headers,
    data: message.data,
    deliveryCount: deliveryCountOf(message.reply ?? ''),
    ack: () => answer('+ACK'),
    nak: () => answer('-NAK'),
    term: (reason) => answer(reason ? `+TERM ${reason}` : '+TERM'),
  };
}

/**
 * The delivery count in the subject a delivered Message is acknowledged on, which NATS writes as
 * `$JS.ACK.<stream>.<durable consumer>.<delivery count>.…`, or with a domain and an account hash after `ACK`.
 */
function deliveryCountOf(reply: string): number {
  const tokens = reply.split('.');
  if (tokens.length === 9) {
    tokens.splice(2, 0, '_', '');
  }
  return Number.parseInt(tokens[6] ?? '', 10);
}
