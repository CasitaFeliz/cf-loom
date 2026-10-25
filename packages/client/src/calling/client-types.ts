import type { Endpoint, InputOf } from '@cf-loom/contract';
import type { ReceivedOutcome } from '../decoding/index.ts';
import type { AnyDependency } from '../endpoints/index.ts';
import type { InferFault } from '../inference/index.ts';

type EndpointOf<D extends AnyDependency> = D['endpoints'][keyof D['endpoints']];

type HeadersOf<Target extends Endpoint> =
  InputOf<Target> extends { readonly headers: infer Headers }
    ? Headers
    : Readonly<Record<never, never>>;

/** A header name some Endpoint a Dependency lists declares in its Input, as `client()` may give it. */
export type ConfiguredName<D extends AnyDependency> =
  EndpointOf<D> extends infer Listed
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
type ConfiguredValueOf<D extends AnyDependency, Name> =
  HeaderSink<EndpointOf<D>, Name> extends (value: infer Value) => void ? Value : never;

/** A header given to `client()`: its value, or a function called per request, which may be async. */
type ConfiguredHeader<Value> = Value | (() => Value | Promise<Value>);

/** What a Provider's Deprecation says, once per client per method. */
export type DeprecationNotice = {
  readonly provider: string;
  readonly endpoint: string;
  readonly deprecatedAt: string;
};

/** How a client reaches a Provider: its URL, headers given once, its `fetch` and its inference. */
export type ClientOptions<D extends AnyDependency, Configured extends string = never> = {
  readonly baseUrl: string | URL;
  readonly headers?: {
    readonly [Name in Configured]: ConfiguredHeader<ConfiguredValueOf<D, Name>>;
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
  D extends AnyDependency,
  Name extends keyof D['endpoints'],
> =
  Readonly<Record<never, never>> extends CallInput<Target, Configured>
    ? (
        input?: CallInput<Target, Configured>,
        call?: CallOptions,
      ) => Promise<ReceivedOutcome<D, Name>>
    : (
        input: CallInput<Target, Configured>,
        call?: CallOptions,
      ) => Promise<ReceivedOutcome<D, Name>>;

/** One method per Endpoint a Dependency lists, named after it; `Configured` names the headers `client()` gives. */
export type Client<D extends AnyDependency, Configured extends string = never> = {
  readonly [Name in keyof D['endpoints']]: D['endpoints'][Name] extends Endpoint
    ? Method<D['endpoints'][Name], Configured, D, Name>
    : never;
};
