import type { LevelDef, Plan } from '../levels/types';
import type { Medal, SimResult } from '../sim/simulation';
import { MEDALS } from '../sim/simulation';
import { COMPOSITIONS, type CompositionId, type UnlockStats } from '../sim/composition';

export interface LevelProgress {
  attempts: number;
  finished: boolean;
  medal: Medal;
  /** best fraction of starting mass retained on a finished descent */
  bestRetained: number;
  /** most kilograms brought to the bottom */
  bestMass: number;
  /** fastest finished descent (s) */
  bestTime: number | null;
  bestComposition?: CompositionId;
  /** optional objectives ever completed */
  objectives: string[];
  /** routes ever finished */
  routes: string[];
  lastPlan?: Plan;
  /** trajectory of the previous attempt, for the ghost line */
  lastTrail?: [number, number, number][];
}

export interface Progress {
  v: 3;
  levels: Record<string, LevelProgress>;
  settings: { sound: boolean; music: boolean };
  tutorial: { selected: boolean; released: boolean; reviewed: boolean };
  composition: CompositionId;
  lastLevel?: string;
}

const KEY = 'erode.progress.v3';

const fresh = (): Progress => ({
  v: 3,
  levels: {},
  settings: { sound: true, music: true },
  tutorial: { selected: false, released: false, reviewed: false },
  composition: 'granite',
});

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const p = JSON.parse(raw) as Progress;
    if (p.v !== 3) return fresh();
    const out = { ...fresh(), ...p, settings: { ...fresh().settings, ...p.settings }, tutorial: { ...fresh().tutorial, ...p.tutorial } };
    for (const id of Object.keys(out.levels)) out.levels[id] = { ...blank(), ...out.levels[id] };
    return out;
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

const blank = (): LevelProgress => ({ attempts: 0, finished: false, medal: 'none', bestRetained: 0, bestMass: 0, bestTime: null, objectives: [], routes: [] });

export function levelProgress(p: Progress, id: string): LevelProgress {
  p.levels[id] ??= blank();
  return p.levels[id];
}

export function medalRank(m: Medal): number {
  return MEDALS.indexOf(m);
}

export function unlockStats(p: Progress): UnlockStats {
  const s: UnlockStats = { finished: new Set(), silver: 0, gold: 0, platinum: 0 };
  for (const [id, lp] of Object.entries(p.levels)) {
    if (lp.finished) s.finished.add(id);
    const r = medalRank(lp.medal);
    if (r >= 2) s.silver++;
    if (r >= 3) s.gold++;
    if (r >= 4) s.platinum++;
  }
  return s;
}

export function compositionUnlocked(p: Progress, id: CompositionId): boolean {
  const c = COMPOSITIONS.find((q) => q.id === id);
  return !!c && c.unlock.check(unlockStats(p));
}

/** A mountain opens once the one above it has been descended. */
export function levelUnlocked(p: Progress, levels: LevelDef[], i: number): boolean {
  return i === 0 || !!p.levels[levels[i - 1].id]?.finished;
}

export interface Records {
  bestRetained: boolean;
  bestMass: boolean;
  bestTime: boolean;
  medalUp: boolean;
  firstFinish: boolean;
  newObjectives: string[];
  newRoute: boolean;
  /** compositions and mountains this result opened up */
  unlockedCompositions: string[];
  unlockedLevel: string | null;
  previous: { retained: number; time: number | null; medal: Medal };
}

/** Fold a finished run into the save and report what's new. */
export function recordResult(p: Progress, levels: LevelDef[], level: LevelDef, r: SimResult): Records {
  const lp = levelProgress(p, level.id);
  const beforeComps = COMPOSITIONS.filter((c) => c.unlock.check(unlockStats(p))).map((c) => c.id);
  const idx = levels.findIndex((l) => l.id === level.id);
  const nextWasLocked = idx >= 0 && idx + 1 < levels.length && !levelUnlocked(p, levels, idx + 1);
  const previous = { retained: lp.bestRetained, time: lp.bestTime, medal: lp.medal };
  const rec: Records = {
    bestRetained: false,
    bestMass: false,
    bestTime: false,
    medalUp: false,
    firstFinish: false,
    newObjectives: [],
    newRoute: false,
    unlockedCompositions: [],
    unlockedLevel: null,
    previous,
  };
  if (r.finished) {
    rec.firstFinish = !lp.finished;
    lp.finished = true;
    if (r.retained > lp.bestRetained + 1e-6) {
      rec.bestRetained = lp.bestRetained > 0;
      lp.bestRetained = r.retained;
      lp.bestComposition = r.composition;
    }
    if (r.mass > lp.bestMass + 0.5) {
      rec.bestMass = lp.bestMass > 0;
      lp.bestMass = r.mass;
    }
    if (lp.bestTime === null || r.duration < lp.bestTime - 0.05) {
      rec.bestTime = lp.bestTime !== null;
      lp.bestTime = r.duration;
    }
    if (medalRank(r.medal) > medalRank(lp.medal)) {
      rec.medalUp = true;
      lp.medal = r.medal;
    }
    if (r.route && !lp.routes.includes(r.route)) {
      rec.newRoute = lp.routes.length > 0;
      lp.routes.push(r.route);
    }
  }
  for (const o of r.objectives)
    if (o.done && !lp.objectives.includes(o.id)) {
      lp.objectives.push(o.id);
      rec.newObjectives.push(o.id);
    }
  const afterComps = COMPOSITIONS.filter((c) => c.unlock.check(unlockStats(p))).map((c) => c.id);
  rec.unlockedCompositions = afterComps.filter((c) => !beforeComps.includes(c)).map((c) => COMPOSITIONS.find((q) => q.id === c)!.name);
  if (nextWasLocked && levelUnlocked(p, levels, idx + 1)) rec.unlockedLevel = levels[idx + 1].name;
  return rec;
}
