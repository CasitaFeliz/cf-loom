import type { Command, Endpoint, Guard, Subscription } from '@cf-loom/contract';
import { isEndpoint, isGuard } from '@cf-loom/contract/internal';
import type { MessageWritten, Written } from '../calls/index.ts';
import { isMessageElement } from './reader.ts';

/** What any Handler was written with: an Endpoint's, a Guard's, or a Message Handler's with its Reader. */
export type AnyWritten = Written<Endpoint> | Written<Guard> | MessageWritten;

/** A Handler as the runtime takes it: by the Element it was written for, whatever its signature. */
export type AnyHandler = { readonly element: Endpoint | Guard | Command | Subscription };

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

/** Whether a value is a Handler `handle()` returned for this very Endpoint, Guard, Command or Subscription. */
export function isWrittenFor<Element extends Endpoint | Guard | Command | Subscription>(
  handler: unknown,
  element: Element,
): handler is { readonly element: Element } {
  if (typeof handler !== 'function') {
    return false;
  }
  return writtenByHandler.get(handler)?.element === element;
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
