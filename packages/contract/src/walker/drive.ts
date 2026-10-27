import type { Visit, Walked, Walking } from './walked.ts';

/**
 * Runs a walk to its result with an explicit stack of the walks it enters, each schema a frame,
 * so a schema's depth, through defs, lazies or wrappers, is bounded by memory and never by the
 * call stack. A walk that throws throws through it unchanged: a throw is a bug, so no frame is
 * resumed after one.
 */
export function walkedBy(walking: Walking, enter: (visit: Visit) => Walking): Walked {
  const frames: Walking[] = [walking];
  let step = walking.next();
  for (;;) {
    if (!step.done) {
      const entered = enter(step.value);
      frames.push(entered);
      step = entered.next();
      continue;
    }
    frames.pop();
    const holder = frames.at(-1);
    if (holder === undefined) {
      return step.value;
    }
    step = holder.next(step.value);
  }
}
