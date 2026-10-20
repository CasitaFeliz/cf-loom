import type { Command, Subscription } from '@cf-loom/contract';
import type * as core from 'zod/v4/core';
import type { MessageMeta } from '../calls/index.ts';
import type { Fault } from '../outcomes/index.ts';
import type { WithReader } from './reader.ts';

/** The body a Message Handler reads, as a Subscriber reads it: its Reader schema's output, Unknown cases included. */
type ReadBodyOf<Target extends WithReader> = core.output<Target['reader']>;

/** The meta a direct call takes: `headers` left out is `{}`. */
export type DirectMeta = Omit<MessageMeta, 'headers'> & {
  readonly headers?: MessageMeta['headers'];
};

/** What a Message Handler's implementation answers: nothing, which acknowledges the Message, or a Fault. */
// biome-ignore lint/suspicious/noConfusingVoidType: an implementation that returns no value returns nothing
type Answered = void | Fault;

/** What a CommandHandler's implementation returns: nothing, which acknowledges the Command, or a Fault; may be async. */
export type CommandImplementation<Target extends WithReader<Command>> = (
  body: ReadBodyOf<Target>,
  meta: MessageMeta,
) => Answered | Promise<Answered>;

/** What an EventHandler's implementation returns: nothing, which acknowledges the Event, or a Fault; may be async. */
export type EventImplementation<Target extends WithReader<Subscription>> = (
  body: ReadBodyOf<Target>,
  meta: MessageMeta,
) => Answered | Promise<Answered>;

/** The Handler of a Command's Message Version: calling it reads the body as `consume` would, and answers nothing or the Fault it returned. */
export type CommandHandler<Target extends WithReader<Command>> = {
  (body: ReadBodyOf<Target>, meta: DirectMeta): Promise<Fault | undefined>;
  readonly element: Target['element'];
};

/** The Handler of a Subscription: calling it reads the body as `consume` would, and answers nothing or the Fault it returned. */
export type EventHandler<Target extends WithReader<Subscription>> = {
  (body: ReadBodyOf<Target>, meta: DirectMeta): Promise<Fault | undefined>;
  readonly element: Target['element'];
};
