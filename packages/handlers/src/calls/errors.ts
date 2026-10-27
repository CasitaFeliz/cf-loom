import type { Endpoint, Guard } from '@cf-loom/contract';
import { isCommand, issueLineOf, messageIdentityOf } from '@cf-loom/contract/internal';
import type { Issue } from '../checks/index.ts';
import type { Fault } from '../outcomes/index.ts';
import type { Handled, MessageHandled } from './handled.ts';
import type { MessageRun } from './message-run.ts';
import type { Run } from './run.ts';

/** Thrown by a direct call given Input, demands, Context, a Qualifier or a Message body that breaks the Contract. */
export class InvalidCallError extends Error {
  override readonly name = 'InvalidCallError';
  readonly issues: readonly Issue[];

  constructor(declaration: Handled, issues: readonly Issue[]) {
    super(messageOf(declaration, issues));
    this.issues = issues;
  }
}

/** Thrown by a direct call whose Handler built an Outcome that breaks the Contract. */
export class InvalidOutcomeError extends Error {
  override readonly name = 'InvalidOutcomeError';
  readonly issues: readonly Issue[];

  constructor(declaration: Handled, issues: readonly Issue[]) {
    super(messageOf(declaration, issues));
    this.issues = issues;
  }
}

/** What a direct call returns: the answer, or a throw when the call or the Handler broke the Contract. */
export function answerOf<Answer>(declaration: Endpoint | Guard, run: Run<Answer>): Answer | Fault {
  switch (run.kind) {
    case 'invalid-call':
      throw new InvalidCallError(declaration, run.issues);
    case 'invalid-outcome':
      throw new InvalidOutcomeError(declaration, run.issues);
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
export function messageAnswerOf(declaration: MessageHandled, run: MessageRun): Fault | undefined {
  switch (run.kind) {
    case 'invalid-call':
      throw new InvalidCallError(declaration, run.issues);
    case 'thrown':
      throw run.cause;
    case 'answered':
      return run.answer;
  }
}

/**
 * How errors and logs name a declaration: a Command's Message Version as `ChargeCard@1`, any
 * other by its name.
 */
export function nameOf(declaration: Handled): string {
  if (isCommand(declaration)) {
    return messageIdentityOf(declaration.name, declaration.version);
  }
  return declaration.name;
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

/** One line per Issue, naming the declaration. */
function messageOf(declaration: Handled, issues: readonly Issue[]): string {
  return issues.map((issue) => issueLineOf(nameOf(declaration), issue)).join('\n');
}
