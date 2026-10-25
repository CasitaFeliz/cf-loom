import { describe, expect, test } from 'vitest';
import { kebabCaseOf } from '../internal/index.ts';

describe('kebabCaseOf', () => {
  test.each([
    ['getOrder', 'get-order'],
    ['chargeOnCreated', 'charge-on-created'],
    ['chargeCardV1', 'charge-card-v1'],
    ['settle2x', 'settle2x'],
    ['settle2X', 'settle2-x'],
    ['order', 'order'],
  ])('%s is %s in kebab-case', (name, kebab) => {
    const written = kebabCaseOf(name);

    expect(written).toBe(kebab);
  });
});
