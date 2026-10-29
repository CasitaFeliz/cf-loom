import { describe, expect, test } from 'vitest';
import { notifications, resetServiceCode } from '../src/service-code.ts';

resetServiceCode();
const { running } = await import('../snippets/messaging-in-memory.ts');

describe('the messaging README’s In memory example', () => {
  test('the direct call of createOrderHandler passes the apiKey Context, publishes OrderCreated v2 and v1 and sends ChargeCard', () => {
    const subjects = running.messages.map((message) => message.subject);

    expect(subjects.toSorted()).toEqual([
      'orders-service.command.ChargeCard.v1',
      'orders-service.event.OrderCreated.v1',
      'orders-service.event.OrderCreated.v2',
    ]);
  });

  test('it hands a settled payment to its Subscription, which notifies it', () => {
    expect(notifications.sent).toEqual(['pay-1']);
  });
});
