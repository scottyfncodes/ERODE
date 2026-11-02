import { describe, expect, it } from 'vitest';
import { getTerrain } from '../src/world/terrain';
import { PADS, CHARGE_SPOTS, BOWL } from '../src/world/places';
import { plantForest, TreeGrid } from '../src/world/forest';
import { buildColliders, SPOTS } from '../src/world/station';
import { conditions, forecast, newWeather, tickWeather, avalancheDanger, DAY_START } from '../src/world/weather';

const t = getTerrain();

describe('the valley', () => {
  it('lays every pad flat at its height', () => {
    for (const p of PADS) {
      expect(Math.abs(t.height(p.x, p.z) - p.h)).toBeLessThan(0.5);
      expect(t.slope(p.x + p.r * 0.4, p.z)).toBeLessThan(0.12);
    }
  });

  it('keeps roads and tracks climbable by sled', () => {
    for (const g of t.routes) {
      if (g.route.kind === 'piste') continue;
      for (let s = 2; s < g.heights.length - 2; s += 3) {
        const grade = Math.abs(g.heights[s + 1] - g.heights[s - 1]) / 2;
        expect(grade).toBeLessThan(0.37);
      }
    }
  });

  it('makes Kessel Bowl steep where the slab sits and gentle in the runout', () => {
    for (const c of CHARGE_SPOTS) {
      const deg = (t.slope(c.x, c.z) * 180) / Math.PI;
      expect(deg).toBeGreaterThan(28);
      expect(deg).toBeLessThan(50);
    }
    expect((t.slope(BOWL.cx, -210) * 180) / Math.PI).toBeLessThan(22);
  });

  it('plants a forest off the roads, pads and the avalanche path', () => {
    const trees = plantForest(t, 0.5);
    expect(trees.length).toBeGreaterThan(1500);
    for (const p of PADS) for (const tr of trees) expect(Math.hypot(tr.x - p.x, tr.z - p.z)).toBeGreaterThan(p.r);
    const inPath = trees.filter((tr) => tr.x > BOWL.slab.x0 && tr.x < BOWL.slab.x1 && tr.z > BOWL.slab.z0 && tr.z < -200);
    expect(inPath.length).toBe(0);
    const grid = new TreeGrid(trees);
    const tr = trees[100];
    expect(grid.near(tr.x, tr.z, 0.1)).toContain(tr);
  });

  it('builds walls you cannot walk through, with a door you can', () => {
    const c = buildColliders();
    // through the lodge wall: pushed back out
    const r = c.resolve(-22, 240, 0.4);
    expect(r.hit).toBe(true);
    // through the door: free
    expect(c.resolve(SPOTS.lodgeDoor.x, SPOTS.lodgeDoor.z, 0.4).hit).toBe(false);
  });
});

describe('weather and the day', () => {
  it('gives day one a gentle forecast and later days a varied one', () => {
    expect(forecast(1)[0].sky).toBe('clear');
    const skies = new Set<string>();
    for (let d = 2; d < 30; d++) for (const p of forecast(d)) skies.add(p.sky);
    expect(skies.size).toBe(4);
    for (let d = 2; d < 30; d++) expect(forecast(d)[0].sky).not.toBe('storm');
  });

  it('runs the clock and rolls over to the next morning', () => {
    const w = newWeather();
    for (let i = 0; i < 60 * 30; i++) tickWeather(w, 1);
    expect(w.day).toBe(2);
    expect(w.minute).toBeGreaterThanOrEqual(DAY_START);
  });

  it('has daylight at noon and none at midnight', () => {
    const w = newWeather();
    w.minute = 12 * 60;
    expect(conditions(w).light).toBeGreaterThan(0.9);
    w.minute = 23.5 * 60;
    expect(conditions(w).light).toBeLessThan(0.05);
  });

  it('rates the danger from fresh snow, and control brings it down', () => {
    const w = newWeather();
    const c = conditions(w);
    expect(avalancheDanger(w, c)).toBeGreaterThanOrEqual(3);
    w.controlled = true;
    expect(avalancheDanger(w, c)).toBeLessThanOrEqual(2);
  });
});
