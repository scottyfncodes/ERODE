import type { LevelDef, Plan } from './types';
import { PINE_HOLLOW, PINE_HOLLOW_TESTS } from './pineHollow';
import { GRANITE_RIDGE, GRANITE_RIDGE_TESTS } from './graniteRidge';
import { WHITEOUT_COULOIR, WHITEOUT_COULOIR_TESTS } from './whiteoutCouloir';
import { REDWALL_CANYON, REDWALL_CANYON_TESTS } from './redwallCanyon';
import { SUMMIT_TO_SEA, SUMMIT_TO_SEA_TESTS } from './summitToSea';

/** The mountains, in the order they open up. */
export const LEVELS: LevelDef[] = [PINE_HOLLOW, GRANITE_RIDGE, WHITEOUT_COULOIR, REDWALL_CANYON, SUMMIT_TO_SEA];

/** Candidate plans per level, for headless balancing. */
export const LEVEL_TESTS: Record<string, { name: string; route: string; plan: Plan }[]> = {
  [PINE_HOLLOW.id]: PINE_HOLLOW_TESTS,
  [GRANITE_RIDGE.id]: GRANITE_RIDGE_TESTS,
  [WHITEOUT_COULOIR.id]: WHITEOUT_COULOIR_TESTS,
  [REDWALL_CANYON.id]: REDWALL_CANYON_TESTS,
  [SUMMIT_TO_SEA.id]: SUMMIT_TO_SEA_TESTS,
};

export function levelById(id: string | null | undefined): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id);
}
