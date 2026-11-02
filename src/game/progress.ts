import type { Plan } from '../levels/types';

export interface LevelProgress {
  completed: boolean;
  stars: number;
  bestDelivered: number;
  attempts: number;
  lastPlan?: Plan;
  /** primary trajectory of the previous attempt, for the ghost line */
  lastTrail?: [number, number, number][];
  bestScore?: number;
  bestGrade?: string;
  bestStage?: number;
  bestDistance?: number;
  /** most of the original boulder ever brought to the bottom (0…1) */
  bestRetained?: number;
}

export interface Progress {
  v: 1;
  levels: Record<string, LevelProgress>;
  settings: { sound: boolean; music: boolean };
  tutorial: { selected: boolean; released: boolean; reviewed: boolean };
}

const KEY = 'rockslide.progress.v2';
/** where saves lived before the ROCKSLIDE name: read once, moved to KEY, then removed */
const LEGACY_KEYS = ['erode.progress.v2'];

/** Move a save from a legacy key to the current one, so existing players keep their records. */
function migrate() {
  try {
    if (localStorage.getItem(KEY)) return;
    for (const k of LEGACY_KEYS) {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      localStorage.setItem(KEY, raw);
      localStorage.removeItem(k);
      return;
    }
  } catch {
    /* storage unavailable */
  }
}

const fresh = (): Progress => ({
  v: 1,
  levels: {},
  settings: { sound: true, music: true },
  tutorial: { selected: false, released: false, reviewed: false },
});

export function loadProgress(): Progress {
  migrate();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const p = JSON.parse(raw) as Progress;
    if (p.v !== 1) return fresh();
    return { ...fresh(), ...p, settings: { ...fresh().settings, ...p.settings }, tutorial: { ...fresh().tutorial, ...p.tutorial } };
  } catch {
    return fresh();
  }
}

export function saveProgress(p: Progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable (private mode): progress lives for this session only */
  }
}

export function levelProgress(p: Progress, id: string): LevelProgress {
  p.levels[id] ??= { completed: false, stars: 0, bestDelivered: 0, attempts: 0 };
  return p.levels[id];
}
