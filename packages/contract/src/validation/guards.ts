import { safeParse } from 'zod/v4/core';
import type { Attachment } from '../attachment.ts';
import type { Guard } from '../guard.ts';
import type { Path } from '../walker/nodes.ts';
import type { LocatedEndpoint, LocatedGuard } from './declarations.ts';
import { attachedGuardOf, isGuard, listOf } from './declarations.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import { undeclaredKeysOf } from './qualifiers.ts';
import type { Nodes } from './schemas.ts';

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
  for (const [index, attachment] of listOf(endpoint.guards).entries()) {
    const attachedAt = [...at, 'guards', index];
    const guard = attachedGuardOf(attachment);
    if (guard === undefined) {
      const message = 'An Attachment is a Guard or { guard, qualifier }';
      failures.push(failure(attachedAt, 'attachment', message));
      continue;
    }
    failures.push(...shapeFailures({ at: attachedAt, attachment, guard }));
    failures.push(...orderFailures({ at: attachedAt, attachment, guard }, earlier));
    earlier.push(guard.name);
  }
  return failures;
}

/** A Qualifier is a value its schema accepts whose objects hold only the keys it declares. */
export function qualifierFailures(
  { at, endpoint }: LocatedEndpoint,
  nodes: Nodes,
): readonly DeclarationFailure[] {
  const listed: readonly Listed[] = listOf(endpoint.guards).map((attachment, index) => ({
    at: [...at, 'guards', index],
    attachment,
    guard: attachedGuardOf(attachment),
  }));
  return listed.filter(isQualified).flatMap((qualified) => valueFailures(qualified, nodes));
}

function valueFailures(
  { at, attachment, guard }: Qualified,
  nodes: Nodes,
): readonly DeclarationFailure[] {
  const node = nodes.nodeAt(['guards', guard.name, 'qualifier']);
  if (guard.qualifier === undefined || node === undefined) {
    return [];
  }
  const qualifierAt = [...at, 'qualifier'];
  if (!safeParse(guard.qualifier, attachment.qualifier).success) {
    const message = `${guard.name} takes a Qualifier its schema accepts`;
    return [failure(qualifierAt, 'qualifier-value', message)];
  }
  const undeclared = undeclaredKeysOf(attachment.qualifier, node, nodes.defs);
  if (undeclared.length === 0) {
    return [];
  }
  const message = `A Qualifier holds only the keys its schema declares: ${undeclared.join(', ')}`;
  return [failure(qualifierAt, 'qualifier-keys', message)];
}

function shapeFailures({ at, attachment, guard }: Attached): readonly DeclarationFailure[] {
  const declaresQualifier = guard.qualifier !== undefined;
  if (isGuard(attachment) && declaresQualifier) {
    const message = `${guard.name} needs a qualifier: { guard, qualifier }`;
    return [failure(at, 'attachment', message)];
  }
  if (!isGuard(attachment) && !declaresQualifier) {
    return [failure(at, 'attachment', `${guard.name} takes no qualifier`)];
  }
  return [];
}

function orderFailures(
  { at, guard }: Attached,
  earlier: readonly string[],
): readonly DeclarationFailure[] {
  if (earlier.includes(guard.name)) {
    return [failure(at, 'guard-once', `${guard.name} is listed twice`)];
  }
  const required = listOf(guard.guards)
    .filter(isGuard)
    .map((listed) => listed.name);
  const missing = required.filter((name) => !earlier.includes(name));
  if (missing.length === 0) {
    return [];
  }
  const message = `${guard.name} requires ${missing.join(', ')} earlier in guards`;
  return [failure(at, 'guard-order', message)];
}

function isQualified(listed: Listed): listed is Qualified {
  return listed.guard !== undefined && !isGuard(listed.attachment);
}
