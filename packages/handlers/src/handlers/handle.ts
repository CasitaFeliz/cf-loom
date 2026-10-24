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
  type MessageElement,
  type MessageWritten,
  messageAnswerOf,
  messageRunOf,
  type Written,
} from '../calls/index.ts';
import { checkedBody } from '../checks/index.ts';
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
import type { NoResources } from './resources.ts';
import {
  type AnyHandler,
  type AnyWritten,
  isEndpointWritten,
  isGuardWritten,
  register,
} from './written.ts';

/** What `handle()` writes a Handler for: an Endpoint, a Guard, or a Command or Subscription with its Reader. */
type HandleTarget = Endpoint | Guard | WithReader;

/** The function `handle()` wraps for a target: the implementation its Endpoint, Guard, Command or Subscription takes. */
type ImplementationOf<
  Target extends HandleTarget,
  Resources extends object,
> = Target extends Endpoint
  ? EndpointImplementation<Target, Resources>
  : Target extends Guard
    ? GuardImplementation<Target, Resources>
    : Target extends WithReader<Command>
      ? CommandImplementation<Target>
      : Target extends WithReader<Subscription>
        ? EventImplementation<Target>
        : never;

/** The Handler `handle()` and `handle.stub()` return for a target, nominal over what it was written for. */
type HandlerOf<Target extends HandleTarget, Resources extends object> = Target extends Endpoint
  ? EndpointHandler<Target, Resources>
  : Target extends Guard
    ? GuardHandler<Target, Resources>
    : Target extends WithReader<Command>
      ? CommandHandler<Target>
      : Target extends WithReader<Subscription>
        ? EventHandler<Target>
        : never;

function handleImplementation<Target extends HandleTarget, Resources extends object = NoResources>(
  target: Target,
  implementation: ImplementationOf<Target, Resources>,
): HandlerOf<Target, Resources> {
  const how = { implementation: implementation as Implementation, stub: false };
  return handlerOf(target, how) as HandlerOf<Target, Resources>;
}

function stubOf<Target extends HandleTarget>(target: Target): HandlerOf<Target, NoResources> {
  const implementation = isWithReader(target) ? messageStubOf(target.element) : notImplementedStub;
  return handlerOf(target, { implementation, stub: true }) as HandlerOf<Target, NoResources>;
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
  return async (input: unknown, context: unknown, directCall?: DirectCall<object>) => {
    const resources = directCall?.resources;
    const run = await endpointRunOf(
      written,
      { input, context, resources },
      standardsOf(directCall),
    );
    return answerOf(written.element, run);
  };
}

/** A GuardHandler's last argument as a direct call may leave it, before it is checked. */
type GuardCallGiven = { readonly qualifier?: unknown; readonly resources?: unknown };

function guardCallOf(written: Written<Guard>) {
  return async (demands: unknown, context: unknown, call?: GuardCallGiven) => {
    const given = { demands, context, qualifier: call?.qualifier, resources: call?.resources };
    const run = await guardRunOf(written, given, standardRejectionDefaults);
    return answerOf(written.element, run);
  };
}

function messageCallOf(written: MessageWritten) {
  return async (body: unknown, { messageId, factId, deliveryCount, headers = {} }: DirectMeta) => {
    const meta = { messageId, factId, deliveryCount, headers };
    const run = await messageRunOf(written, { body, meta }, checkedBody);
    return messageAnswerOf(written.element, run);
  };
}

function standardsOf(directCall: DirectCall<object> | undefined): StandardRejections {
  if (directCall?.contract === undefined) {
    return standardRejectionDefaults;
  }
  return standardRejectionsOf(directCall.contract);
}

const notImplementedStub: Implementation = () => reject(notImplemented);

function messageStubOf(element: MessageElement): Implementation {
  return () => {
    throw new Error(`${elementNameOf(element)}'s Handler is a stub, which consume never runs`);
  };
}
