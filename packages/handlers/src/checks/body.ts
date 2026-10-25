import { type Checked, parsedPartOf, writtenPartOf } from '@cf-loom/contract/internal';
import type * as core from 'zod/v4/core';

/**
 * A Message body given as a Subscriber reads it, written back through its Reader schema as it
 * travels, then read with that schema as `consume` reads a received one; its Issues sit at `body`.
 */
export function checkedBody(reader: core.$ZodType, body: unknown): Checked<unknown> {
  const written = writtenMessageBody(reader, body);
  if (written.kind === 'issues') {
    return written;
  }
  return checkedMessageBody(reader, written.value);
}

/** A Message body given as a Subscriber reads it, written back through its Reader schema as it travels; its Issues sit at `body`. */
export function writtenMessageBody(reader: core.$ZodType, body: unknown): Checked<unknown> {
  return writtenPartOf('body', reader, { value: body });
}

/**
 * A Message body checked with one schema alone: a writer's before it is sent, or a Reader's as it
 * is received; its Issues sit at `body`.
 */
export function checkedMessageBody(schema: core.$ZodType, body: unknown): Checked<unknown> {
  return parsedPartOf('body', schema, { value: body });
}
