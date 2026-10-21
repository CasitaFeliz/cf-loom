import { z } from 'zod';
import { isStamp } from '../declarations/index.ts';
import { isSemanticVersion } from '../snapshot/index.ts';
import { isStringFormat, type StringFormat } from '../walker/index.ts';

/** A version `publish` writes: a semantic version, a prerelease included. */
export const semanticVersionText = z.custom<string>(isSemanticVersion, 'is not a semantic version');

/** An instant `generate` stamps: ISO 8601 in UTC, to the second. */
export const stampText = z.custom<string>(isStamp, 'is not a UTC instant to the second');

/** A string format SNAPSHOT.md knows. */
export const stringFormatText = z.custom<StringFormat>(
  isStringFormat,
  'is not a string format its format knows',
);
