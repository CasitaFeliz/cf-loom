/** The tag holding the full Durable consumer name, which a queue's name may cut. */
export const durableTag = 'cf-loom:durable';

/** The tag holding the plan's `service`, which only narrows a search for leftovers. */
export const serviceTag = 'cf-loom:service';

/** The tag holding the ack waits after the first, as written. */
export const backoffTag = 'cf-loom:backoff';

/** The tag holding the ARN of the queue's subscription. */
export const subscriptionTag = 'cf-loom:subscription';

/** The most characters SQS allows in a tag's value. */
export const longestTagValue = 256;

const backoffSeparator = ' ';

/** The text of the backoff tag: the ack waits after the first, as written, joined by one space. */
export function backoffTextOf(later: readonly string[]): string {
  return later.join(backoffSeparator);
}

/** The ack waits after the first, as the backoff tag's text writes them: the inverse of `backoffTextOf`. */
export function backoffEntriesOf(text: string): readonly string[] {
  return text.split(backoffSeparator);
}

/** What a Durable consumer's queue and dead-letter queue are tagged with. */
export type TaggedDurableConsumer = {
  readonly name: string;
  readonly service: string;
  readonly backoff: string | undefined;
};

/** The tags of a Durable consumer's queue: its name, its Service and its backoff when it has one. */
export function queueTagsOf({ name, service, backoff }: TaggedDurableConsumer) {
  const tags: Record<string, string> = { [durableTag]: name, [serviceTag]: service };
  if (backoff !== undefined) {
    tags[backoffTag] = backoff;
  }
  return tags;
}

/** The tags of a dead-letter queue: its queue's name and Service, no backoff. */
export function deadLetterQueueTagsOf({ name, service }: TaggedDurableConsumer) {
  return { [durableTag]: name, [serviceTag]: service };
}
