import {
  issueLineOf,
  linesTextOf,
  maxBrokerHeaderBytes,
  type TransportHeaderFit,
  unbrokenLineOf,
} from '@cf-loom/contract/internal';
import type { Issue } from '@cf-loom/handlers';

/** What of a `publish`, `send` or `deliver` call was refused before anything was sent. */
export type InvalidPart =
  | { readonly kind: 'body'; readonly identity: string; readonly issues: readonly Issue[] }
  | { readonly kind: 'id'; readonly at: 'factId' | 'messageId' }
  | {
      readonly kind: 'header';
      readonly name: string;
      readonly fit: Exclude<TransportHeaderFit, 'travels'>;
    }
  | { readonly kind: 'too-large'; readonly identity: string; readonly bytes: number };

/**
 * Thrown by `publish` or `send` when the call breaks a rule, and by `deliver` for a refused id,
 * header or header bytes; nothing was sent, and the same call always fails.
 */
export class InvalidMessageError extends Error {
  override readonly name = 'InvalidMessageError';
  readonly invalid: readonly InvalidPart[];

  constructor(invalid: readonly InvalidPart[]) {
    super(linesTextOf(invalid.flatMap(linesOf)));
    this.invalid = invalid;
  }
}

/** Thrown by `publish` or `send` when the Broker failed: the Fact id to retry the whole call with and the versions already sent. */
export class MessageNotSentError extends Error {
  override readonly name = 'MessageNotSentError';
  readonly factId: string;
  readonly sent: readonly string[];

  constructor(
    name: string,
    attempted: { readonly factId: string; readonly sent: readonly string[] },
    cause: unknown,
  ) {
    const sent = attempted.sent.length === 0 ? 'none' : attempted.sent.join(', ');
    const message = `${name} with Fact id ${attempted.factId} was not sent whole; sent: ${sent}`;
    super(unbrokenLineOf(message), { cause });
    this.factId = attempted.factId;
    this.sent = attempted.sent;
  }
}

const idRule =
  'a non-empty string with no CR or LF, no whitespace leading or trailing and no lone surrogate';

function linesOf(part: InvalidPart): readonly string[] {
  switch (part.kind) {
    case 'body':
      return part.issues.map((issue) => issueLineOf(part.identity, issue));
    case 'id':
      return [idLineOf(part.at)];
    case 'header':
      return [headerLineOf(part.name, part.fit)];
    case 'too-large':
      return [
        `${part.identity}: The broker headers would take ${part.bytes} bytes, over the ${maxBrokerHeaderBytes} JetStream stores; the Fact id counts twice, in Cf-Loom-Fact-Id and in Nats-Msg-Id`,
      ];
  }
}

function idLineOf(at: 'factId' | 'messageId'): string {
  switch (at) {
    case 'factId':
      return `factId: A Fact id is ${idRule}`;
    case 'messageId':
      return `messageId: A broker message id is ${idRule}`;
  }
}

function headerLineOf(name: string, fit: Exclude<TransportHeaderFit, 'travels'>): string {
  switch (fit) {
    case 'reserved-name':
      return `headers.${name}: The transport header ${name} takes a name cf-loom or NATS reserves: any starting with Cf-Loom- or Nats-`;
    case 'uncarried-name': {
      const quoted = JSON.stringify(name);
      return `headers.${quoted}: The transport header name ${quoted} cannot travel over NATS: it is empty or holds a colon, a space, a control or a non-ASCII character`;
    }
    case 'uncarried-value':
      return `headers.${name}: The transport header ${name} has a value that would not arrive as given over NATS: not a string, a CR or LF, whitespace leading or trailing, or a lone surrogate`;
  }
}
