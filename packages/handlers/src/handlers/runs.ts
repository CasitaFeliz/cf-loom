import type { Endpoint, Guard, StandardRejections } from '@cf-loom/contract';
import type * as core from 'zod/v4/core';
import {
  type EndpointRun,
  endpointRunOf,
  type GuardRun,
  guardRunOf,
  type MessageElement,
  type MessageMeta,
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
  standards: StandardRejections,
): Promise<EndpointRun> {
  return endpointRunOf(writtenOf(handler, isEndpointWritten), given, standards);
}

/** Runs one call of a GuardHandler, answering a broken Contract as a value, never a throw. */
export function runGuard(
  handler: { readonly element: Guard },
  given: GuardGiven,
  standards: StandardRejections,
): Promise<GuardRun> {
  return guardRunOf(writtenOf(handler, isGuardWritten), given, standards);
}

/** Runs one call of a Message Handler on a body as received, read with its Reader and never written back. */
export function runMessage(
  handler: { readonly element: MessageElement },
  received: { readonly body: unknown; readonly meta: MessageMeta },
): Promise<MessageRun> {
  return messageRunOf(writtenOf(handler, isMessageWritten), received, checkedMessageBody);
}

/** The Reader schema a Message Handler reads a body with, as `withReader` paired it. */
export function readerOf(handler: { readonly element: MessageElement }): core.$ZodType {
  return writtenOf(handler, isMessageWritten).reader;
}
