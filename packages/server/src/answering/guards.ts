import type { Endpoint, Guard, StandardRejections } from '@casitafeliz/loom-contract';
import { contextProvidersOf, textPartsOf } from '@casitafeliz/loom-contract/internal';
import { runGuard } from '@casitafeliz/loom-handlers/internal';
import type { ServedAttachment } from '../served/index.ts';
import type { Call } from './call.ts';
import { type Answered, answeredOfFailedRun, answeredOfNotSuccess } from './runs.ts';

/** The Guards of a request admitted it, with the Context the Endpoint receives, or one answered. */
export type Admitted =
  | { readonly kind: 'admitted'; readonly context: Readonly<Record<string, unknown>> }
  | { readonly kind: 'answered'; readonly answered: Answered };

/**
 * Runs the Endpoint's Attachments in order, each with what its Guard demands, the Context of the
 * Guards it lists and its Qualifier; the first that does not admit the request answers it.
 */
export async function admittedOf(call: Call, standards: StandardRejections): Promise<Admitted> {
  const contexts = new Map<Guard, unknown>();
  const endpoint = call.endpoint.declared;
  for (const attachment of call.endpoint.attachments) {
    const run = await runGuard(attachment.handler, givenOf(call, attachment, contexts), standards);
    const faultedBy = { endpoint: endpoint.name, guard: attachment.guard.name };
    if (run.kind !== 'answered') {
      return { kind: 'answered', answered: answeredOfFailedRun(run, faultedBy, standards) };
    }
    if (run.answer.kind !== 'admitted') {
      return { kind: 'answered', answered: answeredOfNotSuccess(run.answer, faultedBy) };
    }
    contexts.set(attachment.guard, run.answer.context);
  }
  return { kind: 'admitted', context: contextOf(endpoint, contexts) };
}

function givenOf(call: Call, attachment: ServedAttachment, contexts: ReadonlyMap<Guard, unknown>) {
  return {
    demands: textPartsOf(attachment.nodes, call.source),
    context: contextOf(attachment.guard, contexts),
    qualifier: attachment.qualifier,
  };
}

/** The Context an Endpoint or a Guard receives: the admitted Context of each Guard it reads, by name. */
function contextOf(
  receiving: Endpoint | Guard,
  contexts: ReadonlyMap<Guard, unknown>,
): Readonly<Record<string, unknown>> {
  const providers = contextProvidersOf(receiving);
  return Object.fromEntries(providers.map((guard) => [guard.name, contexts.get(guard)]));
}
