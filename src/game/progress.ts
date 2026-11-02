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
}

export interface Progress {
  v: 1;
  levels: Record<string, LevelProgress>;
  settings: { sound: boolean; music: boolean };
  tutorial: { selected: boolean; released: boolean; reviewed: boolean };
}

const KEY = 'erode.progress.v2';

const fresh = (): Progress => ({
  v: 1,
  levels: {},
  settings: { sound: true, music: true },
  tutorial: { selected: false, released: false, reviewed: false },
});

export function loadProgress(): Progress {
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
