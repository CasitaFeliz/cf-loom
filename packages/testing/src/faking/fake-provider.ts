import { type Client, type ClientOptions, client } from '@cf-loom/client';
import {
  type AnyDependency,
  baseUrlOf,
  type ConfiguredName,
  type ListedEndpoint,
  type ListedName,
} from '@cf-loom/client/internal';
import type { Http } from '@cf-loom/contract';
import { providedOf } from '../provided/index.ts';
import type { Script } from '../scripting/index.ts';
import type { FakeCall } from './calls.ts';
import { type Faking, fakeFetchOf, fakingOf } from './fetch.ts';

/** Where a fake is reached: `https://<provider>.test` unless a test names another base URL. */
export type FakeProviderOptions = { readonly baseUrl?: string | URL };

/** What `payments.client()` takes: a client's options, its `fetch` and base URL the fake's own. */
export type FakeClientOptions<
  D extends AnyDependency,
  Configured extends ConfiguredName<D> = never,
> = Omit<ClientOptions<D, Configured>, 'baseUrl' | 'fetch'>;

/**
 * A fake of the Provider a Dependency names: its `fetch`, a real client over it, each listed
 * Endpoint's script, and the calls each received.
 */
export type FakeProvider<D extends AnyDependency> = {
  readonly fetch: Http;
  client<Configured extends ConfiguredName<D> = never>(
    options?: FakeClientOptions<D, Configured>,
  ): Client<D, Configured>;
  on<Name extends ListedName<D>>(
    name: Name,
  ): Script<ListedEndpoint<D, Name>, D['provider']['standardRejections']>;
  calls<Name extends ListedName<D>>(name: Name): readonly FakeCall<ListedEndpoint<D, Name>>[];
};

/**
 * Fakes the Provider of a Dependency, checked against the Snapshot its Contract Package exports,
 * so it answers only what that Provider could.
 */
export function fakeProvider<const D extends AnyDependency>(
  dependency: D,
  options: FakeProviderOptions = {},
): FakeProvider<D> {
  const base = baseUrlOf(options.baseUrl ?? `https://${dependency.provider.name}.test`);
  const faking: Faking = fakingOf(providedOf(dependency, base));
  const fetch = fakeFetchOf(faking);
  const fake: FakeProvider<D> = {
    fetch,
    client: (clientOptions) => client(dependency, { ...clientOptions, baseUrl: base, fetch }),
    on: (name) => faking.scriptedByNameOf(name).script as ScriptOf<D, typeof name>,
    calls: (name) => faking.calls.callsOf(name) as readonly FakeCallOf<D, typeof name>[],
  };
  return Object.freeze(fake);
}

/** One script for every Endpoint, typed where a test reaches it by name. */
type ScriptOf<D extends AnyDependency, Name extends ListedName<D>> = Script<
  ListedEndpoint<D, Name>,
  D['provider']['standardRejections']
>;

type FakeCallOf<D extends AnyDependency, Name extends ListedName<D>> = FakeCall<
  ListedEndpoint<D, Name>
>;
