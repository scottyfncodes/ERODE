import { describe, it, expect } from 'vitest';
import { generateBoulder, fracturePiece, clipHull } from '../src/sim/fracture';
import { Vector3 } from 'three';

describe('fracture', () => {
  const boulder = generateBoulder(1.75, 1307);

  it('generates a closed convex boulder with plausible volume', () => {
    const sphere = (4 / 3) * Math.PI * 1.75 ** 3;
    expect(boulder.volume).toBeGreaterThan(sphere * 0.6);
    expect(boulder.volume).toBeLessThan(sphere * 1.3);
    expect(boulder.faces.length).toBeGreaterThan(50);
    expect(boulder.faces.every((f) => !f.fresh)).toBe(true);
  });

  it('clips a cube by a plane into a half', () => {
    const cube: Vector3[] = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) cube.push(new Vector3(x, y, z));
    const half = clipHull(cube, { n: [1, 0, 0], d: 0 })!;
    expect(half).not.toBeNull();
    expect(Math.max(...half.map((p) => p.x))).toBeCloseTo(0, 5);
  });

  it('splits into multiple pieces that conserve volume', () => {
    for (const count of [2, 3, 5]) {
      const res = fracturePiece(boulder, [0, -1, 0.3], count, 99 + count, 0.01);
      expect(res.cells.length).toBeGreaterThanOrEqual(2);
      const total = res.cells.reduce((s, c) => s + c.shape.volume, 0) + res.dustVolume;
      expect(total).toBeCloseTo(boulder.volume, 3);
      for (const c of res.cells) {
        expect(c.shape.faces.some((f) => f.fresh)).toBe(true);
        expect(c.shape.faces.some((f) => !f.fresh)).toBe(true);
        expect(c.shape.volume).toBeLessThan(boulder.volume);
      }
    }
  });

  it('is deterministic for the same seed', () => {
    const a = fracturePiece(boulder, [1, 0, 0], 4, 7, 0.01);
    const b = fracturePiece(boulder, [1, 0, 0], 4, 7, 0.01);
    expect(a.cells.map((c) => c.shape.volume)).toEqual(b.cells.map((c) => c.shape.volume));
    expect(Array.from(a.cells[0].shape.points)).toEqual(Array.from(b.cells[0].shape.points));
  });

  it('fragments can fracture again', () => {
    const first = fracturePiece(boulder, [0, -1, 0], 3, 5, 0.01);
    const big = first.cells.sort((x, y) => y.shape.volume - x.shape.volume)[0];
    const second = fracturePiece(big.shape, [0, 0, 1], 3, 6, 0.005);
    expect(second.cells.length).toBeGreaterThanOrEqual(2);
    const total = second.cells.reduce((s, c) => s + c.shape.volume, 0) + second.dustVolume;
    expect(total).toBeCloseTo(big.shape.volume, 3);
  });
});
