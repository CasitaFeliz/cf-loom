import type { Contract, Http } from '@cf-loom/contract';
import type { ResourcesOf } from '@cf-loom/handlers';
import type { CallArgument, NoResources, ResourcesField } from '@cf-loom/handlers/internal';
import { type ServedHandlers, servedContractOf } from '../served/index.ts';
import { answerOf } from './answer.ts';
import {
  type AnsweredRequest,
  answeredRequestOf,
  reportServedFault,
  type ServedFault,
} from './hooks.ts';

/** What `serve` takes besides the Contract and the Handler map: the Resources its Handlers take, and what is operational about serving; none of it is part of the Contract. */
export type ServeOptions<Resources extends object = NoResources> = ResourcesField<Resources> & {
  /** The most bytes of a body `serve` reads before answering `BODY_TOO_LARGE`; none sets no limit. */
  readonly maxBodyBytes?: number;
  /**
   * Receives every Fault the Service's side produced: one a Handler returned or threw, an Outcome
   * that broke the Contract, or the runtime's own bug; never the Caller's. The console without it.
   */
  readonly onServiceFault?: (fault: ServedFault) => void;
  /** Receives one record per request answered, for metrics and tracing. */
  readonly onOutcome?: (request: AnsweredRequest) => void;
};

/**
 * Answers a Contract's Endpoints with their Handlers over web-standard HTTP, handing each the
 * Service's Resources, after checking the Service is assembled as the Contract says.
 */
export function serve<Handlers extends ServedHandlers>(
  contract: Contract,
  handlers: Handlers,
  ...options: CallArgument<ServeOptions<ResourcesOf<Pick<Handlers, 'endpoints' | 'guards'>>>>
): Http;
export function serve(
  contract: Contract,
  handlers: ServedHandlers,
  options: ServeOptions<object> = {},
): Http {
  const served = servedContractOf(contract, handlers, options);
  return async (request) => {
    const started = performance.now();
    const { endpoint, answered } = await answerOf(served, request);
    if (answered.kind === 'fault' && answered.servedFault !== undefined) {
      reportServedFault(answered.servedFault, options.onServiceFault);
    }
    const { status } = answered.response;
    const durationMs = performance.now() - started;
    const sent = { status, kind: answered.kind, durationMs };
    options.onOutcome?.(answeredRequestOf(request.method, endpoint?.declared, sent));
    return answered.response;
  };
}
