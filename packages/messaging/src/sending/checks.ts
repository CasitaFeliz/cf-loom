import type { Command, Event } from '@cf-loom/contract';
import {
  brokerHeaderBytesOf,
  isIdHeaderValue,
  maxBrokerHeaderBytes,
  messageIdentityOf,
  transportHeaderFitOf,
} from '@cf-loom/contract/internal';
import type { OutgoingMessage } from '../broker/index.ts';
import type { InvalidPart } from './errors.ts';

/** The parts of a Message its broker headers are written from. */
export type HeaderParts = Pick<OutgoingMessage, 'messageId' | 'factId' | 'headers'>;

/** Transport headers as a call gives them, an `undefined` one meaning left out. */
export type GivenHeaders = Readonly<Record<string, string | undefined>>;

/** An id that travels in a header, refused when it would not arrive as given. */
export function idPartsOf(at: 'factId' | 'messageId', id: string): readonly InvalidPart[] {
  return isIdHeaderValue(id) ? [] : [{ kind: 'id', at }];
}

/** The transport headers that travel, those left `undefined` dropped, and each of the rest that would not arrive as given. */
export function headerPartsOf(given: GivenHeaders): {
  readonly headers: Readonly<Record<string, string>>;
  readonly invalid: readonly InvalidPart[];
} {
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

/** A Message Version's broker headers, refused when they take more bytes than JetStream stores. */
export function sizePartsOf(version: Event | Command, parts: HeaderParts): readonly InvalidPart[] {
  const bytes = brokerHeaderBytesOf(parts);
  if (bytes <= maxBrokerHeaderBytes) {
    return [];
  }
  return [{ kind: 'too-large', identity: messageIdentityOf(version.name, version.version), bytes }];
}
