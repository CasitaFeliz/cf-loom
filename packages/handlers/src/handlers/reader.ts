import type { Command, Subscription } from '@cf-loom/contract';
import { isCommand, isSchema, isSubscription } from '@cf-loom/contract/internal';
import type * as core from 'zod/v4/core';

/** A Command's Message Version or a Subscription with the Reader schema its Handler reads a body with, as `readers.generated.ts` pairs them. */
export type WithReader<
  Element extends Command | Subscription = Command | Subscription,
  Reader extends core.$ZodType = core.$ZodType,
> = { readonly element: Element; readonly reader: Reader };

/** Pairs a Command's Message Version or a Subscription with its Reader schema, generated from the Snapshot, so its Handler reads a body as a Subscriber does. */
export function withReader<
  const Element extends Command | Subscription,
  Reader extends core.$ZodType,
>(element: Element, reader: Reader): WithReader<Element, Reader> {
  if (!isMessageElement(element) || !isSchema(reader)) {
    throw new Error(
      'withReader() takes a Command or a Subscription declared with @cf-loom/contract and a zod schema',
    );
  }
  return Object.freeze({ element, reader });
}

/** Whether a value is a Command or Subscription paired with its Reader, which `handle()` takes. */
export function isWithReader(value: unknown): value is WithReader {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { element, reader } = value as Partial<WithReader>;
  return isMessageElement(element) && isSchema(reader);
}

/** Whether a value is a Command's Message Version or a Subscription, the Elements a Message Handler is written for. */
export function isMessageElement(value: unknown): value is Command | Subscription {
  return isCommand(value) || isSubscription(value);
}
