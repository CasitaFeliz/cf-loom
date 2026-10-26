import { safeParse } from 'zod/v4/core';
import type { Attachment, Guard } from '../declarations/index.ts';
import { isDeclaration, isGuard } from '../declarations/index.ts';
import { fieldStep, indexStep, inFields, inside, type Place } from '../walker/index.ts';
import {
  attachedGuardOf,
  isPlainObject,
  isSchema,
  isWithoutValue,
  type LocatedEndpoint,
  type LocatedGuard,
  listOf,
  textOf,
} from '../written/index.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import { strippedKeysOf } from './qualifiers.ts';
import type { Nodes } from './schemas.ts';

/** An Attachment of an Endpoint, where it sits, and the Guard it names when it names one. */
type Listed = {
  readonly at: Place;
  readonly attachment: Attachment;
  readonly guard: Guard | undefined;
};

/** An Attachment that names a Guard. */
type Attached = Listed & { readonly guard: Guard };

/** A qualified Attachment: `{ guard, qualifier }`. */
type Qualified = Attached & { readonly attachment: { readonly qualifier: unknown } };

/** A Guard demands only headers and query: the path and the body are the Endpoint's alone. */
export function guardFailures({ at, guard }: LocatedGuard): readonly DeclarationFailure[] {
  const demands = guard.demands;
  if (typeof demands !== 'object' || demands === null) {
    return [];
  }
  const refused = (['params', 'body'] as const).filter((part) => demands[part] !== undefined);
  return refused.map((part) =>
    failure(
      inFields(at, 'demands', part),
      'guard-demands',
      'A Guard demands only headers and query',
    ),
  );
}

/** Each Guard is listed once, bare or qualified as it declares, after every Guard it names. */
export function attachmentFailures({
  at,
  endpoint,
}: LocatedEndpoint): readonly DeclarationFailure[] {
  const failures: DeclarationFailure[] = [];
  const earlier: string[] = [];
  for (const { at: attachedAt, attachment, guard } of listedOf(at, endpoint)) {
    if (guard === undefined) {
      failures.push(...noAttachmentFailures(attachedAt, attachment));
      continue;
    }
    failures.push(...shapeFailures({ at: attachedAt, attachment, guard }));
    failures.push(...orderFailures({ at: attachedAt, attachment, guard }, earlier));
    earlier.push(textOf(guard.name));
  }
  return failures;
}

/** What names no Guard is no Attachment, unless it is an object whose `guard` the field rule reports. */
function noAttachmentFailures(at: Place, attachment: unknown): readonly DeclarationFailure[] {
  const judgedByFields =
    isPlainObject(attachment) && !isDeclaration(attachment) && isWithoutValue(attachment['guard']);
  if (judgedByFields) {
    return [];
  }
  return [failure(at, 'not-an-attachment', 'An Attachment is a Guard or { guard, qualifier }')];
}

/** A Qualifier is a value its schema accepts whose parse drops no key. */
export function qualifierFailures(
  located: LocatedEndpoint,
  nodes: Nodes,
): readonly DeclarationFailure[] {
  return listedOf(located.at, located.endpoint)
    .filter(isQualified)
    .flatMap((qualified) => valueFailures(qualified, nodes));
}

function listedOf(at: Place, endpoint: LocatedEndpoint['endpoint']): readonly Listed[] {
  return listOf(endpoint.guards).map((attachment, index) => ({
    at: inside(at, fieldStep('guards'), indexStep(index)),
    attachment,
    guard: attachedGuardOf(attachment),
  }));
}

/**
 * Only a Qualifier whose schema walked is parsed: a walked schema holds no transform, default or
 * catch, so its parse differs from the value only by the keys it strips.
 */
function valueFailures(
  { at, attachment, guard }: Qualified,
  nodes: Nodes,
): readonly DeclarationFailure[] {
  const isWalked = nodes.nodeOf(guard, 'qualifier') !== undefined;
  if (guard.qualifier === undefined || !isWalked || isWithoutValue(attachment.qualifier)) {
    return [];
  }
  const qualifierAt = inFields(at, 'qualifier');
  const parsed = safeParse(guard.qualifier, attachment.qualifier);
  if (!parsed.success) {
    const message = `${textOf(guard.name)} takes a Qualifier its schema accepts`;
    return [failure(qualifierAt, 'qualifier-value', message)];
  }
  const stripped = strippedKeysOf(attachment.qualifier, parsed.data);
  if (stripped.length === 0) {
    return [];
  }
  const keys = stripped.join(', ');
  const message = `A Qualifier holds only the keys its schema keeps when zod parses it: ${keys}`;
  return [failure(qualifierAt, 'qualifier-keys', message)];
}

/** A Guard whose `qualifier` is no schema is the schema rule's; its Attachments are not judged. */
function shapeFailures({ at, attachment, guard }: Attached): readonly DeclarationFailure[] {
  const declaresQualifier = guard.qualifier !== undefined;
  if (declaresQualifier && !isSchema(guard.qualifier)) {
    return [];
  }
  if (isGuard(attachment) && declaresQualifier) {
    const message = `${textOf(guard.name)} needs a qualifier: { guard, qualifier }`;
    return [failure(at, 'attachment-needs-qualifier', message)];
  }
  if (!isGuard(attachment) && !declaresQualifier) {
    const message = `${textOf(guard.name)} takes no qualifier`;
    return [failure(at, 'attachment-takes-no-qualifier', message)];
  }
  return [];
}

function orderFailures(
  { at, guard }: Attached,
  earlier: readonly string[],
): readonly DeclarationFailure[] {
  if (earlier.includes(textOf(guard.name))) {
    return [failure(at, 'guard-once', `${textOf(guard.name)} is listed twice`)];
  }
  const required = listOf(guard.guards)
    .filter(isGuard)
    .map((listed) => textOf(listed.name));
  const missing = required.filter((name) => !earlier.includes(name));
  if (missing.length === 0) {
    return [];
  }
  const message = `${textOf(guard.name)} requires ${missing.join(', ')} earlier in guards`;
  return [failure(at, 'guard-order', message)];
}

function isQualified(listed: Listed): listed is Qualified {
  return listed.guard !== undefined && !isGuard(listed.attachment);
}
