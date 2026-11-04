import { describe, expect, it } from 'vitest';
import { getTerrain } from '../src/world/terrain';
import { CHARGE_SPOTS, PADS } from '../src/world/places';
import { buildOps, opsObstacles, opsSpots } from '../src/render/opsView';

// The working mountain's infrastructure stands where it belongs and never in the way of play.
describe('the working mountain', () => {
  const t = getTerrain();
  const spots = opsSpots();

  it('keeps every piece off the roads, tracks and piste, the charge spots and the station yard', () => {
    for (const s of spots) {
      const r = t.onRoute(s.x, s.z, 0);
      if (s.kind !== 'sign') expect(r && r.d < r.route.width + 1.5, `${s.kind} at ${s.x}, ${s.z}`).toBeFalsy();
      for (const c of CHARGE_SPOTS) expect(Math.hypot(s.x - c.x, s.z - c.z), `${s.kind} by charge ${c.id}`).toBeGreaterThan(12);
      const hq = PADS.find((p) => p.id === 'hq')!;
      expect(Math.hypot(s.x - hq.x, s.z - hq.z)).toBeGreaterThan(hq.r);
      expect(t.inBounds(s.x, s.z, 20)).toBe(true);
    }
  });

  it('puts the signs at the roadside, beside the road not on it', () => {
    for (const s of spots.filter((s) => s.kind === 'sign')) {
      const r = t.onRoute(s.x, s.z, 10);
      expect(r, 'near a road').toBeTruthy();
      expect(r!.d).toBeGreaterThan(r!.route.width * 0.5 + 0.5);
    }
  });

  it('builds in a handful of draw calls, with the solid pieces as obstacles', () => {
    const g = buildOps(t);
    let meshes = 0;
    g.traverse((o) => (meshes += (o as { isMesh?: boolean }).isMesh ? 1 : 0));
    expect(meshes).toBeLessThanOrEqual(3);
    expect(opsObstacles(t).length).toBeGreaterThan(5);
    for (const k of ['fence', 'exploder', 'repeater', 'sign', 'snowcat', 'headframe', 'minecabin']) expect(spots.some((s) => s.kind === k), k).toBe(true);
  });
});
