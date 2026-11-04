import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ANKLE, cycleLength, dutyFactor, footAt, gaitShape, HEEL, legFK, legIK, LEG, Spring, THIGH, SHIN, TOE } from '../src/render/gait';
import { PatrollerMesh } from '../src/render/characterMesh';

describe('the leg solver', () => {
  it('puts the ankle where it was asked, knee bent forward', () => {
    for (const [f, d] of [
      [0, 0.85],
      [0.3, 0.8],
      [-0.35, 0.75],
      [0.1, 0.5],
      [0.45, 0.6],
    ]) {
      const a = legIK(f, d);
      const p = legFK(a.hip, a.knee);
      expect(p.fwd).toBeCloseTo(f, 4);
      expect(p.down).toBeCloseTo(d, 4);
      expect(a.knee).toBeLessThanOrEqual(0);
    }
  });

  it('straightens toward a target out of reach instead of breaking', () => {
    const a = legIK(0, 3);
    expect(a.knee).toBeCloseTo(0, 1);
    expect(Number.isFinite(a.hip)).toBe(true);
    expect(THIGH + SHIN + ANKLE).toBeCloseTo(LEG, 6);
  });
});

describe('the gait', () => {
  it('strides lengthen and the flight phase appears as you speed up', () => {
    expect(cycleLength(5.8)).toBeGreaterThan(cycleLength(2.6));
    expect(cycleLength(2.6)).toBeGreaterThan(cycleLength(1));
    expect(dutyFactor(1)).toBeGreaterThan(0.5);
    expect(dutyFactor(5.8)).toBeLessThan(0.5);
  });

  it('the sole stays put on the snow: the heel as the toe comes down, the ball as the heel lifts', () => {
    for (const v of [1.2, 2.2, 3.2, 5.8]) {
      const L = cycleLength(v);
      const dt = 1 / 240;
      let world0: number | null = null;
      let drift = 0;
      let x = 0;
      let heel = true;
      for (let i = 0; i < 2400; i++) {
        x += v * dt;
        const f = footAt(x / L, v);
        if (f.planted) {
          // whichever point of the sole is on the ground
          const p = f.pitch;
          const w = p >= 0 ? x + f.fwd - HEEL * Math.cos(p) + ANKLE * Math.sin(p) : x + f.fwd + TOE * Math.cos(p) + ANKLE * Math.sin(p);
          // the contact point hands over from heel to ball at the flat foot, where both are down
          if (world0 === null || heel !== p >= 0) world0 = w;
          heel = p >= 0;
          drift = Math.max(drift, Math.abs(w - world0));
        } else world0 = null;
      }
      expect(drift).toBeLessThan(0.003);
    }
  });

  it('runs like a runner: a flight phase, a long stride and a human cadence', () => {
    const run = gaitShape(5.8);
    expect(run.duty).toBeLessThan(0.35);
    // two steps per cycle; distance runners and joggers sit around 160-200 steps a minute
    const cadence = (120 * 5.8) / run.L;
    expect(cadence).toBeGreaterThan(165);
    expect(cadence).toBeLessThan(215);
    // the swing heel comes up behind (recovery) well above the walking clearance
    let peak = 0;
    for (let p = run.duty; p < 1; p += 0.01) peak = Math.max(peak, footAt(p, 5.8).lift);
    expect(peak).toBeGreaterThan(0.3);
    const walk = gaitShape(1.4);
    expect((120 * 1.4) / walk.L).toBeGreaterThan(100);
    expect((120 * 1.4) / walk.L).toBeLessThan(150);
  });
});

describe('springs', () => {
  it('settle on the target without overshooting, at any frame rate', () => {
    for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
      const s = new Spring(0);
      let max = 0;
      for (let t = 0; t < 1; t += dt) max = Math.max(max, s.step(1, dt, 0.2));
      expect(max).toBeLessThanOrEqual(1 + 1e-6);
      expect(s.x).toBeGreaterThan(0.99);
    }
  });
});

describe('the patroller walking', () => {
  // walk the mesh forward at a speed (or a speed over time) and watch the soles in the world
  const BALL = new THREE.Vector3(0, -ANKLE, -TOE);
  const HEELP = new THREE.Vector3(0, -ANKLE, HEEL);
  const walk = (speedAt: (t: number) => number, seconds = 8) => {
    const m = new PatrollerMesh();
    const g = m.group;
    const inner = m as unknown as { L: { ankle: THREE.Object3D }; R: { ankle: THREE.Object3D } };
    const dt = 1 / 60;
    let z = 0;
    const p = new THREE.Vector3();
    let low = 9;
    let high = -9;
    let slide = 0;
    let airborne = 0;
    const down = new Map<string, { x: number; z: number } | null>();
    for (let i = 0, t = 0; t < seconds; i++, t += dt) {
      const v = speedAt(t);
      z -= v * dt;
      g.position.set(0, 0, z);
      m.animate(v > 4 ? 'run' : v > 0.3 ? 'walk' : 'idle', -z, v, 0, dt);
      g.updateMatrixWorld(true);
      if (i < 90) continue; // let the springs settle into the gait
      let touching = 0;
      for (const [side, a] of [
        ['L', inner.L.ankle],
        ['R', inner.R.ankle],
      ] as const) {
        a.getWorldPosition(p);
        low = Math.min(low, p.y);
        high = Math.max(high, p.y);
        for (const [pt, local] of [
          ['ball', BALL],
          ['heel', HEELP],
        ] as const) {
          p.copy(local);
          a.localToWorld(p);
          const key = side + pt;
          if (p.y < 0.012) {
            touching++;
            const d = down.get(key);
            if (!d) down.set(key, { x: p.x, z: p.z });
            else if (v > 0.5) slide = Math.max(slide, Math.hypot(p.x - d.x, p.z - d.z));
          } else down.set(key, null);
        }
      }
      if (!touching) airborne++;
    }
    return { low, high, slide, airborne };
  };

  it('plants its feet on the snow and lifts them to step', () => {
    const w = walk(() => 2.0);
    expect(w.low).toBeGreaterThan(ANKLE - 0.03);
    expect(w.low).toBeLessThan(ANKLE + 0.03);
    expect(w.high - w.low).toBeGreaterThan(0.05);
    // a walk always has a foot down
    expect(w.airborne).toBe(0);
  });

  it('does not skate: a boot on the snow stays where it landed, walking or running', () => {
    for (const v of [1.2, 2.2, 3.2, 5.8]) {
      const w = walk(() => v);
      expect(w.slide).toBeLessThan(0.015);
    }
  });

  it('has a flight phase at a run', () => {
    expect(walk(() => 5.8).airborne).toBeGreaterThan(30);
  });

  it('keeps its feet planted while speeding up into a run and slowing to a walk', () => {
    // the walker's own response: about 7.5 m/s² up, 13 down
    const w = walk((t) => (t < 2 ? 1.4 : t < 3 ? Math.min(5.8, 1.4 + (t - 2) * 7.5) : t < 5 ? 5.8 : Math.max(1.6, 5.8 - (t - 5) * 13)), 7);
    expect(w.slide).toBeLessThan(0.025);
  });
});
