import type { Command, Event } from '@cf-loom/contract';
import {
  brokerHeaderBytesOf,
  isIdHeaderValue,
  maxBrokerHeaderBytes,
  messageIdentityOf,
  transportHeaderFitOf,
} from '@cf-loom/contract/internal';
import type { InvalidPart } from './errors.ts';

/** Transport headers as a call gives them, an `undefined` one meaning left out. */
export type GivenHeaders = Readonly<Record<string, string | undefined>>;

/** The ids a caller gave, each checked; one it left out is the core's own, which always travels. */
export type GivenIds = {
  readonly factId?: string | undefined;
  readonly messageId?: string | undefined;
};

/** One Message whose broker headers are measured: its Message Version and its ids. */
export type Measured = {
  readonly version: Event | Command;
  readonly messageId: string;
  readonly factId: string;
};

/** The transport headers that travel, and every part refused: the ids given, then each header, then each Message whose broker headers are too large. */
export type CheckedHeaders = {
  readonly headers: Readonly<Record<string, string>>;
  readonly invalid: readonly InvalidPart[];
};

/** The broker headers of one call's Messages, checked as NATS carries them, every refused part listed in one order. */
export function checkedHeadersOf(
  ids: GivenIds,
  given: GivenHeaders,
  measured: readonly Measured[],
): CheckedHeaders {
  const { headers, invalid: refusedHeaders } = headerPartsOf(given);
  const tooLarge = measured.flatMap((message) => sizePartsOf({ ...message, headers }));
  return { headers, invalid: [...idPartsOf(ids), ...refusedHeaders, ...tooLarge] };
}

function idPartsOf({ factId, messageId }: GivenIds): readonly InvalidPart[] {
  const invalid: InvalidPart[] = [];
  if (factId !== undefined && !isIdHeaderValue(factId)) {
    invalid.push({ kind: 'id', at: 'factId' });
  }
  if (messageId !== undefined && !isIdHeaderValue(messageId)) {
    invalid.push({ kind: 'id', at: 'messageId' });
  }
  return invalid;
}

function headerPartsOf(given: GivenHeaders): CheckedHeaders {
  const headers: Record<string, string> = {};
  const invalid: InvalidPart[] = [];
  for (const [name, value] of Object.entries(given)) {
    if (value === undefined) {
      continue;
    }
    const fit = transportHeaderFitOf(name, value);
    if (fit === 'travels') {
      headers[name] = value;
      continue;
    }
    invalid.push({ kind: 'header', name, fit });
  }
  return { headers, invalid };
}

function sizePartsOf(
  message: Measured & { readonly headers: Readonly<Record<string, string>> },
): readonly InvalidPart[] {
  const { version, messageId, factId, headers } = message;
  const bytes = brokerHeaderBytesOf({ messageId, factId, headers });
  if (bytes <= maxBrokerHeaderBytes) {
    return [];
  }
  return [{ kind: 'too-large', identity: messageIdentityOf(version.name, version.version), bytes }];
}
