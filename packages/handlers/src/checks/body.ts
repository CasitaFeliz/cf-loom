import { encodedValueOf } from '@cf-loom/contract/internal';
import type * as core from 'zod/v4/core';
import { type Checked, checkedPart, issueAt } from './checked.ts';

/**
 * A Message body given as a Subscriber reads it, written back through its Reader schema as it
 * travels, then read with that schema as `consume` reads a received one; its Issues sit at `body`.
 */
export function checkedBody(reader: core.$ZodType, body: unknown): Checked<unknown> {
  const written = encodedValueOf(reader, body);
  if (written.kind === 'issues') {
    return { kind: 'issues', issues: written.issues.map((issue) => issueAt('body', [], issue)) };
  }
  return checkedPart('body', reader, { value: written.value });
}
