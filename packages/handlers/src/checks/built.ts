import type { Endpoint, Guard } from '@casitafeliz/loom-contract';
import {
  attachedGuardsOf,
  isEndpoint,
  isRejection,
  isStandardRejection,
} from '@casitafeliz/loom-contract/internal';
import type { Answerable } from '../outcomes/index.ts';
import {
  type Checked,
  checkedSlots,
  fieldOf,
  type Issue,
  noValueIssue,
  type Slot,
  withIssues,
} from './checked.ts';

/** A Success as `serve` sends it: the declared status, with the parsed headers and body it declares. */
export type CheckedSuccess = {
  readonly kind: 'success';
  readonly status: number;
  readonly headers?: unknown;
  readonly body?: unknown;
};

/** A Rejection as a Handler built it, its body parsed when it declares one. */
export type CheckedRejection = {
  readonly kind: 'rejection';
  readonly rejection: Answerable;
  readonly body?: unknown;
};

/**
 * The value a Handler gave `success()`, read by its Endpoint: the body, or `{ headers, body }`
 * when the Endpoint declares headers.
 */
export function checkedSuccess(endpoint: Endpoint, value: unknown): Checked<CheckedSuccess> {
  const { status, headers, body } = endpoint.success;
  const given = headers === undefined ? { body: value } : value;
  const slots: Slot[] = [];
  if (headers !== undefined) {
    slots.push(slotOf({ key: 'headers', part: 'success.headers', schema: headers }, given));
  }
  if (body !== undefined) {
    slots.push(slotOf({ key: 'body', part: 'success.body', schema: body }, given));
  }
  const misplaced = body === undefined && fieldOf(given, 'body') !== undefined;
  const checked = withIssues(checkedSlots(slots), misplaced ? [noValueIssue('success.body')] : []);
  if (checked.kind === 'issues') {
    return checked;
  }
  return { kind: 'value', value: { kind: 'success', status, ...checked.value } };
}

/** A Rejection a Handler built: one its Element answers, with the body it declares and no other. */
export function checkedRejection(
  element: Endpoint | Guard,
  built: CheckedRejection,
): Checked<CheckedRejection> {
  const { rejection } = built;
  if (!answeredRejectionsOf(element).includes(rejection) && !isNotImplemented(rejection)) {
    return { kind: 'issues', issues: [notAnsweredIssue(element, rejection)] };
  }
  const schema = isRejection(rejection) ? rejection.body : undefined;
  if (schema !== undefined) {
    const checked = checkedSlots([slotOf({ key: 'body', part: 'body', schema: schema }, built)]);
    return checked.kind === 'issues'
      ? checked
      : { kind: 'value', value: { ...built, ...checked.value } };
  }
  if ('body' in built) {
    return { kind: 'issues', issues: [noValueIssue('body')] };
  }
  return { kind: 'value', value: built };
}

/** The Context a GuardHandler admitted, parsed with its Guard's `context` schema; none without one. */
export function checkedAdmitted(guard: Guard, context: unknown): Checked<unknown> {
  if (guard.context === undefined) {
    return context === undefined
      ? { kind: 'value', value: undefined }
      : { kind: 'issues', issues: [noValueIssue('context')] };
  }
  const checked = checkedSlots([
    slotOf({ key: 'context', part: 'context', schema: guard.context }, { context }),
  ]);
  return checked.kind === 'issues' ? checked : { kind: 'value', value: checked.value['context'] };
}

function slotOf(
  { key, part, schema }: Pick<Slot, 'key' | 'part' | 'schema'>,
  given: unknown,
): Slot {
  return { key, part, at: [], schema, value: fieldOf(given, key) };
}

/** The Rejections an Element lists: an Endpoint's own and its Guards', or a Guard's own. */
function answeredRejectionsOf(element: Endpoint | Guard): readonly unknown[] {
  if (!isEndpoint(element)) {
    return element.rejections ?? [];
  }
  const guards = attachedGuardsOf(element);
  return [...(element.rejections ?? []), ...guards.flatMap((guard) => guard.rejections ?? [])];
}

/** The not-implemented Rejection, which every Endpoint and Guard answers as a stub. */
function isNotImplemented(rejection: unknown): boolean {
  return isStandardRejection(rejection) && rejection.name === 'notImplemented';
}

function notAnsweredIssue(element: Endpoint | Guard, rejection: unknown): Issue {
  const message = `${codeOf(rejection)} is not a Rejection ${element.name} answers`;
  return { part: 'rejections', path: [], code: 'invalid_value', message };
}

function codeOf(rejection: unknown): string {
  if (isRejection(rejection)) {
    return rejection.code;
  }
  return isStandardRejection(rejection) ? rejection.name : 'A value that is no Rejection';
}
