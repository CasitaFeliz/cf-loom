import type { Endpoint, Guard, StandardRejections } from '@casitafeliz/loom-contract';
import { type EndpointRun, endpointRunOf, type GuardRun, guardRunOf } from '../calls/index.ts';
import type { EndpointGiven, GuardGiven } from '../checks/index.ts';
import {
  type AnyHandler,
  isAnyWritten,
  isEndpointWritten,
  isGuardWritten,
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
