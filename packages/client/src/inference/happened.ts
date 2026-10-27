import type { Answered, Happened } from './faults.ts';

/** The system error code Node gives for a connection the Provider refused. */
const refusedCode = 'ECONNREFUSED';

/** The system error code Node gives for a connection the Provider reset. */
const resetCode = 'ECONNRESET';

/** The system error codes Node and undici give for a request that never reached the Provider. */
const noConnectionCodes: ReadonlySet<unknown> = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  refusedCode,
  'UND_ERR_CONNECT_TIMEOUT',
]);

/** The error codes undici gives for a Provider that stopped answering, while waiting for it or reading its body. */
const timeoutCodes: ReadonlySet<unknown> = new Set([
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/** The system error codes Node and undici give for a connection lost after the request may have gone out. */
const lostCodes: ReadonlySet<unknown> = new Set([
  resetCode,
  'UND_ERR_SOCKET',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
]);

/** What `fetch` throws for a refused connection (`ECONNREFUSED`) or one lost after sending (`ECONNRESET`), by a code the client infers that Fault from. */
export function networkFailureOf(
  kind: Extract<ThrownKind, 'no-connection' | 'connection-lost'>,
): TypeError {
  const code = kind === 'no-connection' ? refusedCode : resetCode;
  return new TypeError('fetch failed', { cause: { code } });
}

/** What `fetch` threw, told by the call's signal first, then by the error; none for something to rethrow. */
export function thrownHappenedOf(
  error: unknown,
  signal: AbortSignal | undefined,
): Happened | undefined {
  if (signal?.aborted === true) {
    return abortedHappenedOf(signal);
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
    return { ...abortedHappenedOf(signal), status, headers };
  }
  const kind = bodyFailureKindOf(error);
  return kind === 'unreadable-body' ? answered : { kind, error, status, headers };
}

/** A call whose signal was aborted, a timeout or an abort by its reason; its error is the reason. */
export function abortedHappenedOf(
  signal: AbortSignal,
): Extract<Happened, { readonly kind: 'aborted' | 'timeout' }> {
  const { reason } = signal;
  return { kind: abortKindOf(reason), error: reason };
}

/** What `fetch` threw, told by its error: the kinds of a call that sent nothing back. */
type ThrownKind = 'aborted' | 'timeout' | 'no-connection' | 'connection-lost' | 'connection-failed';

function thrownKindOf(error: unknown): ThrownKind | undefined {
  const aborted = abortKindByNameOf(error);
  if (aborted !== undefined) {
    return aborted;
  }
  return nameOf(error) === 'TypeError' ? networkKindOf(codeOf(error)) : undefined;
}

/** A network failure by its system error code; one with none, as browsers throw, is any other. */
function networkKindOf(code: unknown): ThrownKind {
  if (noConnectionCodes.has(code)) {
    return 'no-connection';
  }
  if (lostCodes.has(code)) {
    return 'connection-lost';
  }
  return timeoutCodes.has(code) ? 'timeout' : 'connection-failed';
}

/** What failed a body while it was read: told by name, as a throw is, then by undici's timeout codes. */
function bodyFailureKindOf(error: unknown): 'aborted' | 'timeout' | 'unreadable-body' {
  const aborted = abortKindByNameOf(error);
  if (aborted !== undefined) {
    return aborted;
  }
  return timeoutCodes.has(codeOf(error)) ? 'timeout' : 'unreadable-body';
}

/** An error named for an abort or a timeout, told one from the other; none for any other. */
function abortKindByNameOf(error: unknown): 'aborted' | 'timeout' | undefined {
  const name = nameOf(error);
  return name === 'TimeoutError' || name === 'AbortError' ? abortKindOf(error) : undefined;
}

/** An aborted call, told a timeout or an abort by its reason's name, never by its class. */
function abortKindOf(reason: unknown): 'aborted' | 'timeout' {
  return nameOf(reason) === 'TimeoutError' ? 'timeout' : 'aborted';
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
