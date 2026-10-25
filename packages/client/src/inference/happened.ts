import type { Answered, Happened } from './faults.ts';

/** The system error codes Node and undici give for a request that never reached the Provider. */
const noConnectionCodes: ReadonlySet<unknown> = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'UND_ERR_CONNECT_TIMEOUT',
]);

/** The error codes undici gives for a Provider that stopped answering, while waiting for it or reading its body. */
const timeoutCodes: ReadonlySet<unknown> = new Set([
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/** The system error codes Node and undici give for a connection lost after the request may have gone out. */
const lostCodes: ReadonlySet<unknown> = new Set([
  'ECONNRESET',
  'UND_ERR_SOCKET',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
]);

/** What `fetch` threw, told by the call's signal first, then by the error; none for something to rethrow. */
export function thrownHappenedOf(
  error: unknown,
  signal: AbortSignal | undefined,
): Happened | undefined {
  if (signal?.aborted === true) {
    return { kind: abortKindOf(signal.reason), error: signal.reason };
  }
  const kind = thrownKindOf(error);
  return kind === undefined ? undefined : { kind, error };
}

/** What a response that arrived left, a body that failed told by the call's signal first, then by the error. */
export function answeredHappenedOf(answered: Answered, signal: AbortSignal | undefined): Happened {
  if (answered.kind === 'status') {
    return answered;
  }
  const { status, headers, error } = answered;
  if (signal?.aborted === true) {
    return { kind: abortKindOf(signal.reason), error: signal.reason, status, headers };
  }
  return bodyFailureKindOf(error) === 'timeout'
    ? { kind: 'timeout', error, status, headers }
    : answered;
}

/** An aborted call, told a timeout or an abort by its reason's name, never by its class. */
export function abortKindOf(reason: unknown): 'aborted' | 'timeout' {
  return nameOf(reason) === 'TimeoutError' ? 'timeout' : 'aborted';
}

/** Whether a network failure lost a connection that may have carried the request, so a retry may succeed. */
export function isConnectionLost(error: unknown): boolean {
  return lostCodes.has(codeOf(error));
}

/** What `fetch` threw, told by its error: the kinds of a call that sent nothing back. */
type ThrownKind = 'aborted' | 'timeout' | 'no-connection' | 'connection-failed';

function thrownKindOf(error: unknown): ThrownKind | undefined {
  switch (nameOf(error)) {
    case 'TimeoutError':
      return 'timeout';
    case 'AbortError':
      return 'aborted';
    case 'TypeError':
      return networkKindOf(codeOf(error));
    default:
      return undefined;
  }
}

/** A network failure by its system error code; one with none, as browsers throw, is any other. */
function networkKindOf(code: unknown): 'no-connection' | 'timeout' | 'connection-failed' {
  if (noConnectionCodes.has(code)) {
    return 'no-connection';
  }
  return timeoutCodes.has(code) ? 'timeout' : 'connection-failed';
}

function bodyFailureKindOf(error: unknown): 'timeout' | 'unreadable-body' {
  return timeoutCodes.has(codeOf(error)) ? 'timeout' : 'unreadable-body';
}

function codeOf(error: unknown): unknown {
  return fieldOf(fieldOf(error, 'cause'), 'code');
}

function nameOf(value: unknown): unknown {
  return fieldOf(value, 'name');
}

function fieldOf(value: unknown, field: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, field) : undefined;
}
