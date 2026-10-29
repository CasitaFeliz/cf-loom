/**
 * Every sentence a declaration is refused with that the types and `generate` both write, each
 * written once: a fixed sentence as a const the types read with `typeof`, and a sentence with names
 * as a template type with the function `generate` writes it by, whose return type is that template,
 * so a function whose text drifts from its type does not compile.
 */

/** Why a Guard declares `params` or `body` in its demands. */
export const guardDemandsRefusal = 'A Guard demands only headers and query';

/** Why a Group lists nothing. */
export const groupListsRefusal =
  'A Group lists at least one Endpoint, Event, Command or Subscription';

/** Why an Endpoint whose path has no `:names` declares params. */
export const noParamsRefusal = 'A path without :names takes no params';

/** Why a GET Endpoint declares an Input body. */
export const getBodyRefusal = 'A GET Endpoint takes no body';

/** Why a 204 Success declares a body. */
export const noContentBodyRefusal = 'A 204 Success has no body';

/** Why a Message body is refused; `generate` names the Message Version after it. */
export const messageBodyRefusal = 'A Message body is an object of its fields';

/** Why a Message version is refused; `generate` names the version after it. */
export const messageVersionRefusal =
  'A Message version is one whole number from 1 to Number.MAX_SAFE_INTEGER';

/** Why a Subscription never receives a Command. */
export const commandSubscribedRefusal =
  "A Subscription receives an Event; a Command's Message Version has its own Message Handler";

/** A field its declaration's kind does not declare. */
export type UndeclaredFieldSentence<Field extends string> = `${Field} is not a declared field`;

/** Writes `UndeclaredFieldSentence`. */
export function undeclaredFieldSentence<Field extends string>(
  field: Field,
): UndeclaredFieldSentence<Field> {
  return `${field} is not a declared field`;
}

/** The noun each kind's name is called by in a sentence. */
export const nameNouns = {
  endpoint: 'An Endpoint name',
  guard: 'A Guard name',
  subscription: 'A Subscription name',
} as const;

/** An Endpoint, Guard or Subscription name that is a reserved word. */
export type ReservedNameSentence<
  Noun extends string,
  Name extends string,
> = `${Noun} is camelCase words and no reserved word: "${Name}"`;

/** Writes `ReservedNameSentence`. */
export function reservedNameSentence<Noun extends string, Name extends string>(
  noun: Noun,
  name: Name,
): ReservedNameSentence<Noun, Name> {
  return `${noun} is camelCase words and no reserved word: "${name}"`;
}

/** A Rejection or a Guard listed a second time. */
export type ListedTwiceSentence<Name extends string> = `${Name} is listed twice`;

/** Writes `ListedTwiceSentence`. */
export function listedTwiceSentence<Name extends string>(name: Name): ListedTwiceSentence<Name> {
  return `${name} is listed twice`;
}

/** A Guard that declares a Qualifier, listed bare. */
export type NeedsQualifierSentence<Name extends string> =
  `${Name} needs a qualifier: { guard, qualifier }`;

/** Writes `NeedsQualifierSentence`. */
export function needsQualifierSentence<Name extends string>(
  name: Name,
): NeedsQualifierSentence<Name> {
  return `${name} needs a qualifier: { guard, qualifier }`;
}

/** A Guard that declares no Qualifier, listed with one. */
export type TakesNoQualifierSentence<Name extends string> = `${Name} takes no qualifier`;

/** Writes `TakesNoQualifierSentence`. */
export function takesNoQualifierSentence<Name extends string>(
  name: Name,
): TakesNoQualifierSentence<Name> {
  return `${name} takes no qualifier`;
}

/** A Dependency whose Endpoints are several Providers', their names joined. */
export type OneProviderSentence<Names extends string> =
  `A Dependency lists one Provider's Endpoints: ${Names}`;

/** Writes `OneProviderSentence`. */
export function oneProviderSentence<Names extends string>(
  names: Names,
): OneProviderSentence<Names> {
  return `A Dependency lists one Provider's Endpoints: ${names}`;
}

/** Params that are not exactly the path's `:names`, joined. */
export type ExactParamsSentence<Names extends string> =
  `params declares exactly the path's :names: ${Names}`;

/** Writes `ExactParamsSentence`. */
export function exactParamsSentence<Names extends string>(
  names: Names,
): ExactParamsSentence<Names> {
  return `params declares exactly the path's :names: ${names}`;
}

/** A Success of a status other than 204 that declares no body. */
export type SuccessBodySentence<Status extends number> = `A ${Status} Success has a body`;

/** Writes `SuccessBodySentence`. */
export function successBodySentence<Status extends number>(
  status: Status,
): SuccessBodySentence<Status> {
  return `A ${status} Success has a body`;
}

/** A Guard listed before the Guards it requires, their names joined. */
export type RequiresEarlierSentence<
  Name extends string,
  Missing extends string,
> = `${Name} requires ${Missing} earlier in guards`;

/** Writes `RequiresEarlierSentence`. */
export function requiresEarlierSentence<Name extends string, Missing extends string>(
  name: Name,
  missing: Missing,
): RequiresEarlierSentence<Name, Missing> {
  return `${name} requires ${missing} earlier in guards`;
}

/** Header names that are not lower-case, joined. */
export type HeaderCaseSentence<Names extends string> = `Header names are lower-case: ${Names}`;

/** Writes `HeaderCaseSentence`. */
export function headerCaseSentence<Names extends string>(names: Names): HeaderCaseSentence<Names> {
  return `Header names are lower-case: ${names}`;
}

/** An Endpoint an Application lists that is not Public, by its Provider and its Visibility. */
export type NotPublicSentence<Endpoints extends string> =
  `An Application depends on Public Endpoints only: ${Endpoints}`;

/** One Endpoint of `NotPublicSentence`: `payments-service's getPayment is internal`. */
export type NotPublicEndpoint<
  Provider extends string,
  Name extends string,
  Visibility extends string,
> = `${Provider}'s ${Name} is ${Visibility}`;

/** Writes `NotPublicSentence` for one Endpoint. */
export function notPublicSentence<
  Provider extends string,
  Name extends string,
  Visibility extends string,
>(
  provider: Provider,
  name: Name,
  visibility: Visibility,
): NotPublicSentence<NotPublicEndpoint<Provider, Name, Visibility>> {
  return `An Application depends on Public Endpoints only: ${provider}'s ${name} is ${visibility}`;
}

/** A Dependency or Subscription on an Element of the Service's own Contract Package. */
export type OwnProviderSentence<Service extends string> =
  `A Provider is another Service: ${Service} is this Service`;

/** Writes `OwnProviderSentence`. */
export function ownProviderSentence<Service extends string>(
  service: Service,
): OwnProviderSentence<Service> {
  return `A Provider is another Service: ${service} is this Service`;
}
