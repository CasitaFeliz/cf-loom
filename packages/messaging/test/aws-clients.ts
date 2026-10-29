// biome-ignore-all lint/style/useNamingConvention: AWS names its fields in PascalCase, as they travel
import { createServer } from 'node:net';
import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';
import { onTestFinished } from 'vitest';
import type { SqsConnecting } from '../src/sqs/index.ts';

/** The account moto holds topics and queues under unless a test says another. */
export const motoAccount = '123456789012';

/** The region a test's clients are in unless it says another. */
export const testRegion = 'eu-west-1';

/** SNS and SQS clients pointed at a moto server with dummy credentials and no retries, so a failing call fails at once; destroyed when the test ends. */
export function anAwsConnecting(
  url: string,
  place: {
    readonly region?: string;
    readonly sqsRegion?: string;
    readonly account?: string;
    readonly sqsUrl?: string;
  } = {},
): SqsConnecting {
  const settings = {
    region: place.region ?? testRegion,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    maxAttempts: 1,
  };
  const sns = new SNSClient({ ...settings, endpoint: url });
  const sqs = new SQSClient({
    ...settings,
    region: place.sqsRegion ?? settings.region,
    endpoint: place.sqsUrl ?? url,
  });
  onTestFinished(() => {
    sns.destroy();
    sqs.destroy();
  });
  return { sns, sqs, account: place.account ?? motoAccount };
}

/** Counts the commands of one kind a client sends from now on, such as `SetSubscriptionAttributesCommand`. */
export function countCommands(client: SNSClient, commandName: string) {
  let sent = 0;
  client.middlewareStack.add(
    (next, context) => (args) => {
      sent += context.commandName === commandName ? 1 : 0;
      return next(args);
    },
    { step: 'initialize', name: `count-${commandName}` },
  );
  return { sent: () => sent };
}

/** The URL of a local port nothing listens on: one that was just free. */
export async function aClosedUrl(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return `http://127.0.0.1:${port}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Makes a client's answers to one kind of command pass through `alter` first, as an AWS that answered otherwise would. */
export function alteringAnswers(
  client: SNSClient | SQSClient,
  commandName: string,
  alter: (output: Record<string, unknown>) => void,
): void {
  const stack = (client as SNSClient).middlewareStack;
  stack.add(
    (next, context) => async (args) => {
      const answered = await next(args);
      const output: unknown = answered.output;
      if (context.commandName === commandName && isRecord(output)) {
        alter(output);
      }
      return answered;
    },
    { step: 'initialize', name: `alter-${commandName}` },
  );
}

/** Records the inputs of the commands of one kind an SQS client sends from now on, such as `CreateQueueCommand`. */
export function recordingInputs(sqs: SQSClient, commandName: string) {
  const inputs: Record<string, unknown>[] = [];
  sqs.middlewareStack.add(
    (next, context) => (args) => {
      if (context.commandName === commandName && isRecord(args.input)) {
        inputs.push(args.input);
      }
      return next(args);
    },
    { step: 'initialize', name: `record-${commandName}` },
  );
  return { sent: () => inputs };
}
