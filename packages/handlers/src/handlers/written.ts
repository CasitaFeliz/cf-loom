import type { Endpoint, Guard } from '@casitafeliz/loom-contract';
import { isEndpoint, isGuard } from '@casitafeliz/loom-contract/internal';
import type { Written } from '../calls/index.ts';

/** What any Handler was written with, an Endpoint's or a Guard's. */
export type AnyWritten = Written<Endpoint> | Written<Guard>;

/** A Handler as the runtime takes it: by the Endpoint or Guard it was written for, whatever its signature. */
export type AnyHandler = { readonly element: Endpoint | Guard };

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

/** Whether a Handler was written for an Endpoint. */
export function isEndpointWritten(written: AnyWritten): written is Written<Endpoint> {
  return isEndpoint(written.element);
}

/** Whether a Handler was written for a Guard. */
export function isGuardWritten(written: AnyWritten): written is Written<Guard> {
  return isGuard(written.element);
}

/** Whether a Handler was written for an Endpoint or a Guard: any Handler. */
export function isAnyWritten(written: AnyWritten): written is AnyWritten {
  return isEndpointWritten(written) || isGuardWritten(written);
}
