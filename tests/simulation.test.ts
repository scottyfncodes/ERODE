import { beforeAll, describe, expect, it } from 'vitest';
import type RAPIER_T from '@dimforge/rapier3d-deterministic-compat';
import { loadRapier } from '../src/sim/rapier';
import { Simulation, STAGES, stageOf, gradeFor, FRAME, type SimResult } from '../src/sim/simulation';
import { SUMMIT_TO_SEA as L } from '../src/levels/summitToSea';
import { defaultPlan } from '../src/sim/plan';
import { loadLevelData } from '../src/sim/levelData';
import { makeAutopilot } from '../src/sim/autopilot';

let R: typeof RAPIER_T;
beforeAll(async () => {
  R = await loadRapier();
});

type Mode = 'none' | 'line' | 'aim';
function drive(mode: Mode, watch?: (sim: Simulation) => void) {
  const sim = new Simulation(R, L, defaultPlan(L));
  const pilot = mode === 'none' ? null : makeAutopilot(sim, mode);
  while (!sim.done) {
    if (pilot) sim.steer = pilot();
    sim.stepOnce();
    watch?.(sim);
  }
  const r = sim.result as SimResult;
  const rec = sim.recording;
  sim.dispose();
  return { r, rec };
}

describe('the course', () => {
  it('physics mesh matches the height function', () => {
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
  it('runs from a high summit to the sea, over a real waterfall', () => {
    const d = loadLevelData(L);
    expect(d.heightAt(0, -14) - d.heightAt(4, 1060)).toBeGreaterThan(250);
    expect(d.heightAt(0, 470) - d.heightAt(0.5, 482)).toBeGreaterThan(20);
  });
  it('rivers never flow uphill', () => {
    const d = loadLevelData(L);
    for (const w of d.water) for (let i = 1; i < w.bed.length; i++) expect(w.bed[i]).toBeLessThanOrEqual(w.bed[i - 1]);
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
  it('is deterministic for the same inputs', () => {
    const a = drive('line').r;
    const b = drive('line').r;
    expect(a.score).toBe(b.score);
    expect(a.size).toBeCloseTo(b.size, 9);
  }, 120000);

  it('left unsteered, an obstacle stops it before the beach', () => {
    const { r } = drive('none');
    expect(r.landed).toBe(false);
  }, 120000);

  it('steering through the gaps carries it to the beach', () => {
    const { r } = drive('line');
    expect(r.landed).toBe(true);
    expect(r.distance).toBeGreaterThan(1000);
  }, 120000);

  it('aiming for the rocks grinds it much smaller', () => {
    const line = drive('line').r;
    const aim = drive('aim').r;
    expect(aim.size).toBeLessThan(line.size);
    expect(aim.score).toBeGreaterThan(line.score);
    expect(aim.stage).toBeGreaterThanOrEqual(4); // gravel or better; sand needs sharper aim than the autopilot
  }, 180000);

  it('the hero only ever shrinks, and wears smoother in the water', () => {
    let last = Infinity;
    let heroId = -1;
    let maxSmooth = 0;
    drive('line', (sim) => {
      const h = sim.hero;
      if (!h) return;
      if (h.id === heroId) expect(h.size).toBeLessThanOrEqual(last + 1e-9);
      heroId = h.id;
      last = h.size;
      maxSmooth = Math.max(maxSmooth, h.smooth);
    });
    expect(maxSmooth).toBeGreaterThan(0.3);
  }, 120000);

  it('the camera hero is always the largest stone', () => {
    drive('aim', (sim) => {
      if (sim.step % 60) return;
      const h = sim.hero;
      if (!h) return;
      const hz = h.body.translation().z;
      for (const p of sim.pieces.values())
        if (p.kind === 'stone' && p.id !== h.id && p.body.translation().z > hz - 8) expect(p.size).toBeLessThanOrEqual(h.size * 1.1);
    });
  }, 120000);

  it('crashes throw real chips off, with their own geometry', () => {
    const { rec } = drive('aim');
    const chips = rec.tracks.filter((t) => t.kind === 'chip');
    expect(chips.length).toBeGreaterThan(2);
    expect(chips.every((t) => t.shape.volume < rec.tracks.find((x) => x.kind === 'stone')!.shape.volume)).toBe(true);
  }, 120000);

  it('records aligned replay frames with a hero per frame', () => {
    const { rec } = drive('line');
    expect(rec.leader.length).toBe(rec.frames);
    for (const t of rec.tracks) {
      expect(Number.isInteger(t.data.length / FRAME)).toBe(true);
      expect(t.data.every(Number.isFinite)).toBe(true);
    }
  }, 120000);
});
