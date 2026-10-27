import type { Fault } from '../outcomes/index.ts';
import { faultLineOf, logOf } from './errors.ts';
import type { Handled } from './handled.ts';

/**
 * Where a Fault came from, as both hooks name it: its `declaration` and the name it goes by in
 * lines and metrics, `identity`. The `declaration` is what the Handler was written for, except on
 * a Guard's Fault, where it is the Endpoint the Guard was attached to.
 */
export type HandlerFaultBase<Declaration extends Handled> = {
  readonly declaration: Declaration;
  readonly identity: string;
};

/** How a Handler failed, as `serve`'s and messaging's `onServiceFault` both receive it. */
export type HandlerFailure =
  | { readonly kind: 'returned'; readonly fault: Fault }
  | { readonly kind: 'thrown'; readonly cause: unknown };

/** A hook `serve` or messaging calls. */
export type HookName = 'onServiceFault' | 'onAnswered' | 'onBrokerTrouble';

/** How a Handler's failure reads on the console, after what it came from: the Fault's message, or `the Handler threw`. */
export function failureLineOf(source: string, failure: HandlerFailure): string {
  switch (failure.kind) {
    case 'returned':
      return faultLineOf(source, failure.fault);
    case 'thrown':
      return faultLineOf(source, { message: 'the Handler threw' });
  }
}

/** The error behind a Handler's failure, which the console logs after its line. */
export function failureCauseOf(failure: HandlerFailure): unknown {
  switch (failure.kind) {
    case 'returned':
      return failure.fault.cause;
    case 'thrown':
      return failure.cause;
  }
}

/** The console line of a hook that threw or rejected, after what it was called for. */
function hookThrewLineOf(source: string, hook: HookName): string {
  return faultLineOf(source, { message: `${hook} threw` });
}

/**
 * Calls a hook and awaits it; what it throws or rejects with is logged on its `threw` line, which
 * is answered, so it never escapes.
 */
export async function hookFailureOf<Given>(
  hook: (given: Given) => void | Promise<void>,
  given: Given,
  called: { readonly source: string; readonly hook: HookName },
): Promise<string | undefined> {
  try {
    await hook(given);
    return undefined;
  } catch (e) {
    const line = hookThrewLineOf(called.source, called.hook);
    console.error(...logOf(line, e));
    return line;
  }
}
