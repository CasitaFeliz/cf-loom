import type { Endpoint, InputOf } from '@cf-loom/contract';
import type { ReceivedOutcome } from '../decoding/index.ts';
import type { AnyDependencies } from '../endpoints/index.ts';
import type { InferFault } from '../inference/index.ts';

type EndpointOf<Deps extends AnyDependencies> = Deps['endpoints'][keyof Deps['endpoints']];

type HeadersOf<Target extends Endpoint> =
  InputOf<Target> extends { readonly headers: infer Headers }
    ? Headers
    : Readonly<Record<never, never>>;

/** A header name some Endpoint a Dependency lists declares in its Input, as `client()` may give it. */
export type ConfiguredName<Deps extends AnyDependencies> =
  EndpointOf<Deps> extends infer Listed
    ? Listed extends Endpoint
      ? keyof HeadersOf<Listed> & string
      : never
    : never;

/** One Endpoint's type for a header, as a parameter, so a union of them infers their intersection. */
type HeaderSink<Listed, Name> = Listed extends Endpoint
  ? (
      value: Name extends keyof HeadersOf<Listed>
        ? Exclude<HeadersOf<Listed>[Name], undefined>
        : unknown,
    ) => void
  : never;

/** A configured header's type: its Input type, intersected across every listed Endpoint declaring it. */
type ConfiguredValueOf<Deps extends AnyDependencies, Name> =
  HeaderSink<EndpointOf<Deps>, Name> extends (value: infer Value) => void ? Value : never;

/** A header given to `client()`: its value, or a function called per request, which may be async. */
type ConfiguredHeader<Value> = Value | (() => Value | Promise<Value>);

/** What a Provider's Deprecation says, once per client per method. */
export type DeprecationNotice = {
  readonly provider: string;
  readonly endpoint: string;
  readonly deprecatedAt: string;
};

/** How a client reaches a Provider: its URL, headers given once, its `fetch` and its inference. */
export type ClientOptions<Deps extends AnyDependencies, Configured extends string = never> = {
  readonly baseUrl: string | URL;
  readonly headers?: {
    readonly [Name in Configured]: ConfiguredHeader<ConfiguredValueOf<Deps, Name>>;
  };
  readonly fetch?: Fetch;
  readonly inferFault?: InferFault;
  readonly onDeprecation?: OnDeprecation;
};

/** A `fetch`: the global one, or the one given to `client()`. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** Where a Deprecation is told: the `onDeprecation` given to `client()`, or the console. */
export type OnDeprecation = (notice: DeprecationNotice) => void;

/** An Input's headers, those given to `client()` no longer required. */
type CallHeaders<Headers, Configured extends string> = Omit<Headers, Configured> & {
  readonly [Name in Extract<keyof Headers, Configured>]?: Headers[Name];
};

type CallParts<Target extends Endpoint, Configured extends string> = {
  readonly [Part in keyof InputOf<Target>]: Part extends 'headers'
    ? CallHeaders<InputOf<Target>[Part], Configured>
    : InputOf<Target>[Part];
};

/** The parts a Caller may leave out: those with no required field; a body never. */
type OptionalPart<Parts> = {
  [Part in keyof Parts]-?: Part extends 'body'
    ? never
    : Readonly<Record<never, never>> extends Parts[Part]
      ? Part
      : never;
}[keyof Parts];

type Flattened<Value> = { readonly [Key in keyof Value]: Value[Key] };

/** What a Caller passes to an Endpoint's method: its Input, the configured headers optional. */
export type CallInput<Target extends Endpoint, Configured extends string = never> = Flattened<
  {
    readonly [Part in Exclude<
      keyof CallParts<Target, Configured>,
      OptionalPart<CallParts<Target, Configured>>
    >]: CallParts<Target, Configured>[Part];
  } & {
    readonly [Part in OptionalPart<CallParts<Target, Configured>>]?: CallParts<
      Target,
      Configured
    >[Part];
  }
>;

/** What one call may carry besides its Input. */
export type CallOptions = { readonly signal?: AbortSignal };

type Method<
  Target extends Endpoint,
  Configured extends string,
  Deps extends AnyDependencies,
  Name extends keyof Deps['endpoints'],
> =
  Readonly<Record<never, never>> extends CallInput<Target, Configured>
    ? (
        input?: CallInput<Target, Configured>,
        call?: CallOptions,
      ) => Promise<ReceivedOutcome<Deps, Name>>
    : (
        input: CallInput<Target, Configured>,
        call?: CallOptions,
      ) => Promise<ReceivedOutcome<Deps, Name>>;

/** One method per Endpoint a Dependency lists, named after it; `Configured` names the headers `client()` gives. */
export type Client<Deps extends AnyDependencies, Configured extends string = never> = {
  readonly [Name in keyof Deps['endpoints']]: Deps['endpoints'][Name] extends Endpoint
    ? Method<Deps['endpoints'][Name], Configured, Deps, Name>
    : never;
};
