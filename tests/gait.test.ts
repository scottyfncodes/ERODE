import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ANKLE, cycleLength, dutyFactor, footAt, legFK, legIK, LEG, Spring, THIGH, SHIN } from '../src/render/gait';
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

  it('a planted foot moves back exactly as fast as the body moves forward', () => {
    for (const v of [1.2, 2.6]) {
      const L = cycleLength(v);
      const dt = 1 / 120;
      let world0: number | null = null;
      let drift = 0;
      let x = 0;
      for (let i = 0; i < 600; i++) {
        x += v * dt;
        const f = footAt(x / L, v, 10);
        if (f.planted) {
          const w = x + f.fwd;
          if (world0 === null) world0 = w;
          drift = Math.max(drift, Math.abs(w - world0));
        } else world0 = null;
      }
      expect(drift).toBeLessThan(0.01);
    }
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
  // walk the mesh forward and watch its ankles in the world
  const walk = (speed: number, pose: 'walk' | 'run') => {
    const m = new PatrollerMesh();
    const g = m.group;
    const inner = m as unknown as { L: { ankle: THREE.Object3D }; fL: { planted: boolean } };
    const side = inner.L.ankle;
    const dt = 1 / 60;
    let z = 0;
    const p = new THREE.Vector3();
    const lows: number[] = [];
    let slip = 0;
    let prev: THREE.Vector3 | null = null;
    for (let i = 0; i < 360; i++) {
      z -= speed * dt;
      g.position.set(0, 0, z);
      m.animate(pose, -z, speed, 0, dt);
      g.updateMatrixWorld(true);
      side.getWorldPosition(p);
      if (i < 120) continue; // let the springs settle into the gait
      lows.push(p.y);
      // while the foot is planted it should hardly travel
      if (inner.fL.planted) {
        if (prev) slip = Math.max(slip, Math.abs(p.z - prev.z) / dt);
        prev = p.clone();
      } else prev = null;
    }
    return { low: Math.min(...lows), high: Math.max(...lows), slip };
  };

  it('plants its feet on the snow and lifts them to step', () => {
    const w = walk(2.0, 'walk');
    expect(w.low).toBeGreaterThan(ANKLE - 0.03);
    expect(w.low).toBeLessThan(ANKLE + 0.03);
    expect(w.high - w.low).toBeGreaterThan(0.05);
  });

  it('does not skate: a planted foot moves far slower than the body', () => {
    for (const [v, pose] of [
      [1.2, 'walk'],
      [2.6, 'walk'],
      [5.8, 'run'],
    ] as const) {
      const w = walk(v, pose);
      // measured: about 4% walking, 12% at a full run
      expect(w.slip).toBeLessThan(v * 0.16);
    }
  });
});
