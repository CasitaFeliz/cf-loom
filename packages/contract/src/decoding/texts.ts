import { z } from 'zod';
import { isUtcInstant } from '../declarations/index.ts';
import { isSemanticVersion } from '../snapshot/index.ts';
import { isStringFormat, type StringFormat } from '../walker/index.ts';

/** Who a refusal says defines what a published Snapshot may hold: the Snapshot's format. */
export const formatDefiner = 'its format';

/** What a text that is no Endpoint's identity breaks, as every reader of a Snapshot words it. */
export const notEndpointIdentity =
  'is not an Endpoint’s identity: a method and a path with its params as {}';

/** A version `publish` writes: a semantic version, a prerelease included. */
export const semanticVersionText = z.custom<string>(isSemanticVersion, 'is not a semantic version');

/** An instant an Endpoint is Deprecated as of: ISO 8601 in UTC, to the second. */
export const instantText = z.custom<string>(isUtcInstant, 'is not a UTC instant to the second');

/** A string format SNAPSHOT.md knows. */
export const stringFormatText = z.custom<StringFormat>(
  isStringFormat,
  'is not a string format its format knows',
);
