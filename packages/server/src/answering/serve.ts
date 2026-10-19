import type { Contract } from '@casitafeliz/loom-contract';
import { type ServedHandlers, servedContractOf } from '../served/index.ts';
import { answerOf } from './answer.ts';
import { type AnsweredRequest, reportServiceFault, type ServiceFault } from './hooks.ts';

/** The fetch-style handler `serve` returns: what an adapter connects to its host. */
export type Http = (request: Request) => Promise<Response>;

/** What is operational about serving and no part of the Contract: the body limit and the hooks. */
export type ServeOptions = {
  /** The most bytes of a body `serve` reads before answering `BODY_TOO_LARGE`; none sets no limit. */
  readonly maxBodyBytes?: number;
  /**
   * Receives every Fault the Service's side produced: one a Handler returned or threw, an Outcome
   * that broke the Contract, or the runtime's own bug; never the Caller's. The console without it.
   */
  readonly onServiceFault?: (fault: ServiceFault) => void;
  /** Receives one record per request answered, for metrics and tracing. */
  readonly onOutcome?: (request: AnsweredRequest) => void;
};

/**
 * Answers a Contract's Endpoints with their Handlers over web-standard HTTP, after checking the
 * Service is assembled as the Contract says.
 */
export function serve(
  contract: Contract,
  handlers: ServedHandlers,
  options: ServeOptions = {},
): Http {
  const served = servedContractOf(contract, handlers, options.maxBodyBytes);
  return async (request) => {
    const started = performance.now();
    const { endpoint, answered } = await answerOf(served, request);
    if (answered.kind === 'fault' && answered.serviceFault !== undefined) {
      reportServiceFault(answered.serviceFault, options.onServiceFault);
    }
    const { status } = answered.response;
    const durationMs = performance.now() - started;
    const record = { status, kind: answered.kind, durationMs };
    options.onOutcome?.(
      endpoint === undefined ? record : { endpoint: endpoint.declared.name, ...record },
    );
    return answered.response;
  };
}
