import { describe, expect, test } from 'vitest';
import { collected } from '../../test/collected.ts';
import { heldRequestOf } from '../internal/index.ts';

/** The signal of a Request built on `source`, and a weak reference to it, keeping nothing else. */
function signalHeldFrom(source: AbortSignal): { signal: AbortSignal; ref: WeakRef<Request> } {
  const { request } = heldRequestOf('http://127.0.0.1/', { signal: source });
  return { signal: request.signal, ref: new WeakRef(request) };
}

/** As `signalHeldFrom`, its hold released at once. */
function signalReleasedFrom(source: AbortSignal): { signal: AbortSignal; ref: WeakRef<Request> } {
  const { request, release } = heldRequestOf('http://127.0.0.1/', { signal: source });
  release();
  return { signal: request.signal, ref: new WeakRef(request) };
}

describe('heldRequestOf', () => {
  test('a Request held from its signal still aborts with it after a garbage collection', async () => {
    const source = new AbortController();
    const { signal } = signalHeldFrom(source.signal);

    await collected();
    source.abort();

    expect(signal.aborted).toBe(true);
  });

  test('a released Request no longer follows its signal once collected, and nothing holds it', async () => {
    const source = new AbortController();
    const { signal, ref } = signalReleasedFrom(source.signal);

    await collected();
    source.abort();

    expect(ref.deref()).toBeUndefined();
    expect(signal.aborted).toBe(false);
  });
});
