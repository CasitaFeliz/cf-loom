import type { Command, Contract, Event } from '@cf-loom/contract';
import type { GroupedOf, Refusal } from '@cf-loom/contract/internal';
import type * as core from 'zod/v4/core';

/** What a `publish` or `send` call may add: the Fact id its Messages share, random when left out, and transport headers. */
export type MessageOptions = {
  readonly factId?: string;
  readonly headers?: Readonly<Record<string, string>>;
};

/** The Event Message Versions a root's Groups list, each with its exact type. */
type OwnEventOf<C extends Contract> = Extract<GroupedOf<C, 'events'>, Event>;

/** The Command Message Versions a root's Groups list, each with its exact type. */
type OwnCommandOf<C extends Contract> = Extract<GroupedOf<C, 'commands'>, Command>;

/** The Message Versions that still work: Active and Deprecated, never Retired. */
type LiveOf<M> = Exclude<M, { readonly lifecycle: 'retired' }>;

/** The names of the Events a root publishes: those with a version not Retired. */
type PublishedNameOf<C extends Contract> = LiveOf<OwnEventOf<C>>['name'];

/** Every version of the named Event, Retired included. */
type VersionsOf<C extends Contract, Name> = Extract<OwnEventOf<C>, { readonly name: Name }>;

/** What `publish` is told about an Event whose version is typed `number`. */
type NumberVersionRefusal =
  Refusal<'An Event version typed number keys no body: declare the version as one literal'>;

/** One required body per live version of the named Event, keyed `v<n>`. */
type LiveBodiesOf<C extends Contract, Name> = {
  readonly [E in LiveOf<VersionsOf<C, Name>> as `v${E['version']}`]: core.output<E['body']>;
};

/** A Retired version's key, `never`, so passing one is a type error even outside an object literal. */
type RetiredKeysOf<C extends Contract, Name> = {
  readonly [E in Extract<
    VersionsOf<C, Name>,
    { readonly lifecycle: 'retired' }
  > as `v${E['version']}`]?: never;
};

/** What `publish` takes for an Event: its live versions' bodies, unless a version is typed `number`. */
type PublishedBodiesOf<C extends Contract, Name> = number extends VersionsOf<C, Name>['version']
  ? NumberVersionRefusal
  : LiveBodiesOf<C, Name> & RetiredKeysOf<C, Name>;

/** The Message Versions that are Active: neither Deprecated nor Retired. */
type ActiveOf<M> = Exclude<M, { readonly lifecycle: 'deprecated' | 'retired' }>;

/** A Command's one Active version. */
type ActiveCommandOf<C extends Contract, Name> = Extract<
  ActiveOf<OwnCommandOf<C>>,
  { readonly name: Name }
>;

/** The names of the Commands a root sends: those with an Active version. */
type SentNameOf<C extends Contract> = ActiveOf<OwnCommandOf<C>>['name'];

/** What a Service publishes its Events with: one body for each Active and Deprecated version of the named Event. */
export type EventPublisher<C extends Contract> = {
  readonly publish: <Name extends PublishedNameOf<C>>(
    name: Name,
    bodies: PublishedBodiesOf<C, Name>,
    options?: MessageOptions,
  ) => Promise<void>;
};

/** What a Service sends its Commands with: the named Command's one Active version. */
export type CommandSender<C extends Contract> = {
  readonly send: <Name extends SentNameOf<C>>(
    name: Name,
    body: core.output<ActiveCommandOf<C, Name>['body']>,
    options?: MessageOptions,
  ) => Promise<void>;
};
