import type { Endpoint, Guard } from '@cf-loom/contract';
import { notImplemented } from '@cf-loom/contract';
import { isCommand, isEndpoint, isGuard, type Refusal } from '@cf-loom/contract/internal';
import {
  answerOf,
  type DirectMeta,
  defaultedMetaOf,
  endpointRunOf,
  guardRunOf,
  type Implementation,
  isPairing,
  type MessageHandled,
  type MessageWritten,
  messageAnswerOf,
  messageRunOf,
  nameOf,
  type Pairing,
  type Written,
} from '../calls/index.ts';
import { checkedBody, type HandledRequest } from '../checks/index.ts';
import { reject } from '../outcomes/index.ts';
import type {
  EndpointHandler,
  EndpointImplementation,
  GuardHandler,
  GuardImplementation,
} from './handler.ts';
import type { MessageHandler, MessageImplementation } from './message-handler.ts';
import type {
  LastNotAnnotated,
  NoResources,
  ResourcesLast,
  TakenResourcesOf,
} from './resources.ts';
import {
  type AnyHandler,
  type AnyWritten,
  isEndpointWritten,
  isGuardWritten,
  register,
} from './written.ts';

/** What `handle()` writes a Handler for: an Endpoint, a Guard, or a Command or Subscription with its Reader, as the readers file pairs them. */
type HandleTarget = Endpoint | Guard | Pairing;

/** What `handle()` may be given: a target, or a bare Command or Subscription, which its types refuse. */
type HandleArgument = HandleTarget | MessageHandled;

/** What a bare Command or Subscription is told: its Handler is written for its pairing in the readers file. */
type BareMessageRefusal =
  Refusal<'A Message Handler takes its pairing from the readers file (readers.generated.ts by default): readers.commands.<name> or readers.subscriptions.<name>'>;

/** The function `handle()` wraps for a target: the implementation its Endpoint, Guard, Command or Subscription takes. */
type ImplementationOf<
  Target extends HandleArgument,
  Last extends ResourcesLast<Last>,
> = Target extends Endpoint
  ? EndpointImplementation<Target, Last>
  : Target extends Guard
    ? GuardImplementation<Target, Last>
    : Target extends Pairing
      ? MessageImplementation<Target, Last>
      : never;

/** The Handler `handle()` and `handle.stub()` return for a target, nominal over what it was written for. */
type HandlerOf<Target extends HandleArgument, Resources extends object> = Target extends Endpoint
  ? EndpointHandler<Target, Resources>
  : Target extends Guard
    ? GuardHandler<Target, Resources>
    : Target extends Pairing
      ? MessageHandler<Target, Resources>
      : never;

/** The type `handle()` takes a target as: itself, or the refusal for a Command or Subscription that is not paired. */
type TargetOf<Target extends HandleArgument> = Target extends MessageHandled
  ? BareMessageRefusal
  : Target;

function handleImplementation<
  Target extends HandleArgument,
  Last extends ResourcesLast<Last> = LastNotAnnotated,
>(
  target: TargetOf<Target>,
  implementation: ImplementationOf<Target, Last>,
): HandlerOf<Target, TakenResourcesOf<Last>> {
  const how = { implementation: implementation as Implementation, stub: false };
  return handlerOf(target, how) as HandlerOf<Target, TakenResourcesOf<Last>>;
}

function stubOf<Target extends HandleArgument>(
  target: TargetOf<Target>,
): HandlerOf<Target, NoResources> {
  const implementation = isPairing(target) ? messageStubOf(target.declaration) : notImplementedStub;
  return handlerOf(target, { implementation, stub: true }) as HandlerOf<Target, NoResources>;
}

/**
 * Wraps the implementation of an Endpoint, a Guard, or a Command or Subscription with its Reader
 * (`readers.commands.chargeCardV1` of the readers file), as its Handler: the function the runtime
 * and a test call.
 */
export const handle = Object.assign(handleImplementation, {
  /** A Handler not written yet: it answers the not-implemented Rejection, so the Release deploys; a Message Handler's throws, since `consume` never runs it. */
  stub: stubOf,
});

/** The Handler of a declaration: its direct call, carrying its `declaration`, kept with what it was written with. */
function handlerOf(
  target: unknown,
  how: Pick<Written<Endpoint>, 'implementation' | 'stub'>,
): AnyHandler {
  const written = writtenFor(target, how);
  const handler: AnyHandler = Object.freeze(
    Object.assign(directCallOf(written), { declaration: written.declaration }),
  );
  register(handler, written);
  return handler;
}

function writtenFor(
  target: unknown,
  how: Pick<Written<Endpoint>, 'implementation' | 'stub'>,
): AnyWritten {
  if (isEndpoint(target)) {
    return { declaration: target, ...how };
  }
  if (isGuard(target)) {
    return { declaration: target, ...how };
  }
  if (isPairing(target)) {
    return { declaration: target.declaration, pairing: target, ...how };
  }
  throw new Error(
    'handle() takes an Endpoint or a Guard, or a Command or Subscription paired with its Reader, as the readers file exports it: readers.commands.<name> or readers.subscriptions.<name>',
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

/** What a direct call is given beside its Input or demands, before it is checked. */
type DirectCallGiven = {
  readonly context?: unknown;
  readonly qualifier?: unknown;
  readonly request?: Partial<HandledRequest>;
};

/** What a direct call is given last, before it is checked: the Resources, passed on unchecked. */
type DirectLastGiven = { readonly resources?: unknown };

function endpointCallOf(written: Written<Endpoint>) {
  return async (input: unknown, call: DirectCallGiven, last?: DirectLastGiven) => {
    const given = { input, context: call.context, request: requestOf(call) };
    const run = await endpointRunOf(written, { ...given, resources: last?.resources });
    return answerOf(written.declaration, run);
  };
}

function guardCallOf(written: Written<Guard>) {
  return async (demands: unknown, call: DirectCallGiven, last?: DirectLastGiven) => {
    const { qualifier } = call;
    const given = { demands, context: call.context, qualifier, request: requestOf(call) };
    const run = await guardRunOf(written, { ...given, resources: last?.resources });
    return answerOf(written.declaration, run);
  };
}

/** The request a direct call gives its Handler: a signal never aborted and empty headers, unless given. */
function requestOf({ request }: DirectCallGiven): HandledRequest {
  return {
    signal: request?.signal ?? new AbortController().signal,
    headers: request?.headers ?? new Headers(),
  };
}

function messageCallOf(written: MessageWritten) {
  const { declaration } = written;
  const message = isCommand(declaration) ? declaration : declaration.event;
  return async (body: unknown, given: DirectMeta = {}, last?: DirectLastGiven) => {
    const meta = defaultedMetaOf(message, given);
    const run = await messageRunOf(
      written,
      { body, meta, resources: last?.resources },
      checkedBody,
    );
    return messageAnswerOf(written.declaration, run);
  };
}

const notImplementedStub: Implementation = () => reject(notImplemented);

function messageStubOf(declaration: MessageHandled): Implementation {
  return () => {
    throw new Error(`${nameOf(declaration)}'s Handler is a Stub, which consume never runs`);
  };
}
