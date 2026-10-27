import type { BodyOf, Command, Event, ServiceContract } from '@cf-loom/contract';
import type { GroupedOf, IsOneLiteral, Refusal } from '@cf-loom/contract/internal';
import type { GivenHeaders } from './checks.ts';

/**
 * What a `publish` or `send` call carries besides its bodies: the Fact id its Messages share,
 * derived from the fact, and transport headers, an `undefined` one left out.
 */
export type MessageOptions = {
  readonly factId: string;
  readonly headers?: GivenHeaders;
};

/** What `publish` resolves to: the Fact id, and the identity of each version the Broker already held and dropped as a duplicate. */
export type Published = { readonly factId: string; readonly duplicates: readonly string[] };

/** What `send` resolves to: the Fact id, and whether the Broker already held the Command and dropped it as a duplicate. */
export type Sent = { readonly factId: string; readonly duplicate: boolean };

/** The Event Message Versions a Root's Groups list, each with its exact type. */
type OwnEventOf<C extends ServiceContract> = Extract<GroupedOf<C, 'events'>, Event>;

/** The Command Message Versions a Root's Groups list, each with its exact type. */
type OwnCommandOf<C extends ServiceContract> = Extract<GroupedOf<C, 'commands'>, Command>;

/** The Message Versions that still work: Active and Deprecated, never Retired. */
type LiveOf<M> = Exclude<M, { readonly lifecycle: 'retired' }>;

/** The names of the Events a Root publishes: those with a version not Retired. */
type PublishedNameOf<C extends ServiceContract> = LiveOf<OwnEventOf<C>>['name'];

/** Every version of the named Event, Retired included. */
type VersionsOf<C extends ServiceContract, Name> = Extract<OwnEventOf<C>, { readonly name: Name }>;

/** One required body per live version of the named Event, keyed `v<n>`. */
type LiveBodiesOf<C extends ServiceContract, Name> = {
  readonly [E in LiveOf<VersionsOf<C, Name>> as `v${E['version']}`]: BodyOf<E>;
};

/** A Retired version's key, `never`, so passing one is a type error even outside an object literal. */
type RetiredKeysOf<C extends ServiceContract, Name> = {
  readonly [E in Extract<
    VersionsOf<C, Name>,
    { readonly lifecycle: 'retired' }
  > as `v${E['version']}`]?: never;
};

/** What `publish` takes for an Event: its live versions' bodies, unless a version is typed `number`. */
type PublishedBodiesOf<C extends ServiceContract, Name> = number extends VersionsOf<
  C,
  Name
>['version']
  ? Refusal<'An Event version typed number keys no body: declare the version as one literal'>
  : LiveBodiesOf<C, Name> & RetiredKeysOf<C, Name>;

/** The Message Versions that are Active: neither Deprecated nor Retired. */
type ActiveOf<M> = Exclude<M, { readonly lifecycle: 'deprecated' | 'retired' }>;

/** A Command's one Active version. */
type ActiveCommandOf<C extends ServiceContract, Name> = Extract<
  ActiveOf<OwnCommandOf<C>>,
  { readonly name: Name }
>;

/** The names of the Commands a Root sends: those with an Active version. */
type SentNameOf<C extends ServiceContract> = ActiveOf<OwnCommandOf<C>>['name'];

/** The body of a Command's one Active version; a Command with more than one, which `cf-loom generate` refuses, takes none. */
type SentBodyOf<C extends ServiceContract, Name> =
  IsOneLiteral<ActiveCommandOf<C, Name>> extends true
    ? BodyOf<ActiveCommandOf<C, Name>>
    : Refusal<`send() takes a Command with one Active version, which ${Name & string} is not: cf-loom generate refuses it`>;

/** What a Service publishes its Events with: one body for each Active and Deprecated version of the named Event. */
export type EventPublisher<C extends ServiceContract> = {
  readonly publish: <Name extends PublishedNameOf<C>>(
    name: Name,
    bodies: PublishedBodiesOf<C, Name>,
    options: MessageOptions,
  ) => Promise<Published>;
};

/** What a Service sends its Commands with: the named Command's one Active version. */
export type CommandSender<C extends ServiceContract> = {
  readonly send: <Name extends SentNameOf<C>>(
    name: Name,
    body: SentBodyOf<C, Name>,
    options: MessageOptions,
  ) => Promise<Sent>;
};
