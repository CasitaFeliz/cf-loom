import type { Endpoint, EndpointDeclaration } from './endpoint.ts';
import type { Event, EventDeclaration } from './event.ts';
import { freezeDeclaration } from './freeze-declaration.ts';
import type { Rejection, RejectionDeclaration } from './rejection.ts';
import type { ProvidedStandardRejections } from './standard-rejections.ts';

const providerMark = Symbol.for('@cf-loom/contract.provider');
const exportedMark = Symbol.for('@cf-loom/contract.exported');
const standardRejectionsMark = Symbol.for('@cf-loom/contract.standard-rejections');

/**
 * An Element as its Provider's Contract Package exports it, marked with its Provider's name: a
 * Dependency lists it, a Subscription receives it, and a Group never lists it.
 */
export type Provided<Element, Name extends string = string> = Element & {
  readonly [providerMark]: Name;
};

/**
 * An Endpoint as its Provider's Contract Package exports it: Provided, and carrying its Provider's
 * Standard Rejections, which type what a Caller receives. One named type, since a declaration file
 * cannot name a second private mark beside `Provided`.
 */
export type ProvidedEndpoint<
  E = Endpoint & { readonly visibility: 'public' | 'internal' },
  Name extends string = string,
  Standards extends ProvidedStandardRejections = ProvidedStandardRejections,
> = Provided<E & { readonly [standardRejectionsMark]: Standards }, Name>;

/** The name of the Provider that marks a Provided Element, as its type gives it; none for any other value. */
export type ProviderNameOf<Element> = Element extends { readonly [providerMark]: infer Name }
  ? Name
  : never;

/** What a Group may list: an Element no Provider's Contract Package exports. */
export type Own<Element> = Element & { readonly [providerMark]?: never };

/** The Provider whose Contract Package exports a Provided Element, as its mark names it. */
export function providerOf<Name extends string>(value: Provided<unknown, Name>): Name;
/** The Provider whose Contract Package exports an Element; none for a Contract's own declaration. */
export function providerOf(value: unknown): string | undefined;
/** The Provider whose Contract Package exports an Element; none for a Contract's own declaration. */
export function providerOf(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const provider: unknown = Reflect.get(value, providerMark);
  return typeof provider === 'string' ? provider : undefined;
}

/** Whether a value is a Provided Element: its Provider's name marks it. */
export function isProvidedElement(value: unknown): value is Provided<object> {
  return providerOf(value) !== undefined;
}

/** The exported Snapshot cut a Provided Endpoint carries, as written; none for any other Endpoint. */
export function carriedCutOf(endpoint: Endpoint): unknown {
  return Reflect.get(endpoint, exportedMark);
}

/** The Standard Rejections of its Provider a Provided Endpoint carries, as its type gives them. */
export function carriedStandardRejectionsOf<Standards extends ProvidedStandardRejections>(
  endpoint: ProvidedEndpoint<unknown, string, Standards>,
): Standards {
  return Reflect.get(endpoint, standardRejectionsMark) as Standards;
}

/**
 * For generated code: an Endpoint a Contract Package exports, rebuilt from its Snapshot entry with
 * Reader schemas, marked with its Provider's name, carrying its Provider's Standard Rejections and
 * `cut`, the exported Snapshot cut to it, `unknown` since the cf-loom that wrote it may be older
 * than the one that reads it; it carries no author rule.
 */
export function providedEndpoint<
  const Name extends string,
  const Standards extends ProvidedStandardRejections,
  const Declaration extends EndpointDeclaration,
>(
  provider: { readonly name: Name; readonly standardRejections: Standards },
  declaration: Declaration,
  cut: unknown,
): ProvidedEndpoint<Endpoint<Declaration>, Name, Standards> {
  const marks = {
    [providerMark]: provider.name,
    [standardRejectionsMark]: provider.standardRejections,
    [exportedMark]: cut,
  };
  const provided = freezeDeclaration('endpoint', declaration, marks);
  return provided as ProvidedEndpoint<Endpoint<Declaration>, Name, Standards>;
}

/**
 * For generated code: an Event a Contract Package exports, rebuilt from its Snapshot entry with a
 * Reader schema as its body and marked with its Provider's name; it carries no author rule.
 */
export function providedEvent<
  const Name extends string,
  const Declaration extends EventDeclaration,
>(provider: Name, declaration: Declaration): Provided<Event<Declaration>, Name> {
  const marks = { [providerMark]: provider };
  return freezeDeclaration('event', declaration, marks) as Provided<Event<Declaration>, Name>;
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
