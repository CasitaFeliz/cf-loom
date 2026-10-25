import {
  frozenCopyOf,
  type InvalidInputBody,
  invalidInputBodyOf,
  type Reading,
} from '@cf-loom/contract/internal';

/** A value readonly all the way down: the objects it holds, and the lists. */
export type Frozen<Value> = Value extends object
  ? { readonly [Key in keyof Value]: Frozen<Value[Key]> }
  : Value;

/** A request a fake answered with the invalid-input Rejection: the Issues it answered. */
export type InvalidCall = { readonly issues: InvalidInputBody['issues'] };

/** A request's place among its Endpoint's calls, kept from its arrival, filled once it is read. */
export type CallSlot = { readonly fill: (reading: Reading) => void };

/** Every Endpoint's calls, each in the order its requests arrived: those read as valid, and those answered invalid. */
export type CallLog = {
  readonly arrived: (name: string) => CallSlot;
  readonly callsOf: (name: string) => readonly unknown[];
  readonly invalidCallsOf: (name: string) => readonly InvalidCall[];
};

/** A request's reading, once it is read. */
type Slot = { reading: Reading | undefined };

/** A log with no call yet. */
export function callLogOf(): CallLog {
  const slotsByName = new Map<string, Slot[]>();
  const slotsOf = (name: string): Slot[] => {
    const slots = slotsByName.get(name) ?? [];
    slotsByName.set(name, slots);
    return slots;
  };
  const arrived = (name: string): CallSlot => {
    const slot: Slot = { reading: undefined };
    slotsOf(name).push(slot);
    return {
      fill: (reading) => {
        slot.reading = recordedOf(reading);
      },
    };
  };
  const readingsOf = (name: string) => slotsOf(name).map((slot) => slot.reading);
  const callsOf = (name: string) => Object.freeze(readingsOf(name).filter(isInput).map(inputOf));
  const invalidCallsOf = (name: string) =>
    Object.freeze(readingsOf(name).filter(isInvalid).map(invalidCallOf));
  return { arrived, callsOf, invalidCallsOf };
}

/** A reading as the log keeps it: a valid request's Input a frozen copy, which no step can change. */
function recordedOf(reading: Reading): Reading {
  if (reading.kind !== 'input') {
    return reading;
  }
  return { kind: 'input', input: frozenCopyOf(reading.input) as typeof reading.input };
}

type InputReading = Extract<Reading, { readonly kind: 'input' }>;

type InvalidReading = Extract<Reading, { readonly kind: 'invalid' }>;

function isInput(reading: Reading | undefined): reading is InputReading {
  return reading?.kind === 'input';
}

function isInvalid(reading: Reading | undefined): reading is InvalidReading {
  return reading?.kind === 'invalid';
}

function inputOf(reading: InputReading): unknown {
  return reading.input;
}

function invalidCallOf(reading: InvalidReading): InvalidCall {
  return { issues: invalidInputBodyOf(reading.issues).issues };
}
