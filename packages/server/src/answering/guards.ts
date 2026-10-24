import type { Endpoint, Guard } from '@cf-loom/contract';
import { contextProvidersOf, type ReadingSource } from '@cf-loom/contract/internal';
import { runGuard } from '@cf-loom/handlers/internal';
import type { ServedContract } from '../served/index.ts';
import type { Call } from './call.ts';
import { type Answered, answeredOfFailedRun, answeredOfNotSuccess } from './runs.ts';

/** The GuardHandler runs of one request, and the Context the Endpoint receives once they admit. */
export type GuardRuns = {
  readonly admit: NonNullable<ReadingSource<Answered>['admit']>;
  readonly context: () => Readonly<Record<string, unknown>>;
};

/**
 * The runs of a request's Attachments: each with its Guard's parsed demands, the admitted Context
 * of the Guards it lists and its Qualifier; one that does not admit the request answers it.
 */
export function guardRunsOf(
  call: Call,
  { standards, resources }: Pick<ServedContract, 'standards' | 'resources'>,
): GuardRuns {
  const contexts = new Map<Guard, unknown>();
  const endpoint = call.endpoint.declared;
  const admit: GuardRuns['admit'] = async (index, demands) => {
    const attachment = call.endpoint.attachments[index];
    if (attachment === undefined) {
      throw new Error(`${endpoint.name} has no Attachment at ${index}`);
    }
    const context = contextOf(attachment.guard, contexts);
    const given = { demands, context, qualifier: attachment.qualifier, resources };
    const run = await runGuard(attachment.handler, given, standards);
    const faultedBy = { endpoint: endpoint.name, guard: attachment.guard.name };
    if (run.kind !== 'answered') {
      return { kind: 'stopped', answer: answeredOfFailedRun(run, faultedBy, standards) };
    }
    if (run.answer.kind !== 'admitted') {
      return { kind: 'stopped', answer: answeredOfNotSuccess(run.answer, faultedBy) };
    }
    contexts.set(attachment.guard, run.answer.context);
    return { kind: 'admitted' };
  };
  return { admit, context: () => contextOf(endpoint, contexts) };
}

/** The Context an Endpoint or a Guard receives: the admitted Context of each Guard it reads, by name. */
function contextOf(
  receiving: Endpoint | Guard,
  contexts: ReadonlyMap<Guard, unknown>,
): Readonly<Record<string, unknown>> {
  const providers = contextProvidersOf(receiving);
  return Object.fromEntries(providers.map((guard) => [guard.name, contexts.get(guard)]));
}
