import type { LevelDef } from '../levels/types';
import type { RunResult } from '../run/runner';
import { COMPOSITIONS, type CompositionId, type UnlockStats } from '../sim/composition';

export type Medal = 'none' | 'bronze' | 'silver' | 'gold' | 'platinum';
export const MEDALS: Medal[] = ['none', 'bronze', 'silver', 'gold', 'platinum'];

export interface LevelProgress {
  attempts: number;
  finished: boolean;
  medal: Medal;
  /** best total score */
  bestScore: number;
  /** best destruction (before bonuses) */
  bestDestruction: number;
  /** longest chain reaction */
  bestChain: number;
  /** fastest finished descent (s) */
  bestTime: number | null;
  bestComposition?: CompositionId;
  /** every stretch of mountain ever ridden (segment ids) */
  found: string[];
  /** complete routes ever finished (segment ids joined by '>') */
  routes: string[];
  /** from earlier versions of the game: kept so old saves load intact */
  bestRetained?: number;
  bestMass?: number;
  objectives?: string[];
  lastTrail?: [number, number, number][];
}

export interface Progress {
  v: 3;
  levels: Record<string, LevelProgress>;
  settings: { sound: boolean; music: boolean };
  tutorial: { selected: boolean; released: boolean; reviewed: boolean; decided?: boolean };
  composition: CompositionId;
  lastLevel?: string;
}

const KEY = 'rockslide.progress.v3';
/** saves from before the ROCKSLIDE name: moved to KEY on first load */
const LEGACY_KEYS = ['erode.progress.v3'];

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
  v: 3,
  levels: {},
  settings: { sound: true, music: true },
  tutorial: { selected: false, released: false, reviewed: false },
  composition: 'granite',
});

const blank = (): LevelProgress => ({ attempts: 0, finished: false, medal: 'none', bestScore: 0, bestDestruction: 0, bestChain: 0, bestTime: null, found: [], routes: [] });

export function loadProgress(): Progress {
  migrate();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const p = JSON.parse(raw) as Progress;
    if (p.v !== 3) return fresh();
    const out = { ...fresh(), ...p, settings: { ...fresh().settings, ...p.settings }, tutorial: { ...fresh().tutorial, ...p.tutorial } };
    for (const id of Object.keys(out.levels)) {
      const lp = { ...blank(), ...out.levels[id] };
      // older saves stored route ids of a different kind: keep only complete routes from this version
      lp.routes = (lp.routes ?? []).filter((r) => r.includes('>'));
      lp.found ??= [];
      out.levels[id] = lp;
    }
    if (!COMPOSITIONS.some((c) => c.id === out.composition)) out.composition = 'granite';
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

export function levelProgress(p: Progress, id: string): LevelProgress {
  p.levels[id] ??= blank();
  return p.levels[id];
}

export function medalRank(m: Medal): number {
  return MEDALS.indexOf(m);
}

export function medalFor(level: LevelDef, r: RunResult): Medal {
  if (!r.finished) return 'none';
  const t = r.score.total;
  const m = level.medals;
  return t >= m.platinum ? 'platinum' : t >= m.gold ? 'gold' : t >= m.silver ? 'silver' : 'bronze';
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
  firstFinish: boolean;
  bestScore: boolean;
  bestChain: boolean;
  medal: Medal;
  medalUp: boolean;
  /** stretches of mountain ridden for the first time */
  newSegments: string[];
  newRoute: boolean;
  unlockedCompositions: string[];
  unlockedLevel: string | null;
  previous: { score: number; medal: Medal };
}

/** Fold a run into the save and report what's new. */
export function recordResult(p: Progress, levels: LevelDef[], level: LevelDef, r: RunResult): Records {
  const lp = levelProgress(p, level.id);
  const beforeComps = COMPOSITIONS.filter((c) => c.unlock.check(unlockStats(p))).map((c) => c.id);
  const idx = levels.findIndex((l) => l.id === level.id);
  const nextWasLocked = idx >= 0 && idx + 1 < levels.length && !levelUnlocked(p, levels, idx + 1);
  const medal = medalFor(level, r);
  const rec: Records = {
    firstFinish: false,
    bestScore: false,
    bestChain: false,
    medal,
    medalUp: false,
    newSegments: [],
    newRoute: false,
    unlockedCompositions: [],
    unlockedLevel: null,
    previous: { score: lp.bestScore, medal: lp.medal },
  };
  for (const s of r.route)
    if (!lp.found.includes(s)) {
      lp.found.push(s);
      rec.newSegments.push(s);
    }
  if (r.stats.longestChain > lp.bestChain) {
    rec.bestChain = lp.bestChain > 0;
    lp.bestChain = r.stats.longestChain;
  }
  if (r.score.total > lp.bestScore) {
    rec.bestScore = lp.bestScore > 0;
    lp.bestScore = r.score.total;
    lp.bestDestruction = r.score.destruction;
    lp.bestComposition = r.composition;
  }
  if (r.finished) {
    rec.firstFinish = !lp.finished;
    lp.finished = true;
    if (lp.bestTime === null || r.duration < lp.bestTime - 0.05) lp.bestTime = r.duration;
    const key = r.route.join('>');
    if (!lp.routes.includes(key)) {
      rec.newRoute = lp.routes.length > 0;
      lp.routes.push(key);
    }
    if (medalRank(medal) > medalRank(lp.medal)) {
      rec.medalUp = true;
      lp.medal = medal;
    }
  }
  const afterComps = COMPOSITIONS.filter((c) => c.unlock.check(unlockStats(p))).map((c) => c.id);
  rec.unlockedCompositions = afterComps.filter((c) => !beforeComps.includes(c)).map((c) => COMPOSITIONS.find((q) => q.id === c)!.name);
  if (nextWasLocked && levelUnlocked(p, levels, idx + 1)) rec.unlockedLevel = levels[idx + 1].name;
  return rec;
}
