import type { Endpoint, Guard } from '@cf-loom/contract';
import {
  type EndpointRun,
  endpointRunOf,
  type GuardRun,
  guardRunOf,
  type MessageElement,
  type MessageGiven,
  type MessageRun,
  messageRunOf,
} from '../calls/index.ts';
import { checkedMessageBody, type EndpointGiven, type GuardGiven } from '../checks/index.ts';
import {
  type AnyHandler,
  isAnyWritten,
  isEndpointWritten,
  isGuardWritten,
  isMessageWritten,
  writtenOf,
} from './written.ts';

/** Whether a Handler is a stub, which `consume` does not pull from. */
export function isStub(handler: AnyHandler): boolean {
  return writtenOf(handler, isAnyWritten).stub;
}

/** Runs one call of an EndpointHandler, answering a broken Contract as a value, never a throw. */
export function runEndpoint(
  handler: { readonly element: Endpoint },
  given: EndpointGiven,
): Promise<EndpointRun> {
  return endpointRunOf(writtenOf(handler, isEndpointWritten), given);
}

/** Runs one call of a GuardHandler, answering a broken Contract as a value, never a throw. */
export function runGuard(
  handler: { readonly element: Guard },
  given: GuardGiven,
): Promise<GuardRun> {
  return guardRunOf(writtenOf(handler, isGuardWritten), given);
}

/** Runs one call of a Message Handler on a body as received, read with its Reader and never written back. */
export function runMessage(
  handler: { readonly element: MessageElement },
  received: MessageGiven,
): Promise<MessageRun> {
  return messageRunOf(writtenOf(handler, isMessageWritten), received, checkedMessageBody);
}
