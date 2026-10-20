import type { Endpoint, Guard, StandardRejections } from '@cf-loom/contract';
import { notImplemented } from '@cf-loom/contract';
import {
  isEndpoint,
  isGuard,
  standardRejectionDefaults,
  standardRejectionsOf,
} from '@cf-loom/contract/internal';
import {
  answerOf,
  endpointRunOf,
  guardRunOf,
  type Implementation,
  type Written,
} from '../calls/index.ts';
import { reject } from '../outcomes/index.ts';
import type {
  DirectCall,
  EndpointHandler,
  EndpointImplementation,
  GuardHandler,
  GuardImplementation,
} from './handler.ts';
import { type AnyHandler, type AnyWritten, isEndpointWritten, register } from './written.ts';

function handleImplementation<Target extends Endpoint>(
  endpoint: Target,
  implementation: EndpointImplementation<Target>,
): EndpointHandler<Target>;
function handleImplementation<Target extends Guard>(
  guard: Target,
  implementation: GuardImplementation<Target>,
): GuardHandler<Target>;
function handleImplementation(
  element: Endpoint | Guard,
  implementation: (...given: never[]) => unknown,
): AnyHandler {
  return handlerOf(element, { implementation: implementation as Implementation, stub: false });
}

function stubOf<Target extends Endpoint>(endpoint: Target): EndpointHandler<Target>;
function stubOf<Target extends Guard>(guard: Target): GuardHandler<Target>;
function stubOf(element: Endpoint | Guard): AnyHandler {
  return handlerOf(element, { implementation: () => reject(notImplemented), stub: true });
}

/** Wraps the implementation of an Endpoint or a Guard as its Handler: the function the runtime and a test call. */
export const handle = Object.assign(handleImplementation, {
  /** A Handler not written yet: it answers the not-implemented Rejection, so the Release deploys. */
  stub: stubOf,
});

/** The Handler of an Endpoint or a Guard: its direct call, carrying its `element`, kept with what it was written with. */
function handlerOf(
  element: Endpoint | Guard,
  how: Pick<Written<Endpoint>, 'implementation' | 'stub'>,
): AnyHandler {
  const written = writtenFor(element, how);
  const directCall = isEndpointWritten(written) ? endpointCallOf(written) : guardCallOf(written);
  const handler: AnyHandler = Object.freeze(Object.assign(directCall, { element }));
  register(handler, written);
  return handler;
}

function writtenFor(
  element: Endpoint | Guard,
  how: Pick<Written<Endpoint>, 'implementation' | 'stub'>,
): AnyWritten {
  if (isEndpoint(element)) {
    return { element, ...how };
  }
  if (isGuard(element)) {
    return { element, ...how };
  }
  throw new Error('handle() takes an Endpoint or a Guard declared with @cf-loom/contract');
}

function endpointCallOf(written: Written<Endpoint>) {
  return async (input: unknown, context: unknown, directCall?: DirectCall) => {
    const run = await endpointRunOf(written, { input, context }, standardsOf(directCall));
    return answerOf(written.element, run);
  };
}

function guardCallOf(written: Written<Guard>) {
  return async (demands: unknown, context: unknown, qualifier?: unknown) => {
    const given = { demands, context, qualifier };
    const run = await guardRunOf(written, given, standardRejectionDefaults);
    return answerOf(written.element, run);
  };
}

function standardsOf(directCall: DirectCall | undefined): StandardRejections {
  if (directCall === undefined) {
    return standardRejectionDefaults;
  }
  return standardRejectionsOf(directCall.contract);
}
