import type { LevelDef, Plan } from './types';
import { PINE_HOLLOW, PINE_HOLLOW_TESTS } from './pineHollow';

export const LEVELS: LevelDef[] = [PINE_HOLLOW];

/** Candidate plans per level, for headless balancing. */
export const LEVEL_TESTS: Record<string, { name: string; route: string; plan: Plan }[]> = {
  [PINE_HOLLOW.id]: PINE_HOLLOW_TESTS,
};

export function levelById(id: string | null | undefined): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id);
}
