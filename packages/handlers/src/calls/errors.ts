import type { Endpoint, Guard } from '@cf-loom/contract';
import { isCommand, messageIdentityOf } from '@cf-loom/contract/internal';
import type { Issue } from '../checks/index.ts';
import type { Fault } from '../outcomes/index.ts';
import type { HandledElement, MessageElement } from './elements.ts';
import type { MessageRun } from './message-run.ts';
import type { Run } from './run.ts';

/** Thrown by a direct call given Input, demands, Context, a Qualifier or a Message body that breaks the Contract. */
export class InvalidInputError extends Error {
  override readonly name = 'InvalidInputError';
  readonly issues: readonly Issue[];

  constructor(element: HandledElement, issues: readonly Issue[]) {
    super(messageOf(element, issues));
    this.issues = issues;
  }
}

/** Thrown by a direct call whose Handler built an Outcome that breaks the Contract. */
export class InvalidOutcomeError extends Error {
  override readonly name = 'InvalidOutcomeError';
  readonly issues: readonly Issue[];

  constructor(element: HandledElement, issues: readonly Issue[]) {
    super(messageOf(element, issues));
    this.issues = issues;
  }
}

/** What a direct call returns: the answer, or a throw when the call or the Handler broke the Contract. */
export function answerOf<Answer>(element: Endpoint | Guard, run: Run<Answer>): Answer | Fault {
  switch (run.kind) {
    case 'invalid-input':
      throw new InvalidInputError(element, run.issues);
    case 'invalid-outcome':
      throw new InvalidOutcomeError(element, run.issues);
    case 'thrown':
      return run.fault;
    case 'answered':
      return run.answer;
  }
}

/**
 * What a Message Handler's direct call answers: nothing or the Fault it returned; a throw is
 * rethrown, and a body that breaks its Reader throws.
 */
export function messageAnswerOf(element: MessageElement, run: MessageRun): Fault | undefined {
  switch (run.kind) {
    case 'invalid-input':
      throw new InvalidInputError(element, run.issues);
    case 'thrown':
      throw run.cause;
    case 'answered':
      return run.answer;
  }
}

/**
 * How errors and logs name an Element: a Command's Message Version by its identity,
 * `ChargeCard@1`, any other by its name.
 */
export function elementNameOf(element: HandledElement): string {
  if (isCommand(element)) {
    return messageIdentityOf(element.name, element.version);
  }
  return element.name;
}

/** Which Handler a Fault came from, as both hooks name it: its declaration, and the name it goes by in lines and metrics. */
export type HandlerFaultBase<Element extends HandledElement> = {
  readonly element: Element;
  readonly identity: string;
};

/** How a Handler failed, as `serve`'s and messaging's `onServiceFault` both receive it. */
export type HandlerFailure =
  | { readonly kind: 'returned'; readonly fault: Fault }
  | { readonly kind: 'thrown'; readonly cause: unknown };

/** The console line of a hook that threw or rejected, after what it was called for. */
export function hookThrewLineOf(source: string, hook: 'onServiceFault' | 'onOutcome'): string {
  return faultLineOf(source, { message: `${hook} threw` });
}

/** One Issue as a line of an error or a log, after what it came from: where it sits and what broke, never the received value. */
export function issueLineOf(source: string, { part, path, code, message }: Issue): string {
  return `${source}: ${[part, ...path].join('.')} ${code}: ${message}`;
}

/** A Fault as a line of a log or an error, after what it came from: its message, never its `cause`. */
export function faultLineOf(source: string, fault: { readonly message: string }): string {
  return `${source}: ${fault.message}`;
}

/** A line as the console logs it: the line, then its `cause` when it has one. */
export function logOf(line: string, cause: unknown): readonly unknown[] {
  return cause === undefined ? [line] : [line, cause];
}

/** A Fault as the console logs it, after what it came from: its message, then its `cause` when it has one. */
export function faultLogOf(
  source: string,
  fault: { readonly message: string; readonly cause?: unknown },
): readonly unknown[] {
  return logOf(faultLineOf(source, fault), fault.cause);
}

/** One line per Issue, naming the Element. */
function messageOf(element: HandledElement, issues: readonly Issue[]): string {
  return issues.map((issue) => issueLineOf(elementNameOf(element), issue)).join('\n');
}
