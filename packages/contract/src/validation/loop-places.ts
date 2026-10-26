import {
  type Loop,
  type Memo,
  movedFrom,
  type NotAllowed,
  type Place,
  type Reach,
  type Step,
  siteTextOf,
} from '../walker/index.ts';
import { byLocation, type MemoPlaces } from './memo-places.ts';

/**
 * Where a refused cycle no id names is told: once at each site that meets it, where a walk of
 * that site alone closes it, so the line depends on no other declaration.
 */
export function loopPlacesOf(
  refusal: NotAllowed,
  loop: Loop,
  places: MemoPlaces,
): readonly Place[] {
  const [closing] = loop;
  const firstBySite = new Map<string, Place>();
  for (const member of loop) {
    const around = stepsAround(refusal, closing, member);
    for (const entry of entriesOf(member, loop, places)) {
      const at: Place = { ...entry, steps: [...entry.steps, ...around] };
      const key = siteTextOf(at.site);
      const known = firstBySite.get(key);
      if (known === undefined || byLocation(at, known) < 0) {
        firstBySite.set(key, at);
      }
    }
  }
  return [...firstBySite.values()];
}

/**
 * The steps from a schema of the cycle around it and back: the walk that refused the cycle met
 * the first schema again at the refusal, and entered the others on the way.
 */
function stepsAround(refusal: Place, closing: Memo, member: Memo): readonly Step[] {
  const toClose = refusal.steps.slice(member.at.steps.length);
  const fromClose = member.at.steps.slice(closing.at.steps.length);
  return [...toClose, ...fromClose];
}

/** The places a schema of the cycle is entered from outside it, each site's first through the schemas around. */
function entriesOf(member: Memo, loop: Loop, places: MemoPlaces): readonly Place[] {
  const isOutside = ({ within }: Reach) => within === undefined || !loop.includes(within);
  return member.reaches.filter(isOutside).flatMap((reach) => placesOfReach(reach, places));
}

function placesOfReach({ at, within }: Reach, places: MemoPlaces): readonly Place[] {
  if (within === undefined) {
    return [at];
  }
  const sites = places.sitesOf(within);
  return sites.map((site) => movedFrom(at, within.at, places.firstOf(within, site)));
}
