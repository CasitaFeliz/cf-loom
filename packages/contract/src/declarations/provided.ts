import type { Endpoint, EndpointDeclaration } from './endpoint.ts';
import type { Event, EventDeclaration } from './event.ts';
import { freezeDeclaration } from './freeze-declaration.ts';
import type { Rejection, RejectionDeclaration } from './rejection.ts';

/**
 * For generated code: an Endpoint a Contract Package exports, rebuilt from its Snapshot entry with
 * Reader schemas; it carries no author rule.
 */
export function providedEndpoint<const Declaration extends EndpointDeclaration>(
  declaration: Declaration,
): Endpoint<Declaration> {
  return freezeDeclaration('endpoint', declaration);
}

/**
 * For generated code: an Event a Contract Package exports, rebuilt from its Snapshot entry with a
 * Reader schema as its body; it carries no author rule.
 */
export function providedEvent<const Declaration extends EventDeclaration>(
  declaration: Declaration,
): Event<Declaration> {
  return freezeDeclaration('event', declaration);
}

/**
 * For generated code: a Rejection a Contract Package exports, rebuilt from its Snapshot entry with
 * a Reader schema as its body; it carries no author rule.
 */
export function providedRejection<const Declaration extends RejectionDeclaration>(
  declaration: Declaration,
): Rejection<Declaration> {
  return freezeDeclaration('rejection', declaration);
}
