import type { Closed } from '@cf-loom/contract/internal';
import type * as core from 'zod/v4/core';
import type { DirectMeta, MessageMeta, Pairing } from '../calls/index.ts';
import type { Fault } from '../outcomes/index.ts';
import type { HandledBy } from './handler.ts';
import type {
  CallArgument,
  LastNotAnnotated,
  NoResources,
  ResourcesField,
  ResourcesLast,
} from './resources.ts';

/**
 * The body a Message Handler receives, as its pairing's Reader schema reads it: Unknown cases included,
 * so a helper it calls is typed by what any later compatible version may send.
 */
export type ReceivedBodyOf<Target extends Pairing> = core.output<Target['reader']>;

/** The Fault a Message Handler returns: a `Fault` with no `retryAfter`, since the Durable consumer's configuration decides redelivery. */
export type MessageFault = Fault & { readonly retryAfter?: never };

/** What a Message Handler's implementation answers: nothing, which acknowledges the Message, or a MessageFault. */
type Answered = undefined | MessageFault;

/** What a Message Handler's implementation returns, given the body as its Reader reads it, its meta, and last the Resources it takes, `Needs<'payments'>`: nothing, which acknowledges the Message, or a `MessageFault`; may be async. */
export type MessageImplementation<
  Target extends Pairing,
  Last extends ResourcesLast<Last> = LastNotAnnotated,
> = (body: ReceivedBodyOf<Target>, meta: MessageMeta, last: Last) => Answered | Promise<Answered>;

/** The Handler of a Command's Message Version or of a Subscription, written for its pairing in the readers file: calling it reads the body as `consume` would, and answers nothing or the Fault it returned. */
export type MessageHandler<Target extends Pairing, Resources extends object = NoResources> = (<
  const Given = unknown,
  const GivenLast = unknown,
>(
  body: ReceivedBodyOf<Target>,
  meta?: Closed<Given, DirectMeta>,
  ...last: CallArgument<GivenLast, ResourcesField<Resources>>
) => Promise<Fault | undefined>) &
  HandledBy<Target['declaration'], Resources>;
