import { type Client, type ClientOptions, client, type Fetch } from '@cf-loom/client';
import { type AnyDependencies, baseUrlOf, type ConfiguredName } from '@cf-loom/client/internal';
import { providedOf } from '../provided/index.ts';
import type { Script } from '../scripting/index.ts';
import type { FakeCall } from './calls.ts';
import { type Faking, fakeFetchOf, fakingOf } from './fetch.ts';

/** Where a fake is reached: `https://<provider>.test` unless a test names another base URL. */
export type FakeProviderOptions = { readonly baseUrl?: string | URL };

/** What `payments.client()` takes: a client's options, its `fetch` and base URL the fake's own. */
export type FakeClientOptions<
  Deps extends AnyDependencies,
  Configured extends string = never,
> = Omit<ClientOptions<Deps, Configured>, 'baseUrl' | 'fetch'>;

type ListedName<Deps extends AnyDependencies> = keyof Deps['endpoints'] & string;

/**
 * A fake of the Provider a Dependency names: its `fetch`, a real client over it, each listed
 * Endpoint's script, and the calls each received.
 */
export type FakeProvider<Deps extends AnyDependencies> = {
  readonly fetch: Fetch;
  client<Configured extends ConfiguredName<Deps> = never>(
    options?: FakeClientOptions<Deps, Configured>,
  ): Client<Deps, Configured>;
  on<Name extends ListedName<Deps>>(
    name: Name,
  ): Script<Deps['endpoints'][Name], Deps['standardRejections']>;
  calls<Name extends ListedName<Deps>>(name: Name): readonly FakeCall<Deps['endpoints'][Name]>[];
};

/**
 * Fakes the Provider of a Dependency, checked against the Snapshot its Contract Package exports,
 * so it answers only what that Provider could.
 */
export function fakeProvider<const Deps extends AnyDependencies>(
  deps: Deps,
  options: FakeProviderOptions = {},
): FakeProvider<Deps> {
  const base = baseUrlOf(options.baseUrl ?? `https://${deps.provider}.test`);
  const faking: Faking = fakingOf(providedOf(deps, base));
  const fetch = fakeFetchOf(faking);
  const fake: FakeProvider<Deps> = {
    fetch,
    client: (clientOptions) => client(deps, { ...clientOptions, baseUrl: base, fetch }),
    on: (name) => faking.scriptedByNameOf(name).script as ScriptOf<Deps, typeof name>,
    calls: (name) => faking.calls.callsOf(name) as readonly FakeCallOf<Deps, typeof name>[],
  };
  return Object.freeze(fake);
}

/** One script for every Endpoint, typed where a test reaches it by name. */
type ScriptOf<Deps extends AnyDependencies, Name extends ListedName<Deps>> = Script<
  Deps['endpoints'][Name],
  Deps['standardRejections']
>;

type FakeCallOf<Deps extends AnyDependencies, Name extends ListedName<Deps>> = FakeCall<
  Deps['endpoints'][Name]
>;
