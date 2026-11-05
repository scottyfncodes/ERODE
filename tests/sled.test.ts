import { describe, expect, it } from 'vitest';
import { SLED, type GlideProfile } from '../src/actors/glide';
import { makePolyline, pathPointAt } from '../src/sim/geom';
import { ROUTES } from '../src/world/places';
import { getTerrain } from '../src/world/terrain';
import { launch, ride } from '../scripts/sledlab';

const roads = ROUTES.filter((r) => r.kind !== 'piste');
const light: GlideProfile = { ...SLED, engine: 9.5, traction: 0.6, weight: undefined };

describe('the snowmobile on the valley roads (scripts/sledlab.ts)', () => {
  const now = ride(SLED, 1, roads);
  const before = ride(light, 1, roads);

  it('stays on the snow: far fewer, shorter jumps than the light model', () => {
    expect(now.jumpsPerKm).toBeLessThan(2.5);
    expect(now.jumpsPerKm).toBeLessThan(before.jumpsPerKm / 2.5);
    expect(now.longestAir).toBeLessThan(1.6);
    expect(now.airSeconds).toBeLessThan(before.airSeconds / 3);
  });

  it('never bounces out of a landing into the next jump, and never stalls on a road', () => {
    expect(now.bounces).toBe(0);
    expect(now.stalls).toBe(0);
  });

  it('has more power: quicker off the line and faster along the roads', () => {
    const a = launch(SLED);
    const b = launch(light);
    expect(a.secondsTo50).toBeLessThan(b.secondsTo50 * 0.9);
    expect(now.avgKmh).toBeGreaterThan(before.avgKmh * 1.15);
  });
});

describe('road junctions', () => {
  it('the pass road runs smoothly past the lake trail and the ridge track (no step or pit)', () => {
    const t = getTerrain();
    const line = makePolyline(ROUTES.find((r) => r.id === 'pass')!.pts);
    // where the lake trail and the ridge track leave it
    const junctions = [{ x: 120, z: 330 }, { x: -300, z: -158 }];
    let worst = 0;
    let atJunction = 0;
    for (let s = 2; s < line.length - 2; s += 2) {
      const a = pathPointAt(line, s - 2);
      const b = pathPointAt(line, s + 2);
      const g = Math.abs(t.height(b.x, b.z) - t.height(a.x, a.z)) / 4;
      worst = Math.max(worst, g);
      if (junctions.some((j) => Math.hypot(a.x - j.x, a.z - j.z) < 40)) atJunction = Math.max(atJunction, g);
    }
    // built to a 0.25 grade (about 0.3 measured on the height grid); the lake trail used to cut a 21 m deep
    // notch into it (grades over 2.5), the ridge track a 9 m step
    expect(atJunction).toBeLessThan(0.33);
    expect(worst).toBeLessThan(0.4);
  });
});
