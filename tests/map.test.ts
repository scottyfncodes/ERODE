import { describe, expect, it } from 'vitest';
import { fitPan, MAX_ZOOM, MIN_ZOOM, softZoom, zoomAbout } from '../src/ui/mapView';
import { ACCEL, BRAKE, RUN, stickSpeed, WALK } from '../src/actors/walker';

// The map's pinch and pan, as numbers: what stays under the fingers, how it stays in the frame, and
// how the limits give. (scripts/maptouch.mjs drives the real thing with multitouch on phone sizes.)

describe('map zoom', () => {
  it('keeps the map point under the fingers where it is', () => {
    const v = { z: 1.3, x: -40, y: 25 };
    for (const [px, py, z] of [
      [120, 200, 2],
      [10, 300, 5.5],
      [300, 40, 1],
    ]) {
      const n = zoomAbout(v, z, px, py);
      // the content point under (px, py) before and after
      expect((px - n.x) / n.z).toBeCloseTo((px - v.x) / v.z, 9);
      expect((py - n.y) / n.z).toBeCloseTo((py - v.y) / v.z, 9);
      expect(n.z).toBe(z);
    }
  });

  it('centres a map smaller than the frame and keeps a larger one covering it', () => {
    // a 300 px map in a 300 x 600 frame (a phone held upright)
    const small = fitPan({ z: 1, x: 80, y: -50 }, 300, 300, 600);
    expect(small).toEqual({ z: 1, x: 0, y: 150 });
    const big = fitPan({ z: 4, x: 100, y: -5000 }, 300, 300, 600);
    // 1200 px of map: no gap at the left, none at the bottom
    expect(big.x).toBe(0);
    expect(big.y).toBe(600 - 1200);
    const inside = fitPan({ z: 4, x: -200, y: -300 }, 300, 300, 600);
    expect(inside).toEqual({ z: 4, x: -200, y: -300 });
  });

  it('stretches past the edge under a finger, by the give', () => {
    const v = fitPan({ z: 4, x: 100, y: -300 }, 300, 300, 600, 0.3);
    expect(v.x).toBeCloseTo(30, 9);
  });

  it('resists, rather than stops, past the zoom limits', () => {
    expect(softZoom(3)).toBe(3);
    expect(softZoom(MAX_ZOOM * 2)).toBeGreaterThan(MAX_ZOOM);
    expect(softZoom(MAX_ZOOM * 2)).toBeLessThan(MAX_ZOOM * 1.4);
    expect(softZoom(MIN_ZOOM * 0.5)).toBeLessThan(MIN_ZOOM);
    expect(softZoom(MIN_ZOOM * 0.5)).toBeGreaterThan(MIN_ZOOM * 0.7);
  });
});

describe('getting about on foot', () => {
  it('asks for a speed that rises smoothly with the stick, walk to run', () => {
    expect(stickSpeed(0.05)).toBe(0);
    let last = 0;
    for (let m = 0.08; m <= 1.0001; m += 0.01) {
      const v = stickSpeed(m);
      expect(v).toBeGreaterThanOrEqual(last - 1e-9);
      // no jump bigger than a stride's worth between neighbouring throws
      expect(v - last).toBeLessThan(0.25 + (last === 0 ? 1 : 0));
      last = v;
    }
    expect(stickSpeed(0.7)).toBeCloseTo(WALK, 6);
    expect(stickSpeed(1)).toBeCloseTo(RUN, 6);
  });

  it('builds a run over a stride or two and stops quicker than it starts', () => {
    // from standing to a run, at the walker's limit: well under a second, not a frame
    expect(RUN / ACCEL).toBeGreaterThan(0.5);
    expect(RUN / ACCEL).toBeLessThan(1);
    expect(BRAKE).toBeGreaterThan(ACCEL);
  });
});
