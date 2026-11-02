import { beforeAll, describe, expect, it } from 'vitest';
import type RAPIER_T from '@dimforge/rapier3d-deterministic-compat';
import { loadRapier } from '../src/sim/rapier';
import { Simulation, FRAME, restingBoulder, type SimResult } from '../src/sim/simulation';
import { PINE_HOLLOW as L } from '../src/levels/pineHollow';
import { LEVELS, LEVEL_TESTS } from '../src/levels/index';
import { GRANITE_RIDGE } from '../src/levels/graniteRidge';
import { defaultPlan, sanitizePlan } from '../src/sim/plan';
import { loadLevelData } from '../src/sim/levelData';
import { makeAutopilot } from '../src/sim/autopilot';
import { COMPOSITIONS, composition, severityOf, type CompositionId } from '../src/sim/composition';
import { recordResult, type Progress } from '../src/game/progress';
import type { Plan } from '../src/levels/types';

let R: typeof RAPIER_T;
beforeAll(async () => {
  R = await loadRapier();
});

const GOOD: Plan = { 'loose-gully': { type: 'rock', removed: true, x: 11.5, z: 96 }, 'ledge-log': { type: 'log', yaw: 2.36, x: 2, z: 197 } };

function drive(plan: Plan, route: string, comp: CompositionId = 'granite', watch?: (sim: Simulation) => void) {
  const sim = new Simulation(R, L, sanitizePlan(L, plan), { composition: comp });
  const pilot = makeAutopilot(sim, route);
  while (!sim.done) {
    sim.steer = pilot();
    sim.stepOnce();
    watch?.(sim);
  }
  const r = sim.result as SimResult;
  const rec = sim.recording;
  sim.dispose();
  return { r, rec };
}

describe('the mountains', () => {
  it('every level is well formed', () => {
    const ids = new Set<string>();
    for (const l of LEVELS) {
      expect(ids.has(l.id)).toBe(false);
      ids.add(l.id);
      expect(l.routes.length).toBeGreaterThanOrEqual(2);
      expect(l.objectives.length).toBeGreaterThanOrEqual(3);
      expect(l.medals.silver).toBeLessThan(l.medals.gold);
      expect(l.medals.gold).toBeLessThan(l.medals.platinum);
      expect(l.finish.z).toBeGreaterThan(l.boulder.position[1]);
      expect(l.finish.z).toBeLessThan(l.terrain.bounds.z[1]);
      for (const o of l.objectives) if (o.type === 'route') expect(l.routes.some((r) => r.id === o.route)).toBe(true);
      for (const o of l.objectives) if (o.type === 'smash') expect(l.objects.some((q) => q.id === o.object)).toBe(true);
    }
  });
  it('physics mesh matches the height function', () => {
    const d = loadLevelData(L);
    for (const [i, j] of [
      [10, 10],
      [48, 200],
      [80, 380],
    ]) {
      const x = d.grid.x0 + i * d.grid.cell,
        z = d.grid.z0 + j * d.grid.cell;
      expect(d.heightAt(x, z)).toBeCloseTo(d.terrain.height(x, z), 3);
    }
  });
});

describe('mass', () => {
  it('starting mass is the boulder volume times the stone density', () => {
    const v = restingBoulder(L).shape.volume;
    for (const c of COMPOSITIONS) {
      const sim = new Simulation(R, L, defaultPlan(L), { composition: c.id });
      expect(sim.startMass).toBeCloseTo(v * c.density * 1000, 0);
      sim.dispose();
    }
    expect(composition('basalt').density).toBeGreaterThan(composition('sandstone').density);
  });

  it('severity bands follow the share of mass lost', () => {
    expect(severityOf(100, 10000)).toBe('minor');
    expect(severityOf(300, 10000)).toBe('moderate');
    expect(severityOf(900, 10000)).toBe('major');
  });

  it('the descent is deterministic for the same plan', () => {
    const a = drive(GOOD, 'gully').r;
    const b = drive(GOOD, 'gully').r;
    expect(a.mass).toBe(b.mass);
    expect(a.duration).toBe(b.duration);
  }, 120000);

  it('a good plan reaches the bottom with a medal, and the ledger adds up', () => {
    const { r } = drive(GOOD, 'gully');
    expect(r.finished).toBe(true);
    expect(['silver', 'gold', 'platinum']).toContain(r.medal);
    expect(r.retained).toBeGreaterThan(0.8);
    expect(r.retained).toBeLessThan(1);
    expect(r.massLost).toBeCloseTo(r.startMass - r.mass, 3);
    // every kilogram is accounted for by impacts, fractures or wear
    expect(r.impactLoss + r.splitLoss + r.abrasionLoss).toBeCloseTo(r.massLost, -1);
    expect(r.route).toBe('gully');
    expect(r.objectives.find((o) => o.id === 'route-gully')?.done).toBe(true);
  }, 120000);

  it('the boulder only ever loses mass, and its collider shrinks with it', () => {
    let last = Infinity;
    let firstScale = 1;
    let lastScale = 1;
    drive(GOOD, 'gully', 'granite', (sim) => {
      const h = sim.hero;
      if (!h || sim.crossed) return;
      const m = sim.massOf(h);
      expect(m).toBeLessThanOrEqual(last + 1e-6);
      last = m;
      if (sim.step === 1) firstScale = h.physScale;
      lastScale = h.physScale;
    });
    expect(lastScale).toBeLessThan(firstScale);
  }, 120000);

  it('a barrier stops a stone that lacks the momentum, and a heavy fast one bursts through', () => {
    const granite = drive({}, 'forest', 'granite').r;
    expect(granite.smashed).toContain('logjam');
    const sand = drive({}, 'forest', 'sandstone').r;
    expect(sand.smashed).not.toContain('logjam');
    expect(sand.finished).toBe(false);
    expect(sand.cause).toMatch(/log jam/);
  }, 180000);

  it('records aligned replay frames with a hero and a mass per frame', () => {
    const { rec } = drive(GOOD, 'gully');
    expect(rec.leader.length).toBe(rec.frames);
    expect(rec.mass.length).toBe(rec.frames);
    for (const t of rec.tracks) {
      expect(Number.isInteger(t.data.length / FRAME)).toBe(true);
      expect(t.data.every(Number.isFinite)).toBe(true);
    }
  }, 120000);
});

describe('progression', () => {
  it('medals, records and unlocks come from real results', () => {
    const p: Progress = { v: 3, levels: {}, settings: { sound: true, music: true }, tutorial: { selected: false, released: false, reviewed: false }, composition: 'granite' };
    const base = { finished: true, composition: 'granite', duration: 50, route: L.routes[0].id, objectives: [], mass: 9000, retained: 0.9, medal: 'gold' } as unknown as SimResult;
    const a = recordResult(p, LEVELS, L, base);
    expect(a.firstFinish).toBe(true);
    expect(a.unlockedCompositions).toContain('Sandstone');
    expect(p.levels[L.id].medal).toBe('gold');
    const worse = recordResult(p, LEVELS, L, { ...base, retained: 0.7, mass: 7000, medal: 'bronze', duration: 40 } as SimResult);
    expect(worse.bestRetained).toBe(false);
    expect(worse.bestTime).toBe(true);
    expect(p.levels[L.id].medal).toBe('gold');
    expect(p.levels[L.id].bestRetained).toBe(0.9);
    const dnf = recordResult(p, LEVELS, L, { ...base, finished: false, retained: 0.99, medal: 'none' } as SimResult);
    expect(dnf.bestRetained).toBe(false);
    expect(p.levels[L.id].bestRetained).toBe(0.9);
  });
});

describe('every mountain', () => {
  it('can be finished with a medal by at least one planned route', () => {
    for (const level of LEVELS) {
      const tests = LEVEL_TESTS[level.id];
      let best = 0;
      for (const t of tests) {
        const sim = new Simulation(R, level, sanitizePlan(level, t.plan));
        const pilot = makeAutopilot(sim, t.route);
        while (!sim.done) {
          sim.steer = pilot();
          sim.stepOnce();
        }
        if (sim.result!.finished) best = Math.max(best, sim.result!.retained);
        sim.dispose();
        if (best >= level.medals.silver) break;
      }
      expect(best, level.id).toBeGreaterThanOrEqual(level.medals.silver);
    }
  }, 600000);

  it('a narrow passage refuses a full-size stone and admits a worn one', () => {
    const tests = LEVEL_TESTS[GRANITE_RIDGE.id];
    const run = (name: string) => {
      const t = tests.find((q) => q.name === name)!;
      const sim = new Simulation(R, GRANITE_RIDGE, sanitizePlan(GRANITE_RIDGE, t.plan));
      const pilot = makeAutopilot(sim, t.route);
      while (!sim.done) {
        sim.steer = pilot();
        sim.stepOnce();
      }
      const r = sim.result!;
      sim.dispose();
      return r;
    };
    const asFound = run('needle as found');
    expect(asFound.finished).toBe(false);
    expect(asFound.cause).toMatch(/Wedged in the Needle/);
    const worn = run('needle, sentinel');
    expect(worn.finished).toBe(true);
    expect(worn.route).toBe('needle');
  }, 120000);
});
