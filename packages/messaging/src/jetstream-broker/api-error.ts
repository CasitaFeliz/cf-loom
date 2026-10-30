import { JetStreamApiError } from '@nats-io/jetstream';

/** Whether the NATS client failed because the server answered with this API error code, which is how it tells what does not exist. */
export function isApiError(error: unknown, code: number): boolean {
  return error instanceof JetStreamApiError && error.code === code;
}
