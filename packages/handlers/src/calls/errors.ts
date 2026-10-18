import type { Endpoint, Guard } from '@casitafeliz/loom-contract';
import type { Issue } from '../checks/index.ts';
import type { Run } from './run.ts';

/** Thrown by a direct call given Input, demands, Context or a Qualifier that breaks the Contract. */
export class InvalidInputError extends Error {
  override readonly name = 'InvalidInputError';
  readonly issues: readonly Issue[];

  constructor(element: Endpoint | Guard, issues: readonly Issue[]) {
    super(messageOf(element, issues));
    this.issues = issues;
  }
}

/** Thrown by a direct call whose Handler built an Outcome that breaks the Contract. */
export class InvalidOutcomeError extends Error {
  override readonly name = 'InvalidOutcomeError';
  readonly issues: readonly Issue[];

  constructor(element: Endpoint | Guard, issues: readonly Issue[]) {
    super(messageOf(element, issues));
    this.issues = issues;
  }
}

/** What a direct call returns: the answer, or a throw when the call or the Handler broke the Contract. */
export function answerOf<Answer>(element: Endpoint | Guard, run: Run<Answer>): Answer {
  switch (run.kind) {
    case 'invalid-input':
      throw new InvalidInputError(element, run.issues);
    case 'invalid-outcome':
      throw new InvalidOutcomeError(element, run.issues);
    case 'answered':
      return run.outcome;
  }
}

/** One line per Issue, where it sits and what broke, never the received value. */
function messageOf(element: Endpoint | Guard, issues: readonly Issue[]): string {
  return issues.map((issue) => lineOf(element, issue)).join('\n');
}

function lineOf(element: Endpoint | Guard, { part, path, code, message }: Issue): string {
  const where = [part, ...path].join('.');
  return `${element.name}: ${where} ${code}: ${message}`;
}
