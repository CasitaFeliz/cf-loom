import { describe, expect, test } from 'vitest';
import { received, resetServiceCode } from '../src/service-code.ts';

resetServiceCode();
const { payments } = await import('../snippets/testing-faking-providers.ts');
const outcomes = [...received];

describe('the testing README’s fakeProvider example', () => {
  test('the Handler receives each scripted Outcome as its comments say', () => {
    expect(outcomes).toMatchObject([
      { kind: 'rejection', code: 'NOT_FOUND' },
      { kind: 'unknown-rejection', code: 'CARD_EXPIRED' },
      { kind: 'fault', status: 503, committed: 'no', retryable: true, retryAfter: '30' },
      { kind: 'fault', source: 'no-connection', committed: 'no' },
      { kind: 'fault', source: 'connection-lost', committed: 'unknown', retryable: true },
      { kind: 'fault', status: 502, committed: 'unknown', retryable: false },
      { kind: 'success', body: { id: 'pay-1', amount: 1200 } },
    ]);
  });

  test('the Handler calls getPayment seven times, each with the Input it sent', () => {
    const sent = { params: { paymentId: 'pay-1' }, headers: { 'x-api-key': 'k' } };

    expect(payments.calls('getPayment')).toEqual(Array.from({ length: 7 }, () => sent));
  });
});

describe('the testing README’s verify example', () => {
  test('the verify example’s Handler takes the Fake Provider’s one Step, and verify throws nothing', async () => {
    const verified = await import('../snippets/testing-faking-providers-2.ts');

    expect(verified.payments.calls('getPayment')).toHaveLength(1);
  });
});
