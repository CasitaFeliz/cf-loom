import type { Endpoint, InputOf } from '@casitafeliz/loom-contract';
import { type InvalidInputBody, invalidInputBodyOf } from '@casitafeliz/loom-contract/internal';
import type { Received } from '../receiving/index.ts';

/**
 * A request a fake received, as its Provider read it: valid, with its Input parsed, or invalid,
 * with the Issues of the invalid-input Rejection it answered.
 */
export type FakeCall<Target extends Endpoint> =
  | { readonly kind: 'valid'; readonly input: InputOf<Target> }
  | { readonly kind: 'invalid'; readonly issues: InvalidInputBody['issues'] };

/** A request's place among its Endpoint's calls, kept from its arrival, filled once it is read. */
export type CallSlot = { readonly fill: (received: Received) => void };

/** Every Endpoint's calls, each in the order its requests arrived. */
export type CallLog = {
  readonly arrived: (name: string) => CallSlot;
  readonly callsOf: (name: string) => readonly unknown[];
};

/** A request's call, once it is read. */
type Slot = { call: unknown };

/** A log with no call yet. */
export function callLogOf(): CallLog {
  const slotsByName = new Map<string, Slot[]>();
  const slotsOf = (name: string): Slot[] => {
    const slots = slotsByName.get(name) ?? [];
    slotsByName.set(name, slots);
    return slots;
  };
  const arrived = (name: string): CallSlot => {
    const slot: Slot = { call: undefined };
    slotsOf(name).push(slot);
    return {
      fill: (received) => {
        slot.call = callOf(received);
      },
    };
  };
  const callsOf = (name: string) => {
    const calls = slotsOf(name).map((slot) => slot.call);
    return Object.freeze(calls.filter((call) => call !== undefined));
  };
  return { arrived, callsOf };
}

function callOf(received: Received): unknown {
  switch (received.kind) {
    case 'valid':
      return { kind: 'valid', input: received.input };
    case 'invalid':
      return { kind: 'invalid', issues: invalidInputBodyOf(received.issues).issues };
  }
}
