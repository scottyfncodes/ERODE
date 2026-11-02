import { beforeEach, describe, expect, it } from 'vitest';

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
};

const { loadProgress, saveProgress, recordResult, levelProgress, compositionUnlocked } = await import('../src/game/progress');
const { LEVELS } = await import('../src/levels/index');
const { loadLevelData } = await import('../src/sim/levelData');
const { RunSim } = await import('../src/run/runner');

describe('save data', () => {
  beforeEach(() => store.clear());

  it('loads a save from the previous version of the game intact', () => {
    // what the mass-retention version wrote
    const old = {
      v: 3,
      levels: {
        'pine-hollow': { attempts: 12, finished: true, medal: 'gold', bestRetained: 0.93, bestMass: 9500, bestTime: 41.2, objectives: ['route-gully'], routes: ['gully', 'forest'], lastPlan: { a: 1 } },
        'granite-ridge': { attempts: 3, finished: true, medal: 'silver', bestRetained: 0.8, bestMass: 7000, bestTime: 50, objectives: [], routes: ['needle'] },
        'cinder-cone': { attempts: 1, finished: true, medal: 'gold', bestRetained: 0.8, bestMass: 7000, bestTime: 50, objectives: [], routes: [] },
      },
      settings: { sound: false, music: true },
      tutorial: { selected: true, released: true, reviewed: true },
      composition: 'basalt',
      lastLevel: 'granite-ridge',
    };
    store.set('rockslide.progress.v3', JSON.stringify(old));
    const p = loadProgress();
    expect(p.settings.sound).toBe(false);
    expect(p.composition).toBe('basalt');
    expect(p.lastLevel).toBe('granite-ridge');
    const lp = p.levels['pine-hollow'];
    expect(lp.medal).toBe('gold');
    expect(lp.finished).toBe(true);
    expect(lp.attempts).toBe(12);
    expect(lp.bestScore).toBe(0);
    expect(lp.found).toEqual([]);
    // old route ids meant something else: dropped, not misread
    expect(lp.routes).toEqual([]);
    // stones earned before stay earned
    expect(compositionUnlocked(p, 'sandstone')).toBe(true);
    expect(compositionUnlocked(p, 'basalt')).toBe(true);
    // two golds: obsidian still needs a third
    expect(compositionUnlocked(p, 'obsidian')).toBe(false);
  });

  it('migrates the pre-rename key', () => {
    store.set('erode.progress.v3', JSON.stringify({ v: 3, levels: { 'pine-hollow': { finished: true, medal: 'bronze' } }, settings: {}, tutorial: {}, composition: 'granite' }));
    const p = loadProgress();
    expect(p.levels['pine-hollow'].finished).toBe(true);
    expect(store.has('erode.progress.v3')).toBe(false);
  });

  it('records a run, keeps bests, and survives a save/reload', () => {
    const level = LEVELS[0];
    const p = loadProgress();
    const sim = new RunSim(level, loadLevelData(level));
    const r = sim.runToEnd((d) => d.options.length - 1);
    const rec = recordResult(p, LEVELS, level, r);
    expect(rec.firstFinish).toBe(true);
    expect(rec.unlockedLevel).toBe(LEVELS[1].name);
    expect(rec.newSegments.length).toBe(6);
    saveProgress(p);
    const q = loadProgress();
    const lp = levelProgress(q, level.id);
    expect(lp.bestScore).toBe(r.score.total);
    expect(lp.found.length).toBe(6);
    expect(lp.routes).toEqual([r.route.join('>')]);
    // a worse run doesn't overwrite the best
    const worse = { ...r, score: { ...r.score, total: 10 } };
    const rec2 = recordResult(q, LEVELS, level, worse);
    expect(rec2.bestScore).toBe(false);
    expect(levelProgress(q, level.id).bestScore).toBe(r.score.total);
  });
});
