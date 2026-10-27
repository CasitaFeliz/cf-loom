import type { Http, ServiceContract } from '@cf-loom/contract';
import type { DeclaredFieldsRule } from '@cf-loom/contract/internal';
import type { HandlerMapOf, ResourcesOf } from '@cf-loom/handlers';
import type { CallArgument, NoResources, ResourcesField } from '@cf-loom/handlers/internal';
import { type ServedHandlers, servedContractOf } from '../served/index.ts';
import { answerOf } from './answer.ts';
import {
  type AnsweredRequest,
  answeredRequestOf,
  recordAnswered,
  reportServedFault,
  type ServedFault,
  type ServeHook,
} from './hooks.ts';
import { sentOf } from './runs.ts';

/** How many bytes of a request body `serve` reads before answering `BODY_TOO_LARGE`: a whole number from 0, or `'unlimited'`. */
export type BodyLimit = number | 'unlimited';

/** What `serve` takes besides the Contract and the Handler map: the Resources its Handlers take, and what is operational about serving; none of it is part of the Contract. */
export type ServeOptions<Resources extends object = NoResources> = ResourcesField<Resources> & {
  /**
   * The most bytes of a body `serve` reads before answering `BODY_TOO_LARGE`, or `'unlimited'`;
   * none sets no limit, the host's or the gateway's. Any other value throws at startup.
   */
  readonly maxBodyBytes?: BodyLimit;
  /**
   * Receives every Fault the Service's side produced: one a Handler returned or threw, an Outcome
   * that broke the Contract, or the runtime's own bug; never the Caller's; with the Request it
   * came from. The console without it.
   */
  readonly onServiceFault?: ServeHook<ServedFault>;
  /**
   * Answers every request no declared Endpoint matches, such as a health check or CORS preflight,
   * its Response returned as is, and the internal Fault if it rejects; without it,
   * `NO_SUCH_ENDPOINT`, or `METHOD_NOT_ALLOWED` on a declared path.
   */
  readonly fallback?: Http;
  /** Receives one record per request answered, and the Request, for metrics and tracing; never one the fallback answered. */
  readonly onAnswered?: ServeHook<AnsweredRequest>;
};

/** The options `serve` takes for a Handler map: the Resources its Handlers take, and the operational fields. */
type ServedOptionsOf<Handlers extends Pick<HandlerMapOf<ServiceContract>, 'endpoints' | 'guards'>> =
  ServeOptions<ResourcesOf<Pick<Handlers, 'endpoints' | 'guards'>>>;

/**
 * Answers a Contract's Endpoints with their Handlers over web-standard HTTP, handing each the
 * Service's Resources, after checking the Service is assembled as the Contract says.
 */
export function serve<
  const C extends ServiceContract,
  const Handlers extends Pick<HandlerMapOf<C>, 'endpoints' | 'guards'>,
  const Given extends ServedOptionsOf<Handlers> = ServedOptionsOf<Handlers>,
>(
  contract: C,
  handlers: Handlers,
  ...options: CallArgument<
    ServedOptionsOf<Handlers>,
    Given & NoInfer<DeclaredFieldsRule<Given, ServeOptions<object>>>
  >
): Http;
export function serve(
  contract: ServiceContract,
  handlers: ServedHandlers,
  options: ServeOptions<object> = {},
): Http {
  const served = servedContractOf(contract, handlers, options);
  return async (request) => {
    const started = performance.now();
    const answer = await answerOf(served, request, options.fallback);
    if (answer.kind === 'fallback') {
      return answer.response;
    }
    const { endpoint, answered } = answer;
    if (answered.kind === 'fault' && answered.servedFault !== undefined) {
      await reportServedFault(answered.servedFault, request, options.onServiceFault);
    }
    const sent = { ...sentOf(answered), durationMs: performance.now() - started };
    const record = answeredRequestOf(request, endpoint?.declared, sent);
    await recordAnswered(record, request, options.onAnswered);
    return answered.response;
  };
}
