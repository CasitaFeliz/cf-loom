import { follows, kebabCase } from '../declarations/index.ts';
import { prefixedNameOf, streamNameOf } from './broker.ts';

/** The text after the prefix `prefixedNameOf` puts in front of a name, or `undefined` when it does not carry it. */
export function unprefixedNameOf(prefix: string | null, name: string): string | undefined {
  const head = prefixedNameOf(prefix, '');
  return name.startsWith(head) ? name.slice(head.length) : undefined;
}

/** The Service whose Stream an unprefixed name is, when `streamNameOf` prints it from a Service name. */
export function readStreamName(name: string): { readonly service: string } | undefined {
  const service = name;
  return follows(kebabCase, service) && streamNameOf(service) === name ? { service } : undefined;
}
