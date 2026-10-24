import { isSchema } from '@cf-loom/contract/internal';
import type * as core from 'zod/v4/core';
import { isMessageElement, type MessageElement } from '../calls/index.ts';

/** A Command's Message Version or a Subscription with the Reader schema its Handler reads a body with, as the readers file (`readers.generated.ts` by default) pairs them. */
export type WithReader<
  Element extends MessageElement = MessageElement,
  Reader extends core.$ZodType = core.$ZodType,
> = { readonly element: Element; readonly reader: Reader };

/** Pairs a Command's Message Version or a Subscription with its Reader schema, generated from the Snapshot, so its Handler reads a body as a Subscriber does. */
export function withReader<const Element extends MessageElement, Reader extends core.$ZodType>(
  element: Element,
  reader: Reader,
): WithReader<Element, Reader> {
  const pairing = { element, reader };
  if (!isWithReader(pairing)) {
    throw new Error(
      'withReader() takes a Command or a Subscription declared with @cf-loom/contract and a zod schema',
    );
  }
  return Object.freeze(pairing);
}

/** Whether a value is a Command or Subscription paired with its Reader, which `handle()` takes. */
export function isWithReader(value: unknown): value is WithReader {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { element, reader } = value as Partial<WithReader>;
  return isMessageElement(element) && isSchema(reader);
}
