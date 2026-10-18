import type { Endpoint, Guard, StandardRejections } from '@casitafeliz/loom-contract';
import { notImplemented } from '@casitafeliz/loom-contract';
import {
  isEndpoint,
  isGuard,
  standardRejectionDefaults,
  standardRejectionsOf,
} from '@casitafeliz/loom-contract/internal';
import {
  answerOf,
  type EndpointRun,
  endpointRunOf,
  type GuardRun,
  guardRunOf,
  type Implementation,
  type Written,
} from '../calls/index.ts';
import type { EndpointGiven, GuardGiven } from '../checks/index.ts';
import { reject } from '../outcomes/index.ts';
import type {
  DirectCall,
  EndpointHandler,
  EndpointImplementation,
  GuardHandler,
  GuardImplementation,
} from './handler.ts';

/** A Handler as the runtime takes it: by the Endpoint or Guard it was written for, whatever its signature. */
type AnyHandler = { readonly element: Endpoint | Guard };

const writtenByHandler = new WeakMap<object, Written<Endpoint | Guard>>();

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
  return handlerOf({ element, implementation: implementation as Implementation, stub: false });
}

function stubOf<Target extends Endpoint>(endpoint: Target): EndpointHandler<Target>;
function stubOf<Target extends Guard>(guard: Target): GuardHandler<Target>;
function stubOf(element: Endpoint | Guard): AnyHandler {
  return handlerOf({ element, implementation: () => reject(notImplemented), stub: true });
}

/** Wraps the implementation of an Endpoint or a Guard as its Handler: the function the runtime and a test call. */
export const handle = Object.assign(handleImplementation, {
  /** A Handler not written yet: it answers the not-implemented Rejection, so the Release deploys. */
  stub: stubOf,
});

/** Whether a Handler is a stub, which `consume` does not pull from and `serve` logs. */
export function isStub(handler: AnyHandler): boolean {
  return writtenOf(handler, isEndpointOrGuard).stub;
}

/** Runs one call of an EndpointHandler, answering a broken Contract as a value, never a throw. */
export function runEndpoint(
  handler: { readonly element: Endpoint },
  given: EndpointGiven,
  standards: StandardRejections,
): Promise<EndpointRun> {
  return endpointRunOf(writtenOf(handler, isEndpoint), given, standards);
}

/** Runs one call of a GuardHandler, answering a broken Contract as a value, never a throw. */
export function runGuard(
  handler: { readonly element: Guard },
  given: GuardGiven,
  standards: StandardRejections,
): Promise<GuardRun> {
  return guardRunOf(writtenOf(handler, isGuard), given, standards);
}

function handlerOf(written: Written<Endpoint | Guard>): AnyHandler {
  const directCall = directCallOf(written);
  Object.defineProperty(directCall, 'element', { value: written.element, enumerable: true });
  writtenByHandler.set(directCall, written);
  return Object.freeze(directCall) as AnyHandler;
}

function directCallOf({ element, implementation, stub }: Written<Endpoint | Guard>): object {
  if (isEndpoint(element)) {
    return endpointCallOf({ element, implementation, stub });
  }
  if (isGuard(element)) {
    return guardCallOf({ element, implementation, stub });
  }
  throw new Error('handle() takes an Endpoint or a Guard declared with @casitafeliz/loom-contract');
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

function isEndpointOrGuard(value: unknown): value is Endpoint | Guard {
  return isEndpoint(value) || isGuard(value);
}

function writtenOf<Answering extends Endpoint | Guard>(
  handler: { readonly element: Answering },
  isAnswering: (value: unknown) => value is Answering,
): Written<Answering> {
  const written = writtenByHandler.get(handler);
  if (written === undefined || !isAnswering(written.element)) {
    throw new Error(`Not a Handler returned by handle(): ${String(handler.element?.name)}`);
  }
  return { ...written, element: written.element };
}
