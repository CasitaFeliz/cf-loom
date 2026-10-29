import type { Endpoint, Guard } from '@cf-loom/contract';
import {
  type EndpointRun,
  endpointRunOf,
  type GuardRun,
  guardRunOf,
  type MessageGiven,
  type MessageHandled,
  type MessageRun,
  messageRunOf,
} from '../calls/index.ts';
import {
  checkedMessageBody,
  type EndpointRead,
  type GuardRead,
  readEndpointCall,
  readGuardCall,
} from '../checks/index.ts';
import {
  type AnyHandler,
  isAnyWritten,
  isEndpointWritten,
  isGuardWritten,
  isMessageWritten,
  writtenOf,
} from './written.ts';

/** Whether a Handler is a Stub, which `consume` does not pull from. */
export function isStub(handler: AnyHandler): boolean {
  return writtenOf(handler, isAnyWritten).stub;
}

/**
 * Runs one call of an EndpointHandler on what `serve` read: its Input as parsed, never parsed
 * again, its Context checked, then what it built. A Context that breaks the Contract is `serve`'s
 * own bug; a broken Contract is a value, never a throw.
 */
export function runEndpoint(
  handler: { readonly declaration: Endpoint },
  read: EndpointRead,
): Promise<EndpointRun> {
  const written = writtenOf(handler, isEndpointWritten);
  return endpointRunOf(written, read, () => readEndpointCall(written.declaration, read));
}

/**
 * Runs one call of a GuardHandler on what `serve` read: its demands as parsed, never parsed again,
 * its Context and Qualifier checked, then what it admitted; a broken Contract is a value, never a
 * throw.
 */
export function runGuard(
  handler: { readonly declaration: Guard },
  read: GuardRead,
): Promise<GuardRun> {
  const written = writtenOf(handler, isGuardWritten);
  return guardRunOf(written, read, () => readGuardCall(written.declaration, read));
}

/** Runs one call of a Message Handler on a body as received, read with its Reader and never written back. */
export function runMessage(
  handler: { readonly declaration: MessageHandled },
  received: MessageGiven,
): Promise<MessageRun> {
  return messageRunOf(writtenOf(handler, isMessageWritten), received, checkedMessageBody);
}
