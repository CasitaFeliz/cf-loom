import type { Msg, MsgHdrs } from '@nats-io/nats-core';

const encoder = new TextEncoder();

/** The position of the delivery count in the `$JS.ACK.<domain>.<account hash>.<stream>.<durable consumer>.<delivery count>.…` subject NATS gives a delivered Message to be acknowledged on. */
const deliveryCountToken = 6;

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
  readonly working: () => void;
};

/** A delivered Message read for its delivery count, answerable with each acknowledgement. */
export function pulledMessageOf(message: Msg): PulledMessage {
  const answer = (text: string) => message.respond(encoder.encode(text));
  const tokens = (message.reply ?? '').split('.');
  return {
    headers: message.headers,
    data: message.data,
    deliveryCount: Number.parseInt(tokens[deliveryCountToken] ?? '', 10),
    ack: () => answer('+ACK'),
    nak: () => answer('-NAK'),
    term: (reason) => answer(reason ? `+TERM ${reason}` : '+TERM'),
    working: () => answer('+WPI'),
  };
}
