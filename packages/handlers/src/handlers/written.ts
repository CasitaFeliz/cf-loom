import type { Endpoint, Guard } from '@cf-loom/contract';
import { isEndpoint, isGuard } from '@cf-loom/contract/internal';
import {
  type HandledElement,
  isMessageElement,
  type MessageWritten,
  type Pairing,
  type Written,
} from '../calls/index.ts';

/** What any Handler was written with: an Endpoint's, a Guard's, or a Message Handler's with its Reader. */
export type AnyWritten = Written<Endpoint> | Written<Guard> | MessageWritten;

/** A Handler as the runtime takes it: by the Element it was written for, whatever its signature. */
export type AnyHandler = { readonly element: HandledElement };

const writtenByHandler = new WeakMap<object, AnyWritten>();

/** Keeps what a Handler was written with beside it, out of its type. */
export function register(handler: AnyHandler, written: AnyWritten): void {
  writtenByHandler.set(handler, written);
}

/** What a Handler was written with, of the kind asked; a value `handle()` did not return is a bug. */
export function writtenOf<Kind extends AnyWritten>(
  handler: AnyHandler,
  isKind: (written: AnyWritten) => written is Kind,
): Kind {
  const written = writtenByHandler.get(handler);
  if (written === undefined || !isKind(written)) {
    throw new Error(`Not a Handler returned by handle(): ${String(handler.element?.name)}`);
  }
  return written;
}

/** What a value was written for, when `handle()` returned it; none for any other value. */
export function writtenElementOf(handler: unknown): HandledElement | undefined {
  if (typeof handler !== 'function') {
    return undefined;
  }
  return writtenByHandler.get(handler)?.element;
}

/** Whether a value is a Message Handler `handle()` returned for this very pairing, the one object the readers file exports. */
export function isWrittenForPairing(handler: unknown, pairing: Pairing): boolean {
  if (typeof handler !== 'function') {
    return false;
  }
  const written = writtenByHandler.get(handler);
  return written !== undefined && isMessageWritten(written) && written.pairing === pairing;
}

/** Whether a Handler was written for an Endpoint. */
export function isEndpointWritten(written: AnyWritten): written is Written<Endpoint> {
  return isEndpoint(written.element);
}

/** Whether a Handler was written for a Guard. */
export function isGuardWritten(written: AnyWritten): written is Written<Guard> {
  return isGuard(written.element);
}

/** Whether a Handler was written for a Command or a Subscription: a Message Handler. */
export function isMessageWritten(written: AnyWritten): written is MessageWritten {
  return isMessageElement(written.element);
}

/** Whether a Handler was written for any Element. */
export function isAnyWritten(written: AnyWritten): written is AnyWritten {
  return isEndpointWritten(written) || isGuardWritten(written) || isMessageWritten(written);
}
