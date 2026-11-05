import { describe, expect, it } from 'vitest';
import { getTerrain } from '../src/world/terrain';
import { buildColliders, SPOTS } from '../src/world/station';
import { Colliders } from '../src/world/colliders';
import type { Terrain } from '../src/world/terrain';
import { newWalker, stepWalker, RUN } from '../src/actors/walker';
import { newGlider, stepGlider, SLED, SKIS, glideSpeed, forwardSpeed } from '../src/actors/glide';
import { newHeli, stepHeli, HELI, heliAgl } from '../src/actors/heli';
import { newHusky, stepHusky, startTrack, pet } from '../src/actors/husky';
import { pad } from '../src/world/places';
import { CHARGE_SPOTS } from '../src/world/places';

const t = getTerrain();
const solid = buildColliders();
const dt = 1 / 60;

describe('on foot', () => {
  it('runs at about running pace on packed snow and turns to face the way', () => {
    const w = newWalker(0, 250, 0, t);
    for (let i = 0; i < 120; i++) stepWalker(w, 1, 0, dt, t, solid, null);
    expect(w.speed).toBeGreaterThan(RUN * 0.8);
    expect(Math.abs(w.yaw - -Math.PI / 2)).toBeLessThan(0.1);
    expect(Math.abs(w.y - t.height(w.x, w.z))).toBeLessThan(0.3);
  });

  it('cannot walk through the lodge wall', () => {
    const w = newWalker(-18, 241, 0, t);
    for (let i = 0; i < 240; i++) stepWalker(w, -1, 0, dt, t, solid, null);
    expect(w.x).toBeGreaterThan(-22);
  });
});

describe('the snowmobile', () => {
  it('gets up to speed on the road and holds a line', () => {
    const g = newGlider(-20, 190, Math.atan2(60, 90), t); // pointed up the pass road
    for (let i = 0; i < 60 * 6; i++) stepGlider(g, SLED, 0, 1, dt, t, solid, null);
    expect(glideSpeed(g)).toBeGreaterThan(14);
  });

  it('turns right when steered right', () => {
    const g = newGlider(0, 250, 0, t);
    for (let i = 0; i < 60; i++) stepGlider(g, SLED, 0, 1, dt, t, solid, null);
    const yaw0 = g.yaw;
    for (let i = 0; i < 60; i++) stepGlider(g, SLED, 1, 1, dt, t, solid, null);
    expect(g.yaw).toBeLessThan(yaw0 - 0.5);
  });

  it('brakes and reverses', () => {
    const g = newGlider(0, 250, 0, t);
    for (let i = 0; i < 90; i++) stepGlider(g, SLED, 0, 1, dt, t, solid, null);
    for (let i = 0; i < 400; i++) stepGlider(g, SLED, 0, -1, dt, t, solid, null);
    expect(forwardSpeed(g)).toBeLessThan(-1);
  });

  it('cannot climb a slope steeper than its track can grip, and slides back down', () => {
    // the steepest charge spot in Kessel Bowl, facing straight up it at full throttle
    const c = [...CHARGE_SPOTS].sort((a, b) => t.slope(b.x, b.z) - t.slope(a.x, a.z))[0];
    expect((t.slope(c.x, c.z) * 180) / Math.PI).toBeGreaterThan(33);
    const n = t.normal(c.x, c.z);
    const g = newGlider(c.x, c.z, Math.atan2(n.x, n.z), t);
    const y0 = g.y;
    for (let i = 0; i < 60 * 4; i++) stepGlider(g, SLED, 0, 1, dt, t, solid, null);
    expect(g.y).toBeLessThan(y0 + 0.5);
  });

  it('climbs the ridge track to Kessel Ridge', () => {
    // a rough autopilot: steer for the next point on the track
    const pts = t.routes.find((r) => r.route.id === 'bowltrack')!.route.pts;
    const g = newGlider(pts[0][0], pts[0][1], Math.atan2(-(pts[1][0] - pts[0][0]), -(pts[1][1] - pts[0][1])), t);
    let k = 1;
    for (let i = 0; i < 60 * 120 && k < pts.length; i++) {
      const [tx, tz] = pts[k];
      if (Math.hypot(tx - g.x, tz - g.z) < 10) k++;
      const want = Math.atan2(-(tx - g.x), -(tz - g.z));
      let d = want - g.yaw;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      stepGlider(g, SLED, Math.max(-1, Math.min(1, -d * 2)), glideSpeed(g) > 12 ? 0.4 : 1, dt, t, solid, null);
    }
    const r = pad('ridge');
    expect(Math.hypot(g.x - r.x, g.z - r.z)).toBeLessThan(30);
  });

  /** Ground along -z (the way the sled faces at yaw 0), as a height profile h(distance). */
  const profile = (h: (s: number) => number) => {
    const n = (s: number) => {
      const k = (h(s + 0.5) - h(s - 0.5)) / 1;
      const m = Math.hypot(1, k);
      return { x: 0, y: 1 / m, z: k / m };
    };
    return { height: (_x: number, z: number) => 100 + h(-z), normal: (_x: number, z: number) => n(-z), surface: () => 'packed', inBounds: () => true } as unknown as Terrain;
  };
  const runOver = (ground: Terrain, speed: number, profileOf = SLED) => {
    const g = newGlider(0, 0, 0, ground);
    g.vz = -speed;
    let flights = 0;
    let air = 0;
    let longest = 0;
    let relaunch = false;
    let sinceLanding = 99;
    for (let i = 0; i < 60 * 6; i++) {
      const was = g.airborne;
      stepGlider(g, profileOf, 0, 0.6, dt, ground, solid0, null);
      sinceLanding += dt;
      if (g.airborne) air += dt;
      if (!was && g.airborne && sinceLanding < 0.5) relaunch = true;
      if (was && !g.airborne) {
        if (air > 0.1) flights++;
        longest = Math.max(longest, air);
        air = 0;
        sinceLanding = 0;
      }
    }
    return { flights, longest, relaunch, airborne: g.airborne };
  };
  const solid0 = new Colliders();

  it('still flies off a real kicker at speed, lands, and does not bounce out of the landing', () => {
    // a 2 m kicker at 20 degrees, then a 4 m drop to flat snow
    const kicker = profile((s) => (s < 40 ? 0 : s < 45.5 ? (s - 40) * Math.tan(0.35) : -4));
    const r = runOver(kicker, 22);
    expect(r.flights).toBe(1);
    expect(r.longest).toBeGreaterThan(0.4);
    expect(r.airborne).toBe(false);
    expect(r.relaunch).toBe(false);
  });

  it('cannot launch again for half a second after a real landing (no bounce over rough snow)', () => {
    // a drop onto a run of sharp little crests every 6 m (rough snow beside a road)
    const rough = profile((s) => (s < 30 ? 0 : -3 - Math.abs(((s - 30) % 6) - 3) * 0.6 + (s - 30) * -0.2));
    const g = newGlider(0, 0, 0, rough);
    g.vz = -20;
    let landedAt = -1;
    let relaunchAfter = Infinity;
    for (let i = 0; i < 60 * 4; i++) {
      const was = g.airborne;
      stepGlider(g, SLED, 0, 0.6, dt, rough, solid0, null);
      if (was && !g.airborne && g.sinceLand === 0 && landedAt < 0) landedAt = i;
      if (landedAt >= 0 && !was && g.airborne && relaunchAfter === Infinity) relaunchAfter = (i - landedAt) * dt;
    }
    expect(landedAt).toBeGreaterThan(0);
    expect(relaunchAfter).toBeGreaterThanOrEqual(SLED.weight!.settle);
  });

  it('over a sharp road crest it hops low and short where the light model flew', () => {
    // a kink: up at 0.25, straight over, down at 0.25 (how the height grid meets itself at speed)
    const crest = profile((s) => (s < 60 ? (s - 60) * 0.25 : -(s - 60) * 0.25));
    const light = runOver(crest, 20, { ...SLED, weight: undefined });
    const heavy = runOver(crest, 20);
    expect(light.longest).toBeGreaterThan(0.5);
    expect(heavy.longest).toBeLessThan(light.longest / 2);
    expect(heavy.relaunch).toBe(false);
  });
});

describe('skis', () => {
  it('pick up speed down the Tannberg run without power', () => {
    const g = newGlider(560, -250, Math.PI, t);
    for (let i = 0; i < 60 * 5; i++) stepGlider(g, SKIS, 0, 0, dt, t, solid, null);
    expect(glideSpeed(g)).toBeGreaterThan(6);
  });

  it('snowplough slows you down', () => {
    const a = newGlider(560, -250, Math.PI, t);
    const b = newGlider(560, -250, Math.PI, t);
    for (let i = 0; i < 60 * 4; i++) {
      stepGlider(a, SKIS, 0, 0, dt, t, solid, null);
      stepGlider(b, SKIS, 0, -1, dt, t, solid, null);
    }
    expect(glideSpeed(b)).toBeLessThan(glideSpeed(a));
  });
});

describe('the helicopter', () => {
  it('spools up, lifts off, flies and lands again', () => {
    const h = newHeli(SPOTS.heli.x, SPOTS.heli.z, 0, t);
    h.running = true;
    for (let i = 0; i < 60 * 3; i++) stepHeli(h, HELI, 0, 0, 1, dt, t);
    expect(h.rotor).toBeGreaterThan(0.6);
    for (let i = 0; i < 60 * 6; i++) stepHeli(h, HELI, 0, 0, 1, dt, t);
    expect(h.landed).toBe(false);
    expect(heliAgl(h, t)).toBeGreaterThan(15);
    for (let i = 0; i < 60 * 4; i++) stepHeli(h, HELI, 0, -1, 0, dt, t);
    expect(h.z).toBeLessThan(SPOTS.heli.z - 40);
    expect(Math.abs(h.yaw)).toBeLessThan(0.3); // nose follows north
    for (let i = 0; i < 60 * 20 && !h.landed; i++) stepHeli(h, HELI, 0, 0, -0.6, dt, t);
    expect(h.landed).toBe(true);
  });
});

describe('Koda', () => {
  it('follows you, sits when you stop and lies down when you wait', () => {
    const d = newHusky(0, 260, t);
    const o = { x: 0, z: 250, yaw: 0, speed: 0 };
    for (let i = 0; i < 60 * 4; i++) stepHusky(d, o, dt, t, solid, []);
    expect(Math.hypot(d.x - o.x, d.z - o.z)).toBeLessThan(4);
    expect(d.anim).toBe('sit');
    for (let i = 0; i < 60 * 25; i++) stepHusky(d, o, dt, t, solid, []);
    expect(['lie', 'sniff', 'trot']).toContain(d.anim);
  });

  it('notices something hidden nearby and barks at it', () => {
    const d = newHusky(0, 250, t);
    const o = { x: 0, z: 250, yaw: 0, speed: 0 };
    const ev = [];
    for (let i = 0; i < 60 * 6; i++) ev.push(...stepHusky(d, o, dt, t, solid, [{ id: 'x', x: 15, z: 250 }]));
    expect(ev.some((e) => e.type === 'noticed')).toBe(true);
    expect(ev.some((e) => e.type === 'bark')).toBe(true);
    expect(Math.hypot(d.x - 15, d.z - 250)).toBeLessThan(2);
  });

  it('leads along a scent trail and waits for you', () => {
    const d = newHusky(0, 250, t);
    const trail = [{ x: 0, z: 240 }, { x: 0, z: 220 }, { x: 0, z: 200 }];
    startTrack(d, trail);
    const o = { x: 0, z: 252, yaw: 0, speed: 0 };
    for (let i = 0; i < 60 * 10; i++) stepHusky(d, o, dt, t, solid, []);
    // never more than ~20 m ahead of a player who stands still
    expect(Math.hypot(d.x - o.x, d.z - o.z)).toBeLessThan(21);
    let found = false;
    for (let i = 0; i < 60 * 20; i++) {
      o.z = Math.max(200, o.z - 3 * dt);
      o.speed = 3;
      if (stepHusky(d, o, dt, t, solid, []).some((e) => e.type === 'found')) found = true;
    }
    expect(found).toBe(true);
  });

  it('is happy when petted', () => {
    const d = newHusky(0, 250, t);
    pet(d);
    stepHusky(d, { x: 0, z: 248, yaw: 0, speed: 0 }, dt, t, solid, []);
    expect(d.anim).toBe('happy');
  });
});
