import { beforeAll, describe, expect, it } from 'vitest';
import type RAPIER_T from '@dimforge/rapier3d-deterministic-compat';
import { loadRapier } from '../src/sim/rapier';
import { Simulation, STAGES, stageOf, gradeFor, MIN_PHYSICAL_RADIUS } from '../src/sim/simulation';
import { SUMMIT_TO_SEA as L } from '../src/levels/summitToSea';
import { activeWater, countInterventions, defaultPlan, isModified, sanitizePlan } from '../src/sim/plan';
import { loadLevelData } from '../src/sim/levelData';
import type { Plan } from '../src/levels/types';

let R: typeof RAPIER_T;
beforeAll(async () => {
  R = await loadRapier();
});

const set = (p: Plan, id: string, v: object) => Object.assign(p[id], v);
function plan(mod: (p: Plan) => void): Plan {
  const p = defaultPlan(L);
  mod(p);
  return p;
}
const clearAll = (p: Plan) => {
  set(p, 'logjam', { removed: true });
  set(p, 'debris', { removed: true });
  set(p, 'beaver', { removed: true });
  set(p, 'sandbar', { dug: true });
  set(p, 'weir', { option: 'right' });
};
const allSmashers = (p: Plan) => {
  clearAll(p);
  for (const id of ['tooth-1', 'tooth-2', 'crusher-1', 'crusher-2']) set(p, id, { split: true });
};
const run = (p: Plan) => {
  const sim = new Simulation(R, L, p);
  const r = sim.runToEnd();
  const rec = sim.recording;
  sim.dispose();
  return { r, rec };
};

describe('the course', () => {
  it('physics mesh matches the height function at grid points', () => {
    const d = loadLevelData(L);
    for (const [i, j] of [
      [10, 10],
      [48, 500],
      [80, 1000],
    ]) {
      const x = d.grid.x0 + i * d.grid.cell,
        z = d.grid.z0 + j * d.grid.cell;
      expect(d.heightAt(x, z)).toBeCloseTo(d.terrain.height(x, z), 3);
    }
  });

  it('runs downhill from a high summit to the sea', () => {
    const d = loadLevelData(L);
    expect(d.heightAt(0, -14) - d.heightAt(4, 1060)).toBeGreaterThan(250);
    // a real waterfall: a big drop over a few metres
    expect(d.heightAt(0, 470) - d.heightAt(0.5, 482)).toBeGreaterThan(20);
  });

  it('rivers never flow uphill', () => {
    const d = loadLevelData(L);
    for (const w of d.water) for (let i = 1; i < w.bed.length; i++) expect(w.bed[i]).toBeLessThanOrEqual(w.bed[i - 1]);
  });
});

describe('plan rules', () => {
  it('counts moves only for changed objects', () => {
    const p = defaultPlan(L);
    expect(countInterventions(L, p)).toBe(0);
    clearAll(p);
    expect(countInterventions(L, p)).toBe(5);
  });

  it('the weir chooses which delta channel runs', () => {
    expect(activeWater(L, defaultPlan(L)).has('channel-marsh')).toBe(true);
    const w = activeWater(L, plan((q) => set(q, 'weir', { option: 'right' })));
    expect(w.has('channel-beach')).toBe(true);
    expect(w.has('channel-marsh')).toBe(false);
  });

  it('sanitises stored plans', () => {
    const p = sanitizePlan(L, { logjam: { type: 'rock', removed: true }, nonsense: 1, debris: { type: 'branches', removed: true } });
    expect(p.logjam.type).toBe('branches');
    expect((p.debris as { removed: boolean }).removed).toBe(true);
    const o = L.objects.find((x) => x.id === 'tooth-1')!;
    expect(isModified(o, { type: 'outcrop', split: true })).toBe(true);
  });
});

describe('size stages', () => {
  it('runs Boulder → Fragment → Rock → Pebble → Gravel → Sand', () => {
    expect(STAGES.map((s) => s.name)).toEqual(['Boulder', 'Fragment', 'Rock', 'Pebble', 'Gravel', 'Sand']);
    expect(stageOf(2)).toBe(0);
    expect(stageOf(0.3)).toBe(2);
    expect(stageOf(0.01)).toBe(4);
    expect(stageOf(0.0005)).toBe(5);
    expect(gradeFor(500000)).toBe('S');
    expect(gradeFor(1000)).toBe('D');
  });
});

describe('the run', () => {
  it('is deterministic: the same plan gives the same run', () => {
    const p = plan(clearAll);
    const a = run(p).r;
    const b = run(p).r;
    expect(a.score).toBe(b.score);
    expect(a.distance).toBeCloseTo(b.distance, 6);
    expect(a.size).toBeCloseTo(b.size, 9);
  }, 120000);

  it('left alone, the log jam stops it in the forest', () => {
    const { r } = run(defaultPlan(L));
    expect(r.landed).toBe(false);
    expect(r.destination).toBe('the forest');
    expect(r.distance).toBeGreaterThan(250);
  }, 120000);

  it('clearing every blocker carries it all the way to the beach', () => {
    const { r } = run(plan(clearAll));
    expect(r.landed).toBe(true);
    expect(r.distance).toBeGreaterThan(1000);
  }, 120000);

  it('smashers grind it smaller and score more', () => {
    const plain = run(plan(clearAll)).r;
    const smashed = run(plan(allSmashers)).r;
    expect(smashed.smashes).toBeGreaterThan(plain.smashes);
    expect(smashed.size).toBeLessThan(plain.size);
    expect(smashed.score).toBeGreaterThan(plain.score);
  }, 180000);

  it('a perfect setup reaches the beach as sand', () => {
    const { r } = run(plan(allSmashers));
    expect(r.landed).toBe(true);
    expect(r.sand).toBe(true);
    expect(r.grade).toBe('S');
  }, 120000);

  it('fractures make real fragments with their own geometry', () => {
    const { rec } = run(plan(allSmashers));
    const stones = rec.tracks.filter((t) => t.kind === 'stone');
    expect(stones.length).toBeGreaterThan(3);
    expect(stones[0].fate).toBe('fractured');
    const children = stones.slice(1);
    expect(children.every((t) => t.shape.volume < stones[0].shape.volume)).toBe(true);
    expect(children.every((t) => t.shape.radius >= MIN_PHYSICAL_RADIUS * 0.9)).toBe(true);
    expect(children.some((t) => t.shape.faces.some((f) => f.fresh))).toBe(true);
  }, 120000);

  it('nudges push the leading stone sideways and are limited', () => {
    const sim = new Simulation(R, L, plan(clearAll));
    for (let i = 0; i < 240; i++) sim.stepOnce();
    const before = sim.leader!.body.linvel();
    expect(sim.nudge(1)).toBe(true);
    const after = sim.leader!.body.linvel();
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(3);
    expect(sim.nudge(1)).toBe(true);
    expect(sim.nudge(-1)).toBe(true);
    expect(sim.nudge(1)).toBe(false);
    sim.dispose();
  }, 60000);

  it('records a replay with aligned frames and a leader per frame', () => {
    const { rec } = run(plan(clearAll));
    expect(rec.leader.length).toBe(rec.frames);
    for (const t of rec.tracks) {
      const n = t.data.length / 8;
      expect(Number.isInteger(n)).toBe(true);
      expect(t.data.every(Number.isFinite)).toBe(true);
    }
  }, 120000);
});
