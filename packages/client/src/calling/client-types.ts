import type { Endpoint, Http, InputOf } from '@cf-loom/contract';
import type { ReceivedOutcome } from '../decoding/index.ts';
import type {
  AnyDependency,
  ListedEndpoint,
  ListedEndpoints,
  ListedName,
} from '../endpoints/index.ts';
import type { InferFault } from '../inference/index.ts';

type EndpointOf<D extends AnyDependency> = ListedEndpoints<D>[number];

type HeadersOf<Target extends Endpoint> =
  InputOf<Target> extends { readonly headers: infer Headers }
    ? Headers
    : Readonly<Record<never, never>>;

/** A header name an Endpoint declares in its Input. */
export type InputHeaderName<Target extends Endpoint> = keyof HeadersOf<Target> & string;

/** A header name some Endpoint a Dependency lists declares in its Input, as `client()` may give it. */
export type ConfiguredName<D extends AnyDependency> =
  EndpointOf<D> extends infer Listed
    ? Listed extends Endpoint
      ? InputHeaderName<Listed>
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

/**
 * A header given to `client()`: its value, or a function called per request with the call's
 * options, which may be async and is raced against the call's signal.
 */
type ConfiguredHeader<Value> = Value | ((call: CallOptions) => Value | Promise<Value>);

/** What a Provider's Deprecation says, once per client per method. */
export type DeprecationNotice = {
  readonly provider: string;
  readonly endpoint: string;
  readonly deprecatedAt: string;
};

/**
 * How a client reaches a Provider: its URL, headers given once, its `fetch`, called with the
 * Request each call sends, and its inference.
 */
export type ClientOptions<D extends AnyDependency, Configured extends ConfiguredName<D> = never> = {
  readonly baseUrl: string | URL;
  readonly headers?: {
    readonly [Name in Configured]: ConfiguredHeader<ConfiguredValueOf<D, Name>>;
  };
  readonly fetch?: Http;
  readonly inferFault?: InferFault;
  readonly onDeprecation?: OnDeprecation;
};

/**
 * Where a Deprecation is told: the `onDeprecation` given to `client()`, or the console; it may be
 * async and is not awaited.
 */
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
export type CallInput<
  Target extends Endpoint,
  Configured extends InputHeaderName<Target> = never,
> = Flattened<
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
  Configured extends ConfiguredName<D>,
  D extends AnyDependency,
  Name extends ListedName<D>,
  Input = CallInput<Target, Extract<Configured, InputHeaderName<Target>>>,
> =
  Readonly<Record<never, never>> extends Input
    ? (input?: Input, call?: CallOptions) => Promise<ReceivedOutcome<D, Name>>
    : (input: Input, call?: CallOptions) => Promise<ReceivedOutcome<D, Name>>;

/** One method per Endpoint a Dependency lists, named after it; `Configured` names the headers `client()` gives. */
export type Client<D extends AnyDependency, Configured extends ConfiguredName<D> = never> = {
  readonly [Name in ListedName<D>]: Method<ListedEndpoint<D, Name>, Configured, D, Name>;
};
