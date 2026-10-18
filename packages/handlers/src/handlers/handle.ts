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
  type EndpointCall,
  type EndpointRun,
  endpointRunOf,
  type GuardCall,
  type GuardRun,
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

/** A Handler as the runtime takes it: by the Element it was written for, whatever its signature. */
type AnyHandler = { readonly element: Endpoint | Guard };

const writtenByHandler = new WeakMap<object, Written<Endpoint | Guard>>();
const stubs = new WeakSet<object>();

function handleElement<Target extends Endpoint>(
  endpoint: Target,
  implementation: EndpointImplementation<Target>,
): EndpointHandler<Target>;
function handleElement<Target extends Guard>(
  guard: Target,
  implementation: GuardImplementation<Target>,
): GuardHandler<Target>;
function handleElement(
  element: Endpoint | Guard,
  implementation: (...given: never[]) => unknown,
): AnyHandler {
  return handlerFor(element, implementation as Implementation);
}

function handlerFor(element: Endpoint | Guard, implementation: Implementation): AnyHandler {
  if (isEndpoint(element)) {
    return handlerOf({ element, implementation }, endpointCallOf({ element, implementation }));
  }
  if (isGuard(element)) {
    return handlerOf({ element, implementation }, guardCallOf({ element, implementation }));
  }
  throw new Error('handle() takes an Endpoint or a Guard declared with @casitafeliz/loom-contract');
}

function stubOf<Target extends Endpoint>(endpoint: Target): EndpointHandler<Target>;
function stubOf<Target extends Guard>(guard: Target): GuardHandler<Target>;
function stubOf(element: Endpoint | Guard): AnyHandler {
  const handler = handlerFor(element, () => reject(notImplemented));
  stubs.add(handler);
  return handler;
}

/** Wraps an Element's implementation as its Handler: the function the runtime and a test call. */
export const handle = Object.assign(handleElement, {
  /** A Handler not written yet: it answers the not-implemented Rejection, so the Release deploys. */
  stub: stubOf,
});

/** Whether a Handler is a stub, which `consume` does not pull from and `serve` logs. */
export function isStub(handler: AnyHandler): boolean {
  return stubs.has(handler);
}

/** Runs one call of an EndpointHandler, answering a broken Contract as a value, never a throw. */
export function runEndpoint(
  handler: { readonly element: Endpoint },
  call: EndpointCall,
  standards: StandardRejections,
): Promise<EndpointRun> {
  return endpointRunOf(writtenOf(handler, isEndpoint), call, standards);
}

/** Runs one call of a GuardHandler, answering a broken Contract as a value, never a throw. */
export function runGuard(
  handler: { readonly element: Guard },
  call: GuardCall,
  standards: StandardRejections,
): Promise<GuardRun> {
  return guardRunOf(writtenOf(handler, isGuard), call, standards);
}

function endpointCallOf(written: Written<Endpoint>) {
  return async (input: unknown, context: unknown, call?: DirectCall) => {
    const run = await endpointRunOf(written, { input, context }, standardsOf(call));
    return answerOf(written.element, run);
  };
}

function guardCallOf(written: Written<Guard>) {
  return async (demands: unknown, context: unknown, qualifier?: unknown) => {
    const call = { demands, context, qualifier };
    const run = await guardRunOf(written, call, standardRejectionDefaults);
    return answerOf(written.element, run);
  };
}

function standardsOf(call: DirectCall | undefined): StandardRejections {
  return call === undefined ? standardRejectionDefaults : standardRejectionsOf(call.contract);
}

function handlerOf(written: Written<Endpoint | Guard>, directCall: object): AnyHandler {
  Object.defineProperty(directCall, 'element', { value: written.element, enumerable: true });
  writtenByHandler.set(directCall, written);
  return Object.freeze(directCall) as AnyHandler;
}

function writtenOf<Element extends Endpoint | Guard>(
  handler: { readonly element: Element },
  isElement: (element: unknown) => element is Element,
): Written<Element> {
  const written = writtenByHandler.get(handler);
  if (written === undefined || !isElement(written.element)) {
    throw new Error(`Not a Handler returned by handle(): ${String(handler.element?.name)}`);
  }
  return { element: written.element, implementation: written.implementation };
}
