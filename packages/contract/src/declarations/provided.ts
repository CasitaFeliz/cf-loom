import type { Endpoint, EndpointDeclaration } from './endpoint.ts';
import type { Event, EventDeclaration } from './event.ts';
import { freezeDeclaration } from './freeze-declaration.ts';
import type { Rejection, RejectionDeclaration } from './rejection.ts';

const providerMark = Symbol.for('@cf-loom/contract.provider');

/**
 * An Element as its Provider's Contract Package exports it: the Provider's, which a Dependency
 * selects or a Subscription receives, and a Group never lists.
 */
export type Provided<Element> = Element & { readonly [providerMark]: string };

/** What a Group may list: an Element no Provider's Contract Package exports. */
export type Own<Element> = Element & { readonly [providerMark]?: never };

/** The Provider whose Contract Package exports an Element; none for a Contract's own declaration. */
export function providerOf(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const provider: unknown = Reflect.get(value, providerMark);
  return typeof provider === 'string' ? provider : undefined;
}

/**
 * For generated code: an Endpoint a Contract Package exports, rebuilt from its Snapshot entry with
 * Reader schemas and marked as `provider`'s; it carries no author rule.
 */
export function providedEndpoint<const Declaration extends EndpointDeclaration>(
  provider: string,
  declaration: Declaration,
): Provided<Endpoint<Declaration>> {
  const marks = { [providerMark]: provider };
  return freezeDeclaration('endpoint', declaration, marks) as Provided<Endpoint<Declaration>>;
}

/**
 * For generated code: an Event a Contract Package exports, rebuilt from its Snapshot entry with a
 * Reader schema as its body and marked as `provider`'s; it carries no author rule.
 */
export function providedEvent<const Declaration extends EventDeclaration>(
  provider: string,
  declaration: Declaration,
): Provided<Event<Declaration>> {
  const marks = { [providerMark]: provider };
  return freezeDeclaration('event', declaration, marks) as Provided<Event<Declaration>>;
}

/**
 * For generated code: a Rejection a Contract Package exports, rebuilt from its Snapshot entry with
 * a Reader schema as its body; it carries no author rule and no mark, since a Rejection is no
 * Element.
 */
export function providedRejection<const Declaration extends RejectionDeclaration>(
  declaration: Declaration,
): Rejection<Declaration> {
  return freezeDeclaration('rejection', declaration);
}
