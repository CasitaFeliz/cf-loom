import { describe, expect, test } from 'vitest';
import { kebabCaseOf } from '../internal/index.ts';

describe('kebabCaseOf', () => {
  test.each([
    ['getOrder', 'get-order'],
    ['chargeOnCreated', 'charge-on-created'],
    ['chargeCardV1', 'charge-card-v1'],
    ['settle2xy', 'settle2xy'],
    ['settle2Xy', 'settle2-xy'],
    ['order', 'order'],
  ])('%s is %s in kebab-case', (name, kebab) => {
    const written = kebabCaseOf(name);

    expect(written).toBe(kebab);
  });
});
