import type { LevelDef } from './types';
import { PINE_HOLLOW } from './pineHollow';
import { GRANITE_RIDGE } from './graniteRidge';
import { WHITEOUT_COULOIR } from './whiteoutCouloir';
import { REDWALL_CANYON } from './redwallCanyon';

/** The mountains, in the order they open up. */
export const LEVELS: LevelDef[] = [PINE_HOLLOW, GRANITE_RIDGE, WHITEOUT_COULOIR, REDWALL_CANYON];

export function levelById(id: string | null | undefined): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id);
}
