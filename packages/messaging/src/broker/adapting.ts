import { brokerPrefixRule, isBrokerPrefix, unbrokenLineOf } from '@cf-loom/contract/internal';
import type { ConsumeRun, DurableConsumer } from './broker.ts';

/** What a refusal tells whoever reads it to do, when the Broker lacks what the Service's plan lists or holds it differently. */
export const planRemedy = "apply the Service's Broker plan";

/** The Broker prefix option of every adapter. */
export type BrokerPrefixed = {
  /** Goes in front of every subject, Stream and Durable consumer name, so several environments share one Broker; kebab-case of at most 64 characters, as a Service name is. */
  readonly prefix?: string | undefined;
};

/** The Broker prefix, or `null` for none; a text that is no Broker prefix throws, naming it. */
export function checkedPrefixOf(prefix: string | undefined): string | null {
  if (prefix === undefined) {
    return null;
  }
  if (!isBrokerPrefix(prefix)) {
    throw new Error(
      unbrokenLineOf(
        `The broker prefix "${prefix}" is not ${brokerPrefixRule}: leave prefix undefined for none`,
      ),
    );
  }
  return prefix;
}

/** The line refusing a Durable consumer, or what it consists of, whose shape differs from the Broker plan's, naming each difference and what to do. */
export function shapeRefusalOf(what: string, differences: readonly string[]): string {
  return `${what} ${differences.join('; ')}: ${planRemedy}`;
}

/** How long a Durable consumer waits before it pulls again after a pull failed, as when it was deleted. */
const retryPauseMs = 1_000;

/** Waits the retry pause, or less when `stopping` aborts; its timer and listener never outlive it. */
export function pause(stopping: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const wake = () => {
      clearTimeout(timer);
      stopping.removeEventListener('abort', wake);
      resolve();
    };
    const timer = setTimeout(wake, retryPauseMs);
    stopping.addEventListener('abort', wake);
    if (stopping.aborted) {
      wake();
    }
  });
}

/** What a pull of a Durable consumer came back with, as far as reporting goes: a failure with its cause, or an answer. */
export type PullAnswer =
  | { readonly kind: 'failed'; readonly cause: unknown }
  | { readonly kind: 'message' | 'none' };

/** Tells the core of a Durable consumer's first failed pull and of the first answered one after it. */
export type TroubleReporting = {
  readonly pulled: (answer: PullAnswer) => void;
  /** Whether the last pull failed, so a loop that ends while failing has told the core already. */
  readonly isFailing: () => boolean;
};

/** The reporting of one Durable consumer's pulls; the core drops what comes once it is closing. */
export function troubleReportingOf(
  durableConsumer: DurableConsumer,
  troubled: ConsumeRun['troubled'],
): TroubleReporting {
  let failing = false;
  return {
    pulled: (answer) => {
      if (answer.kind === 'failed' && !failing) {
        troubled({ durableConsumer, kind: 'pull-failed', cause: answer.cause });
      }
      if (answer.kind !== 'failed' && failing) {
        troubled({ durableConsumer, kind: 'recovered' });
      }
      failing = answer.kind === 'failed';
    },
    isFailing: () => failing,
  };
}

/** The longest delay a Node timer takes; a longer one fires after 1 ms. */
const longestTimerMs = 2_147_483_647;

/** Whose timer it is: one the process stays alive for, as the core's wait for a running Handler, or one it may exit on, as a Broker's wait for a Message nobody is handling. */
export type TimerHold = 'holds-process' | 'lets-process-exit';

/** Calls `passed` once `waitMs` has passed, timed in steps a Node timer holds; answers what stops it. */
export function afterWait(waitMs: number, passed: () => void, hold: TimerHold): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (leftMs: number) => {
    const stepMs = Math.min(leftMs, longestTimerMs);
    timer = setTimeout(() => (leftMs > stepMs ? arm(leftMs - stepMs) : passed()), stepMs);
    if (hold === 'lets-process-exit') {
      timer.unref();
    }
  };
  arm(waitMs);
  return () => clearTimeout(timer);
}
