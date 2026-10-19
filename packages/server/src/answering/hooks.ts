import type { Fault, Issue } from '@casitafeliz/loom-handlers';

/** Which Handler a Fault came from: the Endpoint's, or the Guard's it names. */
export type FaultedBy = { readonly endpoint: string; readonly guard?: string };

/**
 * A Fault the Service's side produced, which `onServiceFault` receives: one its Handler returned,
 * threw or answered with no Outcome, an Outcome that broke the Contract, or a Context or Qualifier
 * `serve` built that broke it, the runtime's own bug.
 */
export type ServiceFault = FaultedBy &
  (
    | { readonly kind: 'returned'; readonly fault: Fault }
    | { readonly kind: 'thrown'; readonly fault: Fault }
    | { readonly kind: 'invalid-outcome'; readonly issues: readonly Issue[] }
    | { readonly kind: 'runtime-bug'; readonly issues: readonly Issue[] }
  );

/** One request answered: which Endpoint, with what status and kind, and how long it took. */
export type AnsweredRequest = {
  readonly endpoint?: string;
  readonly status: number;
  readonly kind: 'success' | 'rejection' | 'fault';
  readonly durationMs: number;
};

/** Hands a Service's Fault to its hook, or to the console without one. */
export function reportServiceFault(
  serviceFault: ServiceFault,
  onServiceFault: ((fault: ServiceFault) => void) | undefined,
): void {
  if (onServiceFault !== undefined) {
    onServiceFault(serviceFault);
    return;
  }
  logServiceFault(serviceFault);
}

/** A Service's Fault on the console: each Issue's part, path and code, or the Fault and its cause. */
function logServiceFault(serviceFault: ServiceFault): void {
  const where =
    serviceFault.guard === undefined
      ? serviceFault.endpoint
      : `${serviceFault.endpoint} ${serviceFault.guard}`;
  switch (serviceFault.kind) {
    case 'returned':
    case 'thrown':
      logFault(where, serviceFault.fault);
      return;
    case 'invalid-outcome':
    case 'runtime-bug':
      for (const { part, path, code, message } of serviceFault.issues) {
        console.error(`${where}: ${[part, ...path].join('.')} ${code}: ${message}`);
      }
  }
}

function logFault(where: string, fault: Fault): void {
  if (fault.cause === undefined) {
    console.error(`${where}: ${fault.message}`);
    return;
  }
  console.error(`${where}: ${fault.message}`, fault.cause);
}
