import type { Command, Endpoint, Guard, Subscription } from '@cf-loom/contract';
import { isCommand, messageIdentityOf } from '@cf-loom/contract/internal';
import type { Issue } from '../checks/index.ts';
import type { Fault } from '../outcomes/index.ts';
import type { MessageRun } from './message-run.ts';
import type { HandledElement, Run } from './run.ts';

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
export function messageAnswerOf(
  element: Command | Subscription,
  run: MessageRun,
): Fault | undefined {
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

/** One line per Issue, where it sits and what broke, never the received value. */
function messageOf(element: HandledElement, issues: readonly Issue[]): string {
  return issues.map((issue) => lineOf(element, issue)).join('\n');
}

function lineOf(element: HandledElement, { part, path, code, message }: Issue): string {
  const where = [part, ...path].join('.');
  return `${elementNameOf(element)}: ${where} ${code}: ${message}`;
}
