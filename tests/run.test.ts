import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/levels/index';
import { loadLevelData } from '../src/sim/levelData';
import { RunSim, DECISION_WINDOW, type Decision } from '../src/run/runner';
import { MAX_ACTIVE } from '../src/run/debris';
import { layoutLevel } from '../src/run/layout';
import type { LevelDef } from '../src/levels/types';

/** ride a route chosen by a bit mask: bit k set → rightmost option at fork k */
function ride(level: LevelDef, mask: number, opts: { composition?: 'granite' | 'obsidian' | 'basalt'; seed?: number } = {}) {
  const sim = new RunSim(level, loadLevelData(level), opts);
  let k = 0;
  const forkSpeeds: number[] = [];
  let maxActive = 0;
  sim.release();
  while (!sim.done && sim.step < 20000) {
    const d = sim.decision;
    if (d && d.chosen === null) {
      forkSpeeds.push(sim.speed);
      sim.choose((mask >> k++) & 1 ? d.options.length - 1 : 0);
    }
    sim.stepOnce();
    sim.drainEvents();
    maxActive = Math.max(maxActive, sim.debris.active.length);
  }
  return { sim, r: sim.result!, forkSpeeds, maxActive };
}

describe('route graph', () => {
  for (const level of LEVELS) {
    it(`${level.name}: a summit, three forks and a finale on every way down`, () => {
      const byId = new Map(level.segments.map((s) => [s.id, s]));
      const walk = (id: string, forks: number): number[] => {
        const s = byId.get(id)!;
        if (!s.next.length) {
          expect(s.kind).toBe('finale');
          return [forks];
        }
        return s.next.flatMap((n) => walk(n, forks + (s.next.length > 1 ? 1 : 0)));
      };
      const counts = walk(level.start, 0);
      expect(counts.length).toBe(8);
      for (const c of counts) expect(c).toBe(3);
      // every fork offers genuinely different ground
      for (const s of level.segments)
        if (s.next.length > 1) {
          const kinds = s.next.map((n) => byId.get(n)!.kind);
          expect(new Set(kinds).size).toBe(kinds.length);
        }
    });
  }
});

describe('every branch, every mountain', () => {
  for (const level of LEVELS) {
    it(`${level.name}: all 8 routes reach the bottom in granite, at readable speeds`, () => {
      const seen = new Set<string>();
      const totals: number[] = [];
      for (let mask = 0; mask < 8; mask++) {
        const { r, forkSpeeds, maxActive } = ride(level, mask);
        expect(r.reason, r.route.join('>')).toBe('finished');
        expect(r.stats.finaleFlattened).toBe(true);
        expect(r.route.length).toBe(6);
        r.route.forEach((id) => seen.add(id));
        // never a runaway: the soft cap holds it below ~130 km/h
        expect(r.stats.topSpeed * 3.6).toBeLessThan(132);
        // never so slow at a fork that the choice feels dead
        for (const v of forkSpeeds) expect(v * 3.6).toBeGreaterThan(30);
        expect(maxActive).toBeLessThanOrEqual(MAX_ACTIVE);
        expect(r.duration).toBeGreaterThan(40);
        expect(r.duration).toBeLessThan(110);
        totals.push(r.score.total);
      }
      expect(seen.size).toBe(level.segments.length);
      // routes are not interchangeable: scores spread out
      expect(Math.max(...totals) / Math.min(...totals)).toBeGreaterThan(1.15);
    });
  }
});

describe('commitment', () => {
  const level = LEVELS[0];
  it('opens a short window before each fork, and the first choice is final', () => {
    const sim = new RunSim(level, loadLevelData(level));
    sim.release();
    expect(sim.choose(0)).toBe(false); // nothing to choose yet
    while (!sim.decision) sim.stepOnce();
    const d = sim.decision as Decision;
    expect(d.options.length).toBe(2);
    expect(d.timeLeft).toBeLessThanOrEqual(DECISION_WINDOW + 1e-6);
    expect(d.timeLeft).toBeGreaterThan(DECISION_WINDOW - 0.2);
    expect(d.options[0].side).toBe('left');
    expect(d.options[1].side).toBe('right');
    expect(sim.chooseSide('right')).toBe(true);
    expect(sim.chooseSide('left')).toBe(false);
    expect(sim.choose(0)).toBe(false);
    const from = d.from;
    while (sim.seg.seg.id === from) sim.stepOnce();
    expect(sim.seg.seg.id).toBe(d.options[1].id);
  });

  it('with no choice, the boulder follows the fall line', () => {
    const sim = new RunSim(level, loadLevelData(level));
    sim.release();
    while (!sim.decision) sim.stepOnce();
    const d = sim.decision as Decision;
    const fall = d.options[d.fallback].id;
    expect(level.segments.find((s) => s.id === fall)?.fallLine).toBe(true);
    const events: string[] = [];
    while (sim.seg.seg.id === d.from) {
      sim.stepOnce();
      for (const e of sim.drainEvents()) if (e.type === 'commit') events.push(`${e.auto}`);
    }
    expect(sim.seg.seg.id).toBe(fall);
    expect(events).toEqual(['true']);
  });

  it('the boulder never jumps when it changes segment', () => {
    const sim = new RunSim(level, loadLevelData(level));
    sim.release();
    let last = sim.pos.clone();
    let seg = sim.seg.seg.id;
    while (!sim.done && sim.step < 9000) {
      if (sim.decision && sim.decision.chosen === null) sim.choose(1);
      sim.stepOnce();
      const jump = sim.pos.distanceTo(last);
      expect(jump).toBeLessThan(1.2);
      if (sim.seg.seg.id !== seg) seg = sim.seg.seg.id;
      last = sim.pos.clone();
    }
  });
});

describe('destruction by kind of ground', () => {
  const level = LEVELS[0];
  it('forest fells timber, camps collapse, loose ground slides, gorges topple and bite', () => {
    const stats = (mask: number) => ride(level, mask).r.stats;
    // Pinewood > Logging Camp > ...
    const camp = stats(0b000);
    expect(camp.trees).toBeGreaterThan(40);
    expect(camp.structures).toBeGreaterThan(5);
    // Rubble Chute > Shale Slide > ...
    const loose = stats(0b011);
    expect(loose.slides).toBe(2);
    expect(loose.slideRocks).toBeGreaterThan(20);
    expect(loose.rocks).toBeGreaterThan(15);
    // Pinewood > Splitrock Gorge > ...
    const gorge = stats(0b010);
    expect(gorge.pillars + gorge.wallHits).toBeGreaterThan(2);
    expect(gorge.longestChain).toBeGreaterThan(5);
  });

  it('is deterministic for a seed, and varies between seeds', () => {
    const a = ride(level, 0b101, { seed: 7 }).r.score.total;
    const b = ride(level, 0b101, { seed: 7 }).r.score.total;
    const c = ride(level, 0b101, { seed: 8 }).r.score.total;
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });

  it('a fragile stone can shatter on punishing ground', () => {
    let shattered = 0;
    for (const level of LEVELS) for (let m = 0; m < 8; m++) if (ride(level, m, { composition: 'obsidian' }).r.reason === 'shattered') shattered++;
    expect(shattered).toBeGreaterThan(0);
    expect(shattered).toBeLessThan(32);
  });
});

describe('layout', () => {
  for (const level of LEVELS) {
    it(`${level.name}: destructibles in budget and every structure stands on the mountain`, () => {
      const data = loadLevelData(level);
      const L = layoutLevel(level, data);
      expect(L.trees.length).toBeGreaterThan(250);
      expect(L.trees.length).toBeLessThan(900);
      expect(L.parts.length).toBeLessThan(1400);
      expect(L.structures.filter((s) => s.finale).length).toBe(1);
      expect(L.slides.length).toBeGreaterThan(0);
      for (const s of L.structures) expect(Math.abs(s.y - data.heightAt(s.x, s.z))).toBeLessThan(12);
    });
  }
});
