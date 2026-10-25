/** Thrown by `publish`, `send` and `consume` once messaging is closed, and by `consume` while it is closing. */
export class MessagingClosedError extends Error {
  override readonly name = 'MessagingClosedError';

  constructor(state: 'closing' | 'closed') {
    super(`messaging is ${state}`);
  }
}
