import { describe, expect, test } from 'vitest';
import {
  snsFactIdAttribute,
  snsHeadersAttribute,
  snsMessageIdAttribute,
  snsSubjectAttribute,
} from '../internal/index.ts';

const attributeNames = [
  snsSubjectAttribute,
  snsMessageIdAttribute,
  snsFactIdAttribute,
  snsHeadersAttribute,
];

const snsAttributeName = /^(?!(?:aws|amazon)\.)[A-Za-z0-9._-]{1,256}$/i;

describe('the SNS message attribute names', () => {
  test.each(attributeNames)('%s is a name SNS accepts for a message attribute', (name) => {
    expect(name).toMatch(snsAttributeName);
  });

  test('the four names are distinct', () => {
    expect(new Set(attributeNames).size).toBe(attributeNames.length);
  });
});
