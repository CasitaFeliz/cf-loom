import { safeParse } from 'zod/v4/core';
import type { Attachment, Guard } from '../declarations/index.ts';
import { isDeclaration, isGuard } from '../declarations/index.ts';
import type { Path } from '../walker/index.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import type { LocatedEndpoint, LocatedGuard } from './located.ts';
import { undeclaredKeysOf } from './qualifiers.ts';
import { attachedGuardOf } from './references.ts';
import { isSchema, type Nodes } from './schemas.ts';
import { isPlainObject, isWithoutValue, listOf, textOf } from './written.ts';

/** An Attachment of an Endpoint, where it sits, and the Guard it names when it names one. */
type Listed = {
  readonly at: Path;
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
    failure([...at, 'demands', part], 'guard-demands', 'A Guard demands only headers and query'),
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
function noAttachmentFailures(at: Path, attachment: unknown): readonly DeclarationFailure[] {
  const judgedByFields =
    isPlainObject(attachment) && !isDeclaration(attachment) && isWithoutValue(attachment['guard']);
  if (judgedByFields) {
    return [];
  }
  return [failure(at, 'not-an-attachment', 'An Attachment is a Guard or { guard, qualifier }')];
}

/** A Qualifier is a value its schema accepts whose objects hold only the keys it declares. */
export function qualifierFailures(
  located: LocatedEndpoint,
  nodes: Nodes,
): readonly DeclarationFailure[] {
  return listedOf(located.at, located.endpoint)
    .filter(isQualified)
    .flatMap((qualified) => valueFailures(qualified, nodes));
}

function listedOf(at: Path, endpoint: LocatedEndpoint['endpoint']): readonly Listed[] {
  return listOf(endpoint.guards).map((attachment, index) => ({
    at: [...at, 'guards', index],
    attachment,
    guard: attachedGuardOf(attachment),
  }));
}

function valueFailures(
  { at, attachment, guard }: Qualified,
  nodes: Nodes,
): readonly DeclarationFailure[] {
  const node = nodes.nodeOf(guard, 'qualifier');
  if (guard.qualifier === undefined || node === undefined || isWithoutValue(attachment.qualifier)) {
    return [];
  }
  const qualifierAt = [...at, 'qualifier'];
  if (!safeParse(guard.qualifier, attachment.qualifier).success) {
    const message = `${textOf(guard.name)} takes a Qualifier its schema accepts`;
    return [failure(qualifierAt, 'qualifier-value', message)];
  }
  const undeclared = undeclaredKeysOf(attachment.qualifier, node, nodes.defs);
  if (undeclared.length === 0) {
    return [];
  }
  const message = `A Qualifier holds only the keys its schema declares: ${undeclared.join(', ')}`;
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
