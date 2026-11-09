import { follows, kebabCase, ruleOf } from '../declarations/index.ts';
import type { Problem } from '../validation/index.ts';
import type { Path } from '../walker/index.ts';
import {
  type DurableConsumed,
  type RoutedMessage,
  readDurableName,
  readStreamName,
  readSubject,
  unprefixedNameOf,
  unprefixedSubjectOf,
} from '../wire/index.ts';
import type { BrokerPlan, BrokerPlanDurableConsumer, BrokerPlanStream } from './broker-plan.ts';

/** A text of the plan read back as `Value`, or the place where it does not read back. */
export type Reading<Value> =
  | { readonly kind: 'read'; readonly value: Value }
  | { readonly kind: 'unread'; readonly problem: Problem };

/** A Message Version a subject of the plan reads back as, with the Service whose subject it is. */
type ReadSubject = { readonly service: string } & RoutedMessage;

/** A Stream of the plan with its subjects read back. */
type ReadStream = { readonly service: string; readonly subjects: readonly ReadSubject[] };

/** A Durable consumer of the plan with what it consumes and the subject it filters on read back. */
type ReadConsumer = {
  readonly service: string;
  readonly consumed: DurableConsumed;
  readonly subject: ReadSubject;
};

/** A plan with every text of it read back, in the order the plan lists them. */
export type ReadPlan = {
  readonly streams: readonly ReadStream[];
  readonly consumers: readonly ReadConsumer[];
};

/** How a kind of text of the plan is read back: the prefix it carries, the names it is built from and the reason when it is none. */
type TextKind<Value> = {
  readonly unprefixed: (prefix: string | null, text: string) => string | undefined;
  readonly read: (text: string) => Value | undefined;
  readonly reason: string;
};

/** Why a text is no Stream name of the plan, which a key no object can hold is refused with. */
export const notStreamName = 'is not a Stream name: a Service name after the prefix';

/** Why a text is no Durable consumer name of the plan. */
export const notDurableConsumerName =
  'is not a Durable consumer name: a Service name, then a Subscription name or a Command Version';

const streamName: TextKind<{ readonly service: string }> = {
  unprefixed: unprefixedNameOf,
  read: readStreamName,
  reason: notStreamName,
};

const durableConsumerName: TextKind<{
  readonly service: string;
  readonly consumed: DurableConsumed;
}> = {
  unprefixed: unprefixedNameOf,
  read: readDurableName,
  reason: notDurableConsumerName,
};

const serviceName: TextKind<string> = {
  unprefixed: (_prefix, text) => text,
  read: (text) => (follows(kebabCase, text) ? text : undefined),
  reason: `is not a Service name, ${ruleOf(kebabCase)}`,
};

const subject: TextKind<ReadSubject> = {
  unprefixed: unprefixedSubjectOf,
  read: readSubject,
  reason: 'is not a subject: a Service name, event or command, a Message name and its version',
};

/** Where a text sits in the plan, and the text. */
type Site = { readonly at: Path; readonly text: string };

function readText<Value>(kind: TextKind<Value>, prefix: string | null, site: Site): Reading<Value> {
  const unprefixed = kind.unprefixed(prefix, site.text);
  if (unprefixed === undefined) {
    return unread(site.at, `does not carry the prefix ${prefix}`);
  }
  const value = kind.read(unprefixed);
  return value === undefined ? unread(site.at, kind.reason) : { kind: 'read', value };
}

function unread(at: Path, reason: string): Reading<never> {
  return { kind: 'unread', problem: { at, reason } };
}

/** Every Stream and Durable consumer of the plan with its texts read back, or the first text that does not read back, in document order. */
export function readPlan(plan: BrokerPlan): Reading<ReadPlan> {
  const streams = readEntries(plan.streams, (name, stream) =>
    readStream(plan.prefix, name, stream),
  );
  if (streams.kind === 'unread') {
    return streams;
  }
  const consumers = readEntries(plan.durableConsumers, (name, consumer) =>
    readConsumer(plan.prefix, name, consumer),
  );
  if (consumers.kind === 'unread') {
    return consumers;
  }
  return { kind: 'read', value: { streams: streams.value, consumers: consumers.value } };
}

function readEntries<Entry, Read>(
  entries: Readonly<Record<string, Entry>>,
  read: (name: string, entry: Entry) => Reading<Read>,
): Reading<readonly Read[]> {
  const reads: Read[] = [];
  for (const [name, entry] of Object.entries(entries)) {
    const reading = read(name, entry);
    if (reading.kind === 'unread') {
      return reading;
    }
    reads.push(reading.value);
  }
  return { kind: 'read', value: reads };
}

function readStream(
  prefix: string | null,
  name: string,
  stream: BrokerPlanStream,
): Reading<ReadStream> {
  const at: Path = ['streams', name];
  const key = readText(streamName, prefix, { at, text: name });
  if (key.kind === 'unread') {
    return key;
  }
  const service = readText(serviceName, prefix, { at: [...at, 'service'], text: stream.service });
  if (service.kind === 'unread') {
    return service;
  }
  const subjects: ReadSubject[] = [];
  for (const [index, text] of stream.subjects.entries()) {
    const reading = readText(subject, prefix, { at: [...at, 'subjects', index], text });
    if (reading.kind === 'unread') {
      return reading;
    }
    subjects.push(reading.value);
  }
  return { kind: 'read', value: { service: service.value, subjects } };
}

function readConsumer(
  prefix: string | null,
  name: string,
  consumer: BrokerPlanDurableConsumer,
): Reading<ReadConsumer> {
  const at: Path = ['durableConsumers', name];
  const key = readText(durableConsumerName, prefix, { at, text: name });
  const service = readText(serviceName, prefix, { at: [...at, 'service'], text: consumer.service });
  const stream = readText(streamName, prefix, { at: [...at, 'stream'], text: consumer.stream });
  const filter = readText(subject, prefix, { at: [...at, 'subject'], text: consumer.subject });
  if (key.kind === 'unread') {
    return key;
  }
  if (service.kind === 'unread') {
    return service;
  }
  if (stream.kind === 'unread') {
    return stream;
  }
  if (filter.kind === 'unread') {
    return filter;
  }
  const { consumed } = key.value;
  return { kind: 'read', value: { service: service.value, consumed, subject: filter.value } };
}
