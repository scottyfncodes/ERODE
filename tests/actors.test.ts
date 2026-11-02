import { describe, expect, it } from 'vitest';
import { getTerrain } from '../src/world/terrain';
import { buildColliders, SPOTS } from '../src/world/station';
import { newWalker, stepWalker, RUN } from '../src/actors/walker';
import { newGlider, stepGlider, SLED, SKIS, glideSpeed, forwardSpeed } from '../src/actors/glide';
import { newHeli, stepHeli, HELI, heliAgl } from '../src/actors/heli';
import { newHusky, stepHusky, startTrack, pet } from '../src/actors/husky';
import { pad } from '../src/world/places';

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

  it('flies off a crest at speed and lands', () => {
    const g = newGlider(0, 250, 0, t);
    g.vz = -25;
    g.vy = 6;
    let flew = false;
    for (let i = 0; i < 300; i++) {
      stepGlider(g, SLED, 0, 0, dt, t, solid, null);
      if (g.airborne) flew = true;
    }
    expect(flew).toBe(true);
    expect(g.airborne).toBe(false);
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
