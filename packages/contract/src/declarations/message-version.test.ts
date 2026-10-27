import { describe, expect, test } from 'vitest';
import { codeNameOf, type MessageNameKind, messageOfCodeName } from '../internal/index.ts';

describe('codeNameOf', () => {
  test('a Message Version’s name in code lower-cases its first letter and appends V and its version', () => {
    const message = { name: 'OrderCreated', version: 12 };

    const name = codeNameOf(message);

    expect(name).toBe('orderCreatedV12');
  });

  test('a kind’s word comes before V and the version, so the version is always last', () => {
    const message = { name: 'OrderCreated', version: 12 };

    const name = codeNameOf(message, 'Reader');

    expect(name).toBe('orderCreatedReaderV12');
  });
});

describe('messageOfCodeName', () => {
  test.each([
    { text: 'orderCreatedV12', kind: '' },
    { text: 'orderCreatedReaderV12', kind: 'Reader' },
    { text: 'orderCreatedCommandHandlerV12', kind: 'CommandHandler' },
  ] as const)(
    '$text with kind "$kind" reads back to the Message Version it was made of',
    ({ text, kind }) => {
      const message = messageOfCodeName(text, kind);

      expect(message).toEqual({ name: 'OrderCreated', version: 12 });
    },
  );

  test.each([
    { text: 'orderCreatedV12', kind: 'Reader' },
    { text: 'orderCreatedReaderV12', kind: 'Event' },
    { text: 'OrderCreatedReaderV12', kind: 'Reader' },
    { text: 'orderCreatedReaderV012', kind: 'Reader' },
    { text: 'orderCreatedReaderV0', kind: 'Reader' },
    { text: 'ReaderV1', kind: 'Reader' },
  ] satisfies { text: string; kind: MessageNameKind }[])(
    '$text with kind "$kind" reads back to nothing, since codeNameOf writes no such name',
    ({ text, kind }) => {
      const message = messageOfCodeName(text, kind);

      expect(message).toBeUndefined();
    },
  );
});
