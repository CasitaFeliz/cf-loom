import { type Client, type ClientOptions, client } from '@cf-loom/client';
import type {
  AnyDependency,
  ConfiguredName,
  ListedEndpoint,
  ListedName,
} from '@cf-loom/client/internal';
import type { Http, InputOf } from '@cf-loom/contract';
import type { DeclaredFieldsRule } from '@cf-loom/contract/internal';
import { fakedProviderOf } from '../provided/index.ts';
import type { Script } from '../scripting/index.ts';
import type { Frozen, InvalidCall } from './calls.ts';
import { type Faking, fakeFetchOf, fakingOf } from './fetch.ts';
import { throwMistakes } from './verify.ts';

/** Where a fake is reached: `https://<provider>.test`, its Endpoints' Provider, unless a test names another base URL. */
export type FakeProviderOptions = { readonly baseUrl?: string | URL };

/** What `payments.client()` takes: a client's options, its `fetch` and base URL the fake's own. */
export type FakeClientOptions<
  D extends AnyDependency,
  Configured extends ConfiguredName<D> = never,
> = Omit<ClientOptions<D, Configured>, 'baseUrl' | 'fetch'>;

/**
 * A fake of the Provider a Dependency names: its `fetch`, a real client over it, each listed
 * Endpoint's script, the calls each received, valid and invalid, and `verify()`.
 */
export type FakeProvider<D extends AnyDependency> = {
  readonly fetch: Http;
  client<Configured extends ConfiguredName<D> = never, const Given = unknown>(
    options?: FakeClientOptions<D, Configured> &
      Given &
      NoInfer<DeclaredFieldsRule<Given, FakeClientOptions<D, Configured>>>,
  ): Client<D, Configured>;
  on<Name extends ListedName<D>>(name: Name): Script<D, Name>;
  /** The requests the Endpoint read as valid, in the order they reached `fetch`, each a frozen copy of its parsed Input. */
  calls<Name extends ListedName<D>>(
    name: Name,
  ): readonly Frozen<InputOf<ListedEndpoint<D, Name>>>[];
  /** The requests the Endpoint answered with the invalid-input Rejection, in the order they reached `fetch`. */
  invalidCalls<Name extends ListedName<D>>(name: Name): readonly InvalidCall[];
  /**
   * Throws what the test got wrong so far, wherever the code under test caught it: every mistake
   * `fetch` threw, and one a step made after its request was aborted, then each Endpoint's `once`
   * steps no request took; returns when there is none.
   */
  verify(): void;
};

/**
 * Fakes the Provider of a Dependency, checked against the exported Snapshot cut each listed
 * Endpoint carries, so it answers only what that Provider could.
 */
export function fakeProvider<const D extends AnyDependency>(
  dependency: D,
  options: FakeProviderOptions = {},
): FakeProvider<D> {
  const faked = fakedProviderOf(dependency, options.baseUrl);
  const { base } = faked;
  const faking: Faking = fakingOf(faked);
  const fetch = fakeFetchOf(faking);
  const fake: FakeProvider<D> = {
    fetch,
    client: (clientOptions) => client(dependency, { ...clientOptions, baseUrl: base, fetch }),
    on: (name) => faking.scriptedByNameOf(name).script as Script<D, typeof name>,
    calls: (name) =>
      faking.calls.callsOf(name) as readonly Frozen<InputOf<ListedEndpoint<D, typeof name>>>[],
    invalidCalls: (name) => faking.calls.invalidCallsOf(name),
    verify: () => throwMistakes(faking),
  };
  return Object.freeze(fake);
}
