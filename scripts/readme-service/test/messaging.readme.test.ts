import { describe, expect, test } from 'vitest';
import {
  charged,
  meta,
  notifications,
  ORDER_ID,
  published,
  resetServiceCode,
} from '../src/service-code.ts';

resetServiceCode();
const { running } = await import('../snippets/messaging-in-memory.ts');

describe('the messaging README’s In memory example', () => {
  test('the direct call of createOrderHandler publishes OrderCreated v2 and v1 and sends ChargeCard', () => {
    const subjects = running.messages.map((message) => message.subject);

    expect(subjects.toSorted()).toEqual([
      'orders-service.command.ChargeCard.v1',
      'orders-service.event.OrderCreated.v1',
      'orders-service.event.OrderCreated.v2',
    ]);
  });

  test('settled() hands the ChargeCard v1 it sent to its Handler', () => {
    const sent = running.messages.filter(
      (message) => message.subject === 'orders-service.command.ChargeCard.v1',
    );

    expect(charged).toEqual(sent.map((message) => (message.body as { orderId: string }).orderId));
    expect(charged).toHaveLength(1);
  });

  test('it hands a settled payment to its Subscription, which notifies it', () => {
    expect(notifications.sent).toEqual(['pay-1']);
  });
});

describe('the messaging README’s Publishing and sending example', () => {
  test('it publishes OrderCreated v2 and v1 under one Fact id, and sends ChargeCard with the Message’s traceparent', async () => {
    const { duplicates } = await import('../snippets/messaging-publishing-and-sending.ts');

    expect(duplicates).toEqual([]);
    expect(published).toMatchObject([
      { messageId: `event.OrderCreated.v2:${ORDER_ID}:created`, factId: `${ORDER_ID}:created` },
      { messageId: `event.OrderCreated.v1:${ORDER_ID}:created`, factId: `${ORDER_ID}:created` },
      {
        messageId: `command.ChargeCard.v1:${meta.factId}:charge`,
        headers: { traceparent: meta.headers['traceparent'] },
      },
    ]);
  });
});
