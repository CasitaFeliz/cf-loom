import type { Committed } from '@cf-loom/contract';

/**
 * What a step scripted, as written, before its Endpoint checks it: a Success, a Rejection by a
 * code the Endpoint answers, given as `reject` was given it, or one it does not, a Fault, a reserved code, or what the client
 * infers its Fault from, a network failure or a bare status.
 */
export type Answer =
  | { readonly kind: 'success'; readonly success: unknown }
  | { readonly kind: 'rejection'; readonly code: string; readonly given: unknown }
  | {
      readonly kind: 'unknown-rejection';
      readonly code: string;
      readonly message?: string;
      readonly headers?: unknown;
      readonly body?: unknown;
    }
  | {
      readonly kind: 'fault';
      readonly committed: Committed;
      readonly retryable: boolean;
      readonly message: string;
      readonly retryAfter?: unknown;
    }
  | { readonly kind: 'reserved'; readonly code: unknown }
  | { readonly kind: 'no-connection' }
  | { readonly kind: 'reset' }
  | {
      readonly kind: 'status';
      readonly status: number;
      readonly headers: Readonly<Record<string, string>>;
    };

/** The key a scripted answer is held under, which no test can name. */
const answerKey: unique symbol = Symbol('@cf-loom/testing.answer');

/** What a step returns, built only by its `r`, so a test cannot answer what no builder offers. */
export type ScriptedAnswer = { readonly [answerKey]: Answer };

/** An answer as a step returns it. */
export function scriptedAnswerOf(answer: Answer): ScriptedAnswer {
  return { [answerKey]: answer };
}

/** Whether a step returned what its `r` built, whatever its types said. */
export function isScriptedAnswer(returned: unknown): returned is ScriptedAnswer {
  return typeof returned === 'object' && returned !== null && answerKey in returned;
}

/** The answer a step's `r` built. */
export function answerOf(scripted: ScriptedAnswer): Answer {
  return scripted[answerKey];
}
