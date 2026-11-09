import { joinedOf, unbrokenLineOf } from '@cf-loom/contract/internal';
/** Thrown by `publish`, `send` and `consume` once messaging is closed, and by `consume` while it is closing. */
export class MessagingClosedError extends Error {
  override readonly name = 'MessagingClosedError';

  constructor(state: 'closing' | 'closed') {
    super(unbrokenLineOf(`messaging is ${state}`));
  }
}

/** What `close` may take: a signal that, once aborted, stops it waiting. */
export type CloseOptions = { readonly signal?: AbortSignal | undefined };

/** A Message `close` handed back: the Subscription or Command Version it was delivered for, its subject and its ids. */
export type HandedBack = {
  readonly name: string;
  readonly subject: string;
  readonly messageId: string;
  readonly factId: string;
};

/** Thrown by `close` when its signal aborted while deliveries were still settling: the Messages handed back, its `cause` the signal's reason. */
export class CloseAbortedError extends Error {
  override readonly name = 'CloseAbortedError';
  readonly handedBack: readonly HandedBack[];

  constructor(handedBack: readonly HandedBack[], reason: unknown) {
    const count = handedBack.length === 1 ? '1 Message' : `${handedBack.length} Messages`;
    const named = handedBack.map(({ name, subject, messageId, factId }) =>
      [name, subject, messageId, factId].join(' '),
    );
    super(
      unbrokenLineOf(`close stopped waiting and handed back ${count}: ${joinedOf(named, 'and')}`),
      {
        cause: reason,
      },
    );
    this.handedBack = handedBack;
  }
}
