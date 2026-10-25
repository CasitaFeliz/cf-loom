import { isSchema } from '@cf-loom/contract/internal';
import type * as core from 'zod/v4/core';
import { isMessageElement, type MessageElement } from './elements.ts';

/** A Command's Message Version or a Subscription with the Reader schema its Handler reads a body with, as the readers file (`readers.generated.ts` by default) pairs them. */
export type Pairing<
  Element extends MessageElement = MessageElement,
  Reader extends core.$ZodType = core.$ZodType,
> = { readonly element: Element; readonly reader: Reader };

/** Whether a value is a Command or Subscription paired with its Reader, which `handle()` takes. */
export function isPairing(value: unknown): value is Pairing {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { element, reader } = value as Partial<Pairing>;
  return isMessageElement(element) && isSchema(reader);
}
