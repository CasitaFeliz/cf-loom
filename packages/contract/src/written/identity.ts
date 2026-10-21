import { isMessageVersion, methods } from '../declarations/index.ts';
import { textOf } from './written.ts';

/** The segments between the slashes of a path, a leading or trailing slash dropped. */
export function segmentsOf(path: string): readonly string[] {
  const inner = path.replace(/^\//, '').replace(/\/$/, '');
  return inner === '' ? [] : inner.split('/');
}

/** A segment of a canonical path: a literal, or a `:name` param. */
export type PathSegment =
  | { readonly kind: 'literal'; readonly text: string }
  | { readonly kind: 'param'; readonly name: string };

/** The segments of a canonical path, a literal or a param, so a request is matched by them alone. */
export function pathSegmentsOf(path: string): readonly PathSegment[] {
  return segmentsOf(path).map((segment) =>
    segment.startsWith(':')
      ? { kind: 'param', name: segment.slice(1) }
      : { kind: 'literal', text: segment },
  );
}

/** The `:names` of a path, in order, as its params must declare them. */
export function paramNamesOf(path: string): readonly string[] {
  return segmentsOf(path)
    .filter((segment) => segment.startsWith(':'))
    .map((segment) => segment.slice(1));
}

/**
 * An Endpoint's identity: its method and its path with every param replaced by `{}`. A path that
 * is not canonical still gets one, so every failure of the Endpoint has a location.
 */
export function identityOf(method: unknown, path: unknown): string {
  const segments = segmentsOf(textOf(path)).map((segment) =>
    segment.startsWith(':') ? '{}' : segment,
  );
  return `${textOf(method)} /${segments.join('/')}`;
}

/**
 * A Message Version's identity, `OrderCreated@2`; one that breaks its rules still gets one, so every
 * failure of it has a location.
 */
export function messageIdentityOf(name: unknown, version: unknown): string {
  return `${textOf(name)}@${textOf(version)}`;
}

/** A Message Version as a subject and a broker message id spell it, `OrderCreated.v2`. */
export function subjectVersionOf(message: {
  readonly name: string;
  readonly version: number;
}): string {
  return `${message.name}.v${message.version}`;
}

/**
 * A Message Version's name and version from its identity, `OrderCreated@2`: the reverse of
 * `messageIdentityOf`, since the Snapshot keys a Message Version by its identity alone.
 */
export function nameAndVersionOf(identity: string): {
  readonly name: string;
  readonly version: number;
} {
  const message = readMessageIdentity(identity);
  if (message === undefined) {
    throw new Error(`${identity} is no Message Version’s identity: a bug.`);
  }
  return message;
}

/**
 * The method and the path an Endpoint declares, from its identity and its param names in order:
 * the reverse of `identityOf`, since the Snapshot stores the names apart from the identity.
 */
export function methodAndPathOf(
  identity: string,
  params: readonly string[],
): { readonly method: string; readonly path: string } {
  const read = readEndpointIdentity(identity);
  if (read === undefined) {
    throw new Error(`${identity} is no Endpoint’s identity: a bug.`);
  }
  const unused = [...params].reverse();
  const segments = segmentsOf(read.identityPath).map((segment) =>
    segment === '{}' ? `:${unused.pop() ?? ''}` : segment,
  );
  return { method: read.method, path: `/${segments.join('/')}` };
}

/** What a canonical Endpoint identity's path holds: `/`, or segments that are `{}` or literal text. */
const identityPathForm = /^(?:\/|(?:\/(?:\{\}|[^/\s{}:]+))+)$/;

/**
 * The method and the path of a text that is an Endpoint's identity, `GET /orders/{}`, with its
 * params as `{}`: the form `identityOf` writes, or `undefined` for any other text. What a literal
 * segment may spell is left to `generate`.
 */
export function readEndpointIdentity(
  identity: string,
): { readonly method: string; readonly identityPath: string } | undefined {
  const separator = identity.indexOf(' ');
  const method = identity.slice(0, separator);
  const path = identity.slice(separator + 1);
  const isReadable = methods.some((known) => known === method) && identityPathForm.test(path);
  return isReadable ? { method, identityPath: path } : undefined;
}

/**
 * The name and version of a text that is a Message Version's identity, `OrderCreated@2`: the form
 * `messageIdentityOf` writes, or `undefined` for any other text.
 */
export function readMessageIdentity(
  identity: string,
): { readonly name: string; readonly version: number } | undefined {
  const separator = identity.lastIndexOf('@');
  const versionText = identity.slice(separator + 1);
  const version = Number(versionText);
  const isReadable = separator > 0 && isMessageVersion(version) && String(version) === versionText;
  return isReadable ? { name: identity.slice(0, separator), version } : undefined;
}

/** A Subscription's Event as the Snapshot spells it: its Service, then the Message Version's identity. */
export function eventReferenceOf(service: string, name: unknown, version: unknown): string {
  return `${service}:${messageIdentityOf(name, version)}`;
}

/**
 * The Service, name and version of a text that is a Subscription's Event, such as
 * `payments-service:PaymentSettled@1`, or `undefined` for any other text.
 */
export function readEventReference(
  text: string,
): { readonly service: string; readonly name: string; readonly version: number } | undefined {
  const separator = text.indexOf(':');
  const message = readMessageIdentity(text.slice(separator + 1));
  return separator > 0 && message !== undefined
    ? { service: text.slice(0, separator), ...message }
    : undefined;
}
