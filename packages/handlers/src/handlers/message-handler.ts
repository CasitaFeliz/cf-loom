import type { Command, Subscription } from '@cf-loom/contract';
import type * as core from 'zod/v4/core';
import type { MessageMeta, Pairing } from '../calls/index.ts';
import type { Fault } from '../outcomes/index.ts';
import type { CallArgument, NoResources, ResourcesField } from './resources.ts';

/** The body a Message Handler reads, as a Subscriber reads it: its Reader schema's output, Unknown cases included. */
type ReadBodyOf<Target extends Pairing> = core.output<Target['reader']>;

/** The meta a direct call takes: `lastAttempt` left out is `false`, `headers` left out is `{}`, `signal` left out a signal never aborted. */
export type DirectMeta = Omit<MessageMeta, 'lastAttempt' | 'headers' | 'signal'> & {
  readonly lastAttempt?: MessageMeta['lastAttempt'];
  readonly headers?: MessageMeta['headers'];
  readonly signal?: MessageMeta['signal'];
};

/** The Fault a Message Handler returns: a `Fault` with no `retryAfter`, since the durable consumer's configuration decides redelivery. */
export type MessageFault = Fault & { readonly retryAfter?: never };

/** What a Message Handler's implementation answers: nothing, which acknowledges the Message, or a MessageFault. */
type Answered = undefined | MessageFault;

/** What a CommandHandler's implementation returns, given the body, its meta and the Resources it takes: nothing, which acknowledges the Command, or a `MessageFault`; may be async. */
export type CommandImplementation<
  Target extends Pairing<Command>,
  Resources extends object = NoResources,
> = (
  body: ReadBodyOf<Target>,
  meta: MessageMeta,
  call: MessageCall<Resources>,
) => Answered | Promise<Answered>;

/** What an EventHandler's implementation returns, given the body, its meta and the Resources it takes: nothing, which acknowledges the Event, or a `MessageFault`; may be async. */
export type EventImplementation<
  Target extends Pairing<Subscription>,
  Resources extends object = NoResources,
> = (
  body: ReadBodyOf<Target>,
  meta: MessageMeta,
  call: MessageCall<Resources>,
) => Answered | Promise<Answered>;

/** The last argument of a Message Handler's direct call: the Resources it takes. */
export type MessageCall<Resources extends object = NoResources> = ResourcesField<Resources>;

/** The Handler of a Command's Message Version: calling it reads the body as `consume` would, and answers nothing or the Fault it returned. */
export type CommandHandler<
  Target extends Pairing<Command>,
  Resources extends object = NoResources,
> = {
  (
    body: ReadBodyOf<Target>,
    meta: DirectMeta,
    ...call: CallArgument<MessageCall<Resources>>
  ): Promise<Fault | undefined>;
  readonly element: Target['element'];
};

/** The Handler of a Subscription: calling it reads the body as `consume` would, and answers nothing or the Fault it returned. */
export type EventHandler<
  Target extends Pairing<Subscription>,
  Resources extends object = NoResources,
> = {
  (
    body: ReadBodyOf<Target>,
    meta: DirectMeta,
    ...call: CallArgument<MessageCall<Resources>>
  ): Promise<Fault | undefined>;
  readonly element: Target['element'];
};
