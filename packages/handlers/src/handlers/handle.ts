import type { Command, Endpoint, Guard, StandardRejections, Subscription } from '@cf-loom/contract';
import { notImplemented } from '@cf-loom/contract';
import {
  isEndpoint,
  isGuard,
  standardRejectionDefaults,
  standardRejectionsOf,
} from '@cf-loom/contract/internal';
import {
  answerOf,
  elementNameOf,
  endpointRunOf,
  guardRunOf,
  type Implementation,
  type MessageWritten,
  messageAnswerOf,
  messageRunOf,
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
import type {
  CommandHandler,
  CommandImplementation,
  DirectMeta,
  EventHandler,
  EventImplementation,
} from './message-handler.ts';
import { isWithReader, type WithReader } from './reader.ts';
import {
  type AnyHandler,
  type AnyWritten,
  isEndpointWritten,
  isGuardWritten,
  register,
} from './written.ts';

/** What `handle()` writes a Handler for: an Endpoint, a Guard, or a Command or Subscription with its Reader. */
type HandleTarget = Endpoint | Guard | WithReader;

function handleImplementation<Target extends Endpoint>(
  endpoint: Target,
  implementation: EndpointImplementation<Target>,
): EndpointHandler<Target>;
function handleImplementation<Target extends Guard>(
  guard: Target,
  implementation: GuardImplementation<Target>,
): GuardHandler<Target>;
function handleImplementation<Target extends WithReader<Command>>(
  command: Target,
  implementation: CommandImplementation<Target>,
): CommandHandler<Target>;
function handleImplementation<Target extends WithReader<Subscription>>(
  subscription: Target,
  implementation: EventImplementation<Target>,
): EventHandler<Target>;
function handleImplementation(
  target: HandleTarget,
  implementation: (...given: never[]) => unknown,
): AnyHandler {
  return handlerOf(target, { implementation: implementation as Implementation, stub: false });
}

function stubOf<Target extends Endpoint>(endpoint: Target): EndpointHandler<Target>;
function stubOf<Target extends Guard>(guard: Target): GuardHandler<Target>;
function stubOf<Target extends WithReader<Command>>(command: Target): CommandHandler<Target>;
function stubOf<Target extends WithReader<Subscription>>(
  subscription: Target,
): EventHandler<Target>;
function stubOf(target: HandleTarget): AnyHandler {
  const implementation = isWithReader(target) ? messageStubOf(target.element) : notImplementedStub;
  return handlerOf(target, { implementation, stub: true });
}

/**
 * Wraps the implementation of an Endpoint, a Guard, or a Command or Subscription with its Reader,
 * as its Handler: the function the runtime and a test call.
 */
export const handle = Object.assign(handleImplementation, {
  /** A Handler not written yet: it answers the not-implemented Rejection, so the Release deploys; a Message Handler's throws, since `consume` never runs it. */
  stub: stubOf,
});

/** The Handler of an Element: its direct call, carrying its `element`, kept with what it was written with. */
function handlerOf(
  target: HandleTarget,
  how: Pick<Written<Endpoint>, 'implementation' | 'stub'>,
): AnyHandler {
  const written = writtenFor(target, how);
  const handler: AnyHandler = Object.freeze(
    Object.assign(directCallOf(written), { element: written.element }),
  );
  register(handler, written);
  return handler;
}

function writtenFor(
  target: HandleTarget,
  how: Pick<Written<Endpoint>, 'implementation' | 'stub'>,
): AnyWritten {
  if (isEndpoint(target)) {
    return { element: target, ...how };
  }
  if (isGuard(target)) {
    return { element: target, ...how };
  }
  if (isWithReader(target)) {
    return { element: target.element, reader: target.reader, ...how };
  }
  throw new Error(
    'handle() takes an Endpoint or a Guard, or a Command or Subscription paired with its Reader by withReader()',
  );
}

function directCallOf(written: AnyWritten) {
  if (isEndpointWritten(written)) {
    return endpointCallOf(written);
  }
  if (isGuardWritten(written)) {
    return guardCallOf(written);
  }
  return messageCallOf(written);
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

function messageCallOf(written: MessageWritten) {
  return async (body: unknown, { messageId, factId, deliveryCount, headers = {} }: DirectMeta) => {
    const meta = { messageId, factId, deliveryCount, headers };
    const run = await messageRunOf(written, { body, meta });
    return messageAnswerOf(written.element, run);
  };
}

function standardsOf(directCall: DirectCall | undefined): StandardRejections {
  if (directCall === undefined) {
    return standardRejectionDefaults;
  }
  return standardRejectionsOf(directCall.contract);
}

const notImplementedStub: Implementation = () => reject(notImplemented);

function messageStubOf(element: Command | Subscription): Implementation {
  return () => {
    throw new Error(`${elementNameOf(element)}'s Handler is a stub, which consume never runs`);
  };
}
