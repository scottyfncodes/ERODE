import { beforeAll, describe, expect, it } from 'vitest';
import type RAPIER_T from '@dimforge/rapier3d-deterministic-compat';
import { loadRapier } from '../src/sim/rapier';
import { Simulation } from '../src/sim/simulation';
import { FIRST_DESCENT } from '../src/levels/firstDescent';
import { activeWater, countInterventions, defaultPlan, isModified, sanitizePlan } from '../src/sim/plan';
import { loadLevelData } from '../src/sim/levelData';
import type { Plan } from '../src/levels/types';

const L = FIRST_DESCENT;
const deg = Math.PI / 180;
let R: typeof RAPIER_T;

beforeAll(async () => {
  R = await loadRapier();
});

function plan(mod: (p: Plan) => void): Plan {
  const p = defaultPlan(L);
  mod(p);
  return p;
}
const set = (p: Plan, id: string, v: object) => Object.assign(p[id], v);

const run = (p: Plan) => {
  const sim = new Simulation(R, L, p);
  const r = sim.runToEnd();
  const rec = sim.recording;
  sim.dispose();
  return { r, rec };
};

describe('terrain', () => {
  it('physics mesh matches the height function at grid points', () => {
    const d = loadLevelData(L);
    const { grid, terrain } = d;
    for (const [i, j] of [
      [10, 10],
      [45, 80],
      [70, 140],
    ]) {
      const x = grid.x0 + i * grid.cell,
        z = grid.z0 + j * grid.cell;
      expect(d.heightAt(x, z)).toBeCloseTo(terrain.height(x, z), 3);
    }
  });

  it('the mountain descends from the summit to the stream', () => {
    const d = loadLevelData(L);
    const summit = d.heightAt(0, -60);
    const stream = d.heightAt(0, 38);
    expect(summit - stream).toBeGreaterThan(40);
  });

  it('the stream bed never flows uphill', () => {
    const d = loadLevelData(L);
    for (const w of d.water) for (let i = 1; i < w.bed.length; i++) expect(w.bed[i]).toBeLessThanOrEqual(w.bed[i - 1]);
  });
});

describe('plan rules', () => {
  it('counts interventions only for changed objects', () => {
    const p = defaultPlan(L);
    expect(countInterventions(L, p)).toBe(0);
    set(p, 'branches', { removed: true });
    set(p, 'gate', { option: 'left' });
    expect(countInterventions(L, p)).toBe(2);
  });

  it('treats a log rotated by 180° as unchanged', () => {
    const o = L.objects.find((x) => x.id === 'log-a')!;
    const p = defaultPlan(L);
    const s = { ...(p['log-a'] as { type: 'log'; yaw: number; x: number; z: number }) };
    s.yaw += Math.PI;
    expect(isModified(o, s)).toBe(false);
    s.yaw += 15 * deg;
    expect(isModified(o, s)).toBe(true);
  });

  it('the spring weir decides which rill runs', () => {
    expect(activeWater(L, defaultPlan(L)).has('rill-right')).toBe(true);
    const p = plan((q) => set(q, 'gate', { option: 'left' }));
    const w = activeWater(L, p);
    expect(w.has('rill-left')).toBe(true);
    expect(w.has('rill-right')).toBe(false);
    expect(w.has('stream')).toBe(true);
  });

  it('sanitises stored plans', () => {
    const p = sanitizePlan(L, { 'log-a': { type: 'rock', removed: true }, nonsense: 1, branches: { type: 'branches', removed: true } });
    expect(p['log-a'].type).toBe('log');
    expect((p.branches as { removed: boolean }).removed).toBe(true);
  });
});

describe('simulation', () => {
  it('is deterministic: the same plan gives the same descent', () => {
    const p = plan((q) => {
      set(q, 'log-a', { yaw: 90 * deg, x: -3 });
      set(q, 'branches', { removed: true });
    });
    const a = run(p).r;
    const b = run(p).r;
    expect(a.fractures.length).toBe(b.fractures.length);
    expect(a.deliveredFraction).toBeCloseTo(b.deliveredFraction, 6);
    expect(a.trajectory[a.trajectory.length - 1]).toEqual(b.trajectory[b.trajectory.length - 1]);
  }, 60000);

  it('left as it is, the mountain holds the boulder (the puzzle must be solved)', () => {
    const { r } = run(defaultPlan(L));
    expect(r.success).toBe(false);
    expect(r.deliveredFraction).toBeLessThan(0.05);
  }, 60000);

  it('the boulder rolls a long way once the chute is opened', () => {
    const { r } = run(plan((q) => set(q, 'log-a', { yaw: 90 * deg, x: -3 })));
    expect(r.distance).toBeGreaterThan(45);
  }, 60000);

  it('hard impacts break the boulder into real fragments', () => {
    const { r, rec } = run(
      plan((q) => {
        set(q, 'log-a', { yaw: 90 * deg, x: -3 });
        set(q, 'branches', { removed: true });
      }),
    );
    expect(r.fractures.length).toBeGreaterThanOrEqual(1);
    const stones = rec.tracks.filter((t) => t.kind === 'stone');
    expect(stones.length).toBeGreaterThan(2);
    // fragments carry their own geometry, smaller than the original
    const original = stones[0].shape.volume;
    const children = stones.slice(1);
    expect(children.every((t) => t.shape.volume < original)).toBe(true);
    expect(children.some((t) => t.shape.faces.some((f) => f.fresh))).toBe(true);
    // the original boulder's track ends when it breaks
    expect(stones[0].fate).toBe('fractured');
    // mass is conserved: what remains + what was lost ≈ the original
    expect(r.remainingFraction + r.lostFraction + r.sedimentFraction).toBeGreaterThan(0.97);
  }, 60000);

  it('fragments strand in the hollow unless the spruce is turned', () => {
    const base = (q: Plan) => {
      set(q, 'log-a', { yaw: 90 * deg, x: -3 });
      set(q, 'branches', { removed: true });
    };
    const stranded = run(plan(base)).r;
    const turned = run(plan((q) => { base(q); set(q, 'log-b', { yaw: 95 * deg }); })).r;
    expect(turned.deliveredFraction).toBeGreaterThan(stranded.deliveredFraction + 0.2);
  }, 60000);

  it('soft obstacles do not break the boulder', () => {
    // default: the boulder runs into the jammed log (wood) and stops whole
    const { r } = run(defaultPlan(L));
    expect(r.fractures.filter((f) => f.against.includes('trunk')).length).toBe(0);
  }, 60000);

  it('there is more than one way down: distinct plans succeed', () => {
    const solutions: Plan[] = [
      // right gully: open the chute, clear the deadfall, turn the spruce on the slab
      plan((q) => {
        set(q, 'log-a', { yaw: 90 * deg, x: -3 });
        set(q, 'branches', { removed: true });
        set(q, 'log-b', { yaw: 95 * deg });
      }),
      // left gully: fell the pine across the fan
      plan((q) => {
        set(q, 'log-a', { yaw: 90 * deg, x: -3 });
        set(q, 'tree', { felled: 'across' });
        set(q, 'soil', { dug: true });
      }),
    ];
    for (const s of solutions) {
      const { r } = run(s);
      expect(r.success).toBe(true);
    }
  }, 120000);

  it('water carries and wears stone', () => {
    const { r } = run(
      plan((q) => {
        set(q, 'log-a', { yaw: 90 * deg, x: -3 });
        set(q, 'branches', { removed: true });
      }),
    );
    expect(r.waterExposure).toBeGreaterThan(0);
    expect(r.sedimentFraction).toBeGreaterThan(0);
  }, 60000);

  it('records a replay with aligned frames for every piece', () => {
    const { rec } = run(plan((q) => set(q, 'log-a', { yaw: 90 * deg, x: -3 })));
    expect(rec.frames).toBeGreaterThan(30);
    for (const t of rec.tracks) {
      const n = t.data.length / 8;
      expect(Number.isInteger(n)).toBe(true);
      const end = t.endFrame ?? rec.frames - 1;
      expect(t.startFrame + n - 1).toBeLessThanOrEqual(end + 1);
      expect(t.data.every(Number.isFinite)).toBe(true);
    }
  }, 60000);
});
