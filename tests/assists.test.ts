import { describe, expect, it } from 'vitest';
import { newGlider, SLED, stepGlider } from '../src/actors/glide';
import { HELI, heliAgl, newHeli, stepHeli } from '../src/actors/heli';
import { Colliders } from '../src/world/colliders';
import type { Terrain } from '../src/world/terrain';
import { RoadNet, trimWay, wayTo } from '../src/world/routing';
import { pad } from '../src/world/places';

/** A flat valley floor at 100 m. */
const flat = { height: () => 100 } as unknown as Terrain;

/** A packed-snow slope rising to the north (towards -z) at `deg` degrees. */
function slope(deg: number): Terrain {
  const k = Math.tan((deg * Math.PI) / 180);
  const n = Math.hypot(1, k);
  return {
    height: (_x: number, z: number) => 100 - z * k,
    normal: () => ({ x: 0, y: 1 / n, z: k / n }),
    surface: () => 'packed',
    inBounds: () => true,
  } as unknown as Terrain;
}
const none = new Colliders();

describe('helicopter hover and landing assist', () => {
  const WIND = { x: 3, z: 1 };

  it('off by default: the same flight as before, step for step', () => {
    const a = newHeli(0, 0, 0, flat);
    const b = newHeli(0, 0, 0, flat);
    for (const h of [a, b]) Object.assign(h, { landed: false, running: true, rotor: 1, y: 140, vx: 5 });
    for (let i = 0; i < 600; i++) {
      const m = i < 200 ? 0.8 : 0;
      stepHeli(a, HELI, m, 0, i > 400 ? -1 : 0, 1 / 60, flat, WIND);
      stepHeli(b, HELI, m, 0, i > 400 ? -1 : 0, 1 / 60, flat, WIND, false);
    }
    expect(b).toEqual(a);
  });

  it('holds position against the wind with the stick centred', () => {
    const drift = (assist: boolean) => {
      const h = newHeli(0, 0, 0, flat);
      Object.assign(h, { landed: false, running: true, rotor: 1, y: 160 });
      for (let i = 0; i < 600; i++) stepHeli(h, HELI, 0, 0, 0, 1 / 60, flat, WIND, assist);
      return Math.hypot(h.x, h.z);
    };
    expect(drift(false)).toBeGreaterThan(10);
    expect(drift(true)).toBeLessThan(0.5);
  });

  it('brings a sliding, descending helicopter down softly onto the skids', () => {
    const land = (assist: boolean) => {
      const h = newHeli(0, 0, 0, flat);
      Object.assign(h, { landed: false, running: true, rotor: 1, y: 112, vx: 6 });
      let worst = 0;
      let t = 0;
      for (; t < 40 && !h.landed; t += 1 / 60) {
        stepHeli(h, HELI, 0, 0, -1, 1 / 60, flat, WIND, assist);
        worst = Math.max(worst, h.bump);
      }
      return { landed: h.landed, t, worst, agl: heliAgl(h, flat) };
    };
    const a = land(true);
    expect(a.landed).toBe(true);
    expect(a.worst).toBeLessThan(1.6);
    const b = land(false);
    // without the assist the same descent arrives harder (or skids on)
    expect(b.worst).toBeGreaterThan(a.worst);
  });

  it('settles onto the ground from a low hover when nothing is held', () => {
    const h = newHeli(0, 0, 0, flat);
    Object.assign(h, { landed: false, running: true, rotor: 1, y: 101.8 });
    for (let i = 0; i < 600 && !h.landed; i++) stepHeli(h, HELI, 0, 0, 0, 1 / 60, flat, { x: 0, z: 0 }, true);
    expect(h.landed).toBe(true);
  });
});

describe('sled climb assist (hill hold)', () => {
  const climb = (deg: number, hold: boolean, secs = 4, throttle = 1) => {
    const t = slope(deg);
    const g = newGlider(0, 0, 0, t);
    let held = false;
    for (let i = 0; i < secs * 60; i++) {
      stepGlider(g, SLED, 0, throttle, 1 / 60, t, none, null, 1, hold);
      held ||= g.held;
    }
    return { z: g.z, held };
  };

  it('on a climb the track can manage it changes nothing', () => {
    const a = climb(18, false);
    const b = climb(18, true);
    expect(b.z).toBeCloseTo(a.z, 9);
    expect(b.held).toBe(false);
    expect(a.z).toBeLessThan(-5); // it really climbed
  });

  it('too steep for the track: without it the sled slides back, with it the sled holds', () => {
    const off = climb(40, false);
    const on = climb(40, true);
    expect(off.z).toBeGreaterThan(2); // slid back down the hill
    expect(Math.abs(on.z)).toBeLessThan(0.3);
    expect(on.held).toBe(true);
  });

  it('never adds climbing power: it cannot get up a slope the track cannot', () => {
    const on = climb(40, true, 8);
    expect(on.z).toBeGreaterThan(-0.3);
  });

  it('lets go when you reverse, so you can back down', () => {
    const back = climb(36, true, 3, -1);
    expect(back.z).toBeGreaterThan(1);
  });
});

describe('route line way-finding', () => {
  const net = new RoadNet();

  it('takes the pass road and the ridge track from the station to Kessel Ridge', () => {
    const r = pad('ridge');
    const w = wayTo(net, { x: 5, z: 240 }, { x: r.x, z: r.z });
    expect(w.roads).toBe(true);
    expect(w.length).toBeLessThan(Math.hypot(r.x - 5, r.z - 240) * 2.2);
    // it goes by the bottom of the ridge track (-300, -158)
    expect(w.pts.some((p) => Math.hypot(p.x + 300, p.z + 158) < 25)).toBe(true);
  });

  it('goes straight when the target is close, or nowhere near a road', () => {
    expect(wayTo(net, { x: 10, z: 236 }, { x: -29, z: 246 }).roads).toBe(false);
    expect(wayTo(net, { x: 300, z: -500 }, { x: 640, z: -220 }).roads).toBe(false);
  });

  it('shows the next stretch from where you stand, ending at the target when it is near', () => {
    const w = wayTo(net, { x: 5, z: 240 }, { x: -646, z: -296 });
    const ahead = trimWay(w, { x: 5, z: 240 }, 166);
    let len = 0;
    for (let i = 1; i < ahead.length; i++) len += Math.hypot(ahead[i].x - ahead[i - 1].x, ahead[i].z - ahead[i - 1].z);
    expect(len).toBeCloseTo(166, 0);
    const near = trimWay({ pts: [{ x: 0, z: 0 }, { x: 30, z: 0 }], length: 30, roads: false }, { x: 0, z: 0 }, 166);
    expect(near[near.length - 1]).toEqual({ x: 30, z: 0 });
  });
});
