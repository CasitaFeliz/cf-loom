import { type Client, type ClientOptions, client } from '@cf-loom/client';
import {
  type AnyDependency,
  baseUrlOf,
  type ConfiguredName,
  type ListedEndpoint,
  type ListedName,
} from '@cf-loom/client/internal';
import type { Http, InputOf } from '@cf-loom/contract';
import { providedOf } from '../provided/index.ts';
import type { Script } from '../scripting/index.ts';
import type { InvalidCall } from './calls.ts';
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
 * Endpoint's script, and the calls each received, valid and invalid.
 */
export type FakeProvider<D extends AnyDependency> = {
  readonly fetch: Http;
  client<Configured extends ConfiguredName<D> = never>(
    options?: FakeClientOptions<D, Configured>,
  ): Client<D, Configured>;
  on<Name extends ListedName<D>>(name: Name): Script<D, Name>;
  /** The requests the Endpoint read as valid, in the order they reached `fetch`, each its parsed Input. */
  calls<Name extends ListedName<D>>(name: Name): readonly InputOf<ListedEndpoint<D, Name>>[];
  /** The requests the Endpoint answered with the invalid-input Rejection, in the order they reached `fetch`. */
  invalidCalls<Name extends ListedName<D>>(name: Name): readonly InvalidCall[];
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
    on: (name) => faking.scriptedByNameOf(name).script as Script<D, typeof name>,
    calls: (name) =>
      faking.calls.callsOf(name) as readonly InputOf<ListedEndpoint<D, typeof name>>[],
    invalidCalls: (name) => faking.calls.invalidCallsOf(name),
  };
  return Object.freeze(fake);
}
