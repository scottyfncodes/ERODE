import { Euler, Quaternion, Vector3 } from 'three';
import type { LevelDef, Segment } from '../levels/types';
import type { LevelData } from '../sim/levelData';
import { makePolyline, pathDistance, pathPointAt, type Polyline } from '../sim/geom';
import { hashInts, mulberry32 } from '../sim/noise';

/**
 * Everything on the mountain that can be destroyed, laid out deterministically from the route graph.
 * Shared by the run simulation and the renderer.
 */

export interface TreeDef {
  id: number;
  x: number;
  y: number;
  z: number;
  /** height (m) */
  h: number;
  /** trunk radius (m) */
  r: number;
  yaw: number;
  variant: number;
  seg: string;
}

export type RockRole = 'rock' | 'loose' | 'pillar' | 'marker';

export interface RockDef {
  id: number;
  role: RockRole;
  x: number;
  y: number;
  z: number;
  /** radius (m) */
  r: number;
  /** vertical stretch (pillars are tall) */
  tall: number;
  yaw: number;
  variant: number;
  seg: string;
  /** which slide releases it */
  slide?: number;
}

export type PartShape = 'box' | 'log';
export type PartRole = 'base' | 'wall' | 'roof' | 'frame' | 'deck' | 'stack' | 'tank' | 'stone';

export interface PartDef {
  id: number;
  shape: PartShape;
  role: PartRole;
  /** half extents in the part's frame (logs lie along local x: hx = half length, hy = hz = radius) */
  half: [number, number, number];
  pos: [number, number, number];
  quat: [number, number, number, number];
  color: [number, number, number];
  mass: number;
  structure: number;
}

export type StructureKind = 'cabin' | 'shed' | 'tower' | 'fence' | 'logpile' | 'trestle' | 'watertower' | 'hall';

export interface StructureDef {
  id: number;
  kind: StructureKind;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** footprint half extents (local x across, local z along) */
  hx: number;
  hz: number;
  height: number;
  parts: number[];
  seg: string;
  /** points for flattening it */
  points: number;
  /** the finale's main building */
  finale?: boolean;
}

export interface SlideDef {
  id: number;
  seg: string;
  /** distance along the segment where the boulder sets it off */
  trigger: number;
  rocks: number[];
  side: 1 | -1;
}

export interface Layout {
  trees: TreeDef[];
  rocks: RockDef[];
  parts: PartDef[];
  structures: StructureDef[];
  slides: SlideDef[];
  /** where the finale's main building stands (segment distance) */
  finaleS: number;
}

const STRUCTURE_NAMES: Record<StructureKind, string> = {
  cabin: 'Cabin',
  shed: 'Shed',
  tower: 'Lookout tower',
  fence: 'Fence',
  logpile: 'Log pile',
  trestle: 'Trestle bridge',
  watertower: 'Water tower',
  hall: 'Hall',
};

export const STRUCTURE_POINTS: Record<StructureKind, number> = {
  cabin: 1500,
  shed: 800,
  tower: 1800,
  fence: 350,
  logpile: 600,
  trestle: 3500,
  watertower: 1600,
  hall: 6000,
};

interface Ctx {
  level: LevelDef;
  data: LevelData;
  out: Layout;
  paths: Map<string, Polyline>;
  occupied: { x: number; z: number; r: number }[];
  wood: [number, number, number];
  roof: [number, number, number];
}

function shade(c: [number, number, number], k: number): [number, number, number] {
  return [c[0] * k, c[1] * k, c[2] * k];
}

/** Point at distance s along a segment, offset sideways by d (+ = left). */
function at(pl: Polyline, s: number, d: number): { x: number; z: number; tx: number; tz: number; yaw: number } {
  const p = pathPointAt(pl, s);
  return { x: p.x + p.tz * d, z: p.z - p.tx * d, tx: p.tx, tz: p.tz, yaw: Math.atan2(p.tx, p.tz) };
}

function free(ctx: Ctx, x: number, z: number, r: number, seg: string, maxD = Infinity): boolean {
  for (const o of ctx.occupied) if (Math.hypot(o.x - x, o.z - z) < o.r + r) return false;
  // keep out of other routes' channels (forks run close together)
  for (const s of ctx.level.segments) {
    if (s.id === seg) continue;
    const pl = ctx.paths.get(s.id)!;
    if (x < pl.minX - 20 || x > pl.maxX + 20 || z < pl.minZ - 20 || z > pl.maxZ + 20) continue;
    const hit = pathDistance(pl, x, z);
    if (hit.d < CHANNEL_HALF[s.kind] + 3 && hit.s > 8 && hit.s < pl.length - 8) return false;
  }
  const own = ctx.paths.get(seg)!;
  if (pathDistance(own, x, z).d > maxD) return false;
  return true;
}

/** half width the boulder's centre can wander within, per kind of ground */
export const CHANNEL_HALF: Record<Segment['kind'], number> = {
  summit: 3,
  forest: 4.5,
  scree: 5,
  ravine: 1.8,
  camp: 5,
  loose: 4.5,
  finale: 5,
};

function addTree(ctx: Ctx, rng: () => number, x: number, z: number, seg: string, scale = 1) {
  const h = (10 + rng() * 7) * scale;
  ctx.out.trees.push({ id: ctx.out.trees.length, x, z, y: ctx.data.heightAt(x, z), h, r: 0.22 + h * 0.018, yaw: rng() * Math.PI * 2, variant: Math.floor(rng() * 3), seg });
  ctx.occupied.push({ x, z, r: 1.3 });
}

function addRock(ctx: Ctx, rng: () => number, role: RockRole, x: number, z: number, r: number, seg: string, tall = 1, slide?: number): RockDef {
  const y = ctx.data.heightAt(x, z) + (role === 'pillar' ? r * tall * 0.85 : r * 0.45);
  const rock: RockDef = { id: ctx.out.rocks.length, role, x, y, z, r, tall, yaw: rng() * Math.PI * 2, variant: Math.floor(rng() * 4), seg, slide };
  ctx.out.rocks.push(rock);
  ctx.occupied.push({ x, z, r: r + 0.6 });
  return rock;
}

// ------------------------------------------------------------------ structures

interface Builder {
  parts: Omit<PartDef, 'id' | 'structure' | 'pos' | 'quat'>[];
  local: { pos: [number, number, number]; rot: [number, number, number] }[];
}

function part(b: Builder, shape: PartShape, role: PartRole, half: [number, number, number], pos: [number, number, number], rot: [number, number, number], color: [number, number, number], density: number) {
  const vol = shape === 'log' ? Math.PI * half[1] * half[1] * half[0] * 2 : 8 * half[0] * half[1] * half[2];
  b.parts.push({ shape, role, half, color, mass: vol * density });
  b.local.push({ pos, rot });
}

const WOOD = 520;
const STONE = 2300;

function buildCabin(ctx: Ctx, rng: () => number, b: Builder, w: number, d: number) {
  const wood = ctx.wood;
  const logR = 0.2;
  const rows = 6;
  // stone foundation: hides a footprint that sits on a slope
  part(b, 'box', 'base', [w / 2 + 0.2, 0.9, d / 2 + 0.2], [0, -0.6, 0], [0, 0, 0], [0.42, 0.4, 0.38], STONE);
  for (let i = 0; i < rows; i++) {
    const y = 0.5 + i * logR * 2;
    const c = shade(wood, 0.85 + rng() * 0.3);
    // side walls run along z, front and back across x — logs overlap at the corners
    part(b, 'log', 'wall', [d / 2 + 0.3, logR, logR], [w / 2, y, 0], [0, Math.PI / 2, 0], c, WOOD);
    part(b, 'log', 'wall', [d / 2 + 0.3, logR, logR], [-w / 2, y, 0], [0, Math.PI / 2, 0], shade(c, 0.95), WOOD);
    part(b, 'log', 'wall', [w / 2 + 0.3, logR, logR], [0, y + logR, d / 2], [0, 0, 0], shade(c, 1.02), WOOD);
    part(b, 'log', 'wall', [w / 2 + 0.3, logR, logR], [0, y + logR, -d / 2], [0, 0, 0], shade(c, 0.97), WOOD);
  }
  const top = 0.5 + rows * logR * 2;
  const pitch = 0.62;
  const rw = (w / 2 + 0.5) / Math.cos(pitch);
  for (const side of [1, -1]) {
    // the roof in two pieces a side, so it breaks up as it falls
    for (const k of [-1, 1]) {
      part(b, 'box', 'roof', [rw / 2, 0.08, d / 4 + 0.3], [side * (w / 4 + 0.15), top + Math.sin(pitch) * rw * 0.5, k * (d / 4 + 0.15)], [0, 0, -side * pitch], ctx.roof, WOOD);
    }
  }
  part(b, 'log', 'frame', [d / 2 + 0.5, 0.16, 0.16], [0, top + Math.sin(pitch) * rw, 0], [0, Math.PI / 2, 0], shade(wood, 0.8), WOOD);
  part(b, 'box', 'stone', [0.4, 1.4, 0.4], [w / 2 - 0.7, top + 0.6, -d / 4], [0, 0, 0], [0.5, 0.47, 0.44], STONE);
}

function buildShed(ctx: Ctx, rng: () => number, b: Builder, w: number, d: number) {
  const h = 2.4;
  part(b, 'box', 'base', [w / 2 + 0.1, 0.7, d / 2 + 0.1], [0, -0.5, 0], [0, 0, 0], shade(ctx.wood, 0.6), WOOD);
  const n = Math.round(w / 0.7);
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (i + 0.5) * (w / n);
    const c = shade(ctx.wood, 0.8 + rng() * 0.35);
    part(b, 'box', 'wall', [w / n / 2 - 0.02, h / 2, 0.05], [x, h / 2 + 0.2, d / 2], [0, 0, 0], c, WOOD);
    part(b, 'box', 'wall', [w / n / 2 - 0.02, h / 2, 0.05], [x, h / 2 + 0.2, -d / 2], [0, 0, 0], shade(c, 0.95), WOOD);
  }
  const m = Math.round(d / 0.7);
  for (let i = 0; i < m; i++) {
    const z = -d / 2 + (i + 0.5) * (d / m);
    const c = shade(ctx.wood, 0.8 + rng() * 0.35);
    part(b, 'box', 'wall', [0.05, h / 2, d / m / 2 - 0.02], [w / 2, h / 2 + 0.2, z], [0, 0, 0], c, WOOD);
    part(b, 'box', 'wall', [0.05, h / 2, d / m / 2 - 0.02], [-w / 2, h / 2 + 0.2, z], [0, 0, 0], shade(c, 0.92), WOOD);
  }
  part(b, 'box', 'roof', [w / 2 + 0.4, 0.07, d / 4 + 0.25], [0, h + 0.45, d / 4], [0.12, 0, 0], ctx.roof, WOOD);
  part(b, 'box', 'roof', [w / 2 + 0.4, 0.07, d / 4 + 0.25], [0, h + 0.3, -d / 4], [0.12, 0, 0], shade(ctx.roof, 0.92), WOOD);
}

function buildTower(ctx: Ctx, rng: () => number, b: Builder) {
  const h = 7;
  const s = 1.4;
  const c = shade(ctx.wood, 0.9);
  for (const [x, z] of [
    [s, s],
    [-s, s],
    [s, -s],
    [-s, -s],
  ]) {
    part(b, 'log', 'frame', [h / 2, 0.14, 0.14], [x, h / 2 - 0.3, z], [0, 0, Math.PI / 2], shade(c, 0.9 + rng() * 0.2), WOOD);
  }
  for (const y of [1.8, 4.2]) {
    part(b, 'box', 'frame', [s, 0.06, 0.06], [0, y, s], [0, 0, 0.5], c, WOOD);
    part(b, 'box', 'frame', [s, 0.06, 0.06], [0, y, -s], [0, 0, -0.5], c, WOOD);
    part(b, 'box', 'frame', [0.06, 0.06, s], [s, y, 0], [0.5, 0, 0], c, WOOD);
    part(b, 'box', 'frame', [0.06, 0.06, s], [-s, y, 0], [-0.5, 0, 0], c, WOOD);
  }
  part(b, 'box', 'deck', [s + 0.4, 0.1, s + 0.4], [0, h - 0.3, 0], [0, 0, 0], shade(ctx.wood, 1.05), WOOD);
  for (const [x, z, hx, hz] of [
    [0, s + 0.35, s + 0.4, 0.05],
    [0, -s - 0.35, s + 0.4, 0.05],
    [s + 0.35, 0, 0.05, s + 0.4],
    [-s - 0.35, 0, 0.05, s + 0.4],
  ]) {
    part(b, 'box', 'wall', [hx, 0.45, hz], [x, h + 0.25, z], [0, 0, 0], shade(ctx.wood, 0.85), WOOD);
  }
  part(b, 'box', 'roof', [s + 0.7, 0.08, s + 0.7], [0, h + 1.9, 0], [0, 0, 0], ctx.roof, WOOD);
  for (const [x, z] of [
    [s, s],
    [-s, -s],
  ]) {
    part(b, 'box', 'frame', [0.06, 0.9, 0.06], [x, h + 0.9, z], [0, 0, 0], c, WOOD);
  }
}

function buildFence(ctx: Ctx, rng: () => number, b: Builder, len: number) {
  const n = Math.max(2, Math.round(len / 2.6));
  const step = len / n;
  for (let i = 0; i <= n; i++) {
    const x = -len / 2 + i * step;
    part(b, 'box', 'frame', [0.09, 0.75, 0.09], [x, 0.55, 0], [0, 0, (rng() - 0.5) * 0.08], shade(ctx.wood, 0.75 + rng() * 0.2), WOOD);
    if (i < n)
      for (const y of [0.45, 0.95]) part(b, 'box', 'wall', [step / 2, 0.06, 0.04], [x + step / 2, y, 0.08], [0, 0, (rng() - 0.5) * 0.06], shade(ctx.wood, 0.85 + rng() * 0.25), WOOD);
  }
}

function buildLogPile(ctx: Ctx, rng: () => number, b: Builder, len: number) {
  const r = 0.32;
  for (let row = 0; row < 4; row++) {
    const n = 4 - row;
    for (let i = 0; i < n; i++) {
      const z = (i - (n - 1) / 2) * r * 2.05;
      part(b, 'log', 'stack', [len / 2 + (rng() - 0.5) * 0.4, r, r], [0, r + row * r * 1.75, z], [0, 0, 0], shade(ctx.wood, 0.8 + rng() * 0.3), WOOD + 120);
    }
  }
  // chocks
  part(b, 'box', 'frame', [0.1, 0.5, 1.6], [len / 2 - 0.3, 0.5, 0], [0, 0, 0], shade(ctx.wood, 0.7), WOOD);
  part(b, 'box', 'frame', [0.1, 0.5, 1.6], [-len / 2 + 0.3, 0.5, 0], [0, 0, 0], shade(ctx.wood, 0.7), WOOD);
}

function buildWaterTower(ctx: Ctx, rng: () => number, b: Builder) {
  const h = 6;
  const s = 1.3;
  for (const [x, z] of [
    [s, s],
    [-s, s],
    [s, -s],
    [-s, -s],
  ]) {
    part(b, 'log', 'frame', [h / 2, 0.16, 0.16], [x, h / 2 - 0.3, z], [0, 0, Math.PI / 2], shade(ctx.wood, 0.8 + rng() * 0.2), WOOD);
  }
  part(b, 'box', 'frame', [s, 0.06, 0.06], [0, 2.6, s], [0, 0, 0.6], ctx.wood, WOOD);
  part(b, 'box', 'frame', [s, 0.06, 0.06], [0, 2.6, -s], [0, 0, -0.6], ctx.wood, WOOD);
  part(b, 'box', 'deck', [s + 0.3, 0.1, s + 0.3], [0, h - 0.2, 0], [0, 0, 0], shade(ctx.wood, 0.9), WOOD);
  // the tank: staves around a ring
  const R = 1.5;
  const staves = 10;
  for (let i = 0; i < staves; i++) {
    const a = (i / staves) * Math.PI * 2;
    part(b, 'box', 'tank', [0.06, 1.2, R * Math.sin(Math.PI / staves) + 0.03], [Math.cos(a) * R, h + 1.1, Math.sin(a) * R], [0, -a, 0], shade(ctx.wood, 0.75 + (i % 2) * 0.12), WOOD);
  }
  part(b, 'box', 'roof', [R + 0.3, 0.08, R + 0.3], [0, h + 2.45, 0], [0, Math.PI / 4, 0], ctx.roof, WOOD);
}

function buildTrestle(ctx: Ctx, rng: () => number, b: Builder, span: number, height: number) {
  // a mining trestle across the gorge: bents standing in the gorge carry a deck at rim height
  const bents = 4;
  for (let i = 0; i < bents; i++) {
    const x = -span / 2 + 2 + (i * (span - 4)) / (bents - 1);
    for (const z of [-1, 1]) {
      part(b, 'log', 'frame', [height / 2, 0.17, 0.17], [x, height / 2 - 0.4, z], [0, 0, Math.PI / 2], shade(ctx.wood, 0.75 + rng() * 0.2), WOOD);
    }
    part(b, 'box', 'frame', [0.07, 0.07, 1.2], [x, height * 0.5, 0], [0.8, 0, 0], shade(ctx.wood, 0.8), WOOD);
  }
  for (const z of [-1, 1]) part(b, 'log', 'frame', [span / 2, 0.18, 0.18], [0, height, z], [0, 0, 0], shade(ctx.wood, 0.7), WOOD);
  const planks = Math.round(span / 1.1);
  for (let i = 0; i < planks; i++) {
    const x = -span / 2 + (i + 0.5) * (span / planks);
    part(b, 'box', 'deck', [span / planks / 2 - 0.03, 0.06, 1.5], [x, height + 0.25, 0], [0, 0, 0], shade(ctx.wood, 0.85 + rng() * 0.3), WOOD);
  }
  for (const z of [-1.4, 1.4]) part(b, 'box', 'wall', [span / 2, 0.05, 0.05], [0, height + 1.1, z], [0, 0, 0], shade(ctx.wood, 0.8), WOOD);
}

function buildHall(ctx: Ctx, rng: () => number, b: Builder, w: number, d: number, style: LevelDef['finale']['style']) {
  const h = 4.6;
  const stone = style === 'quarry' || style === 'mine';
  part(b, 'box', 'base', [w / 2 + 0.4, 1.2, d / 2 + 0.4], [0, -0.8, 0], [0, 0, 0], [0.4, 0.38, 0.36], STONE);
  // posts
  for (const x of [-w / 2, -w / 6, w / 6, w / 2])
    for (const z of [-d / 2, 0, d / 2]) part(b, 'log', 'frame', [h / 2, 0.2, 0.2], [x, h / 2 + 0.3, z], [0, 0, Math.PI / 2], shade(ctx.wood, 0.7), WOOD);
  // walls: vertical boards (or stone courses for a quarry/mine)
  const board = stone ? 1.2 : 0.75;
  const nx = Math.round(w / board);
  const nz = Math.round(d / board);
  const wallCol = (k: number): [number, number, number] => (stone ? shade([0.55, 0.52, 0.48], 0.8 + k * 0.35) : shade(ctx.wood, 0.78 + k * 0.4));
  const courses = stone ? 3 : 1;
  for (let c = 0; c < courses; c++) {
    const ch = h / courses;
    const y = 0.3 + ch * (c + 0.5);
    for (let i = 0; i < nx; i++) {
      const x = -w / 2 + (i + 0.5) * (w / nx);
      part(b, 'box', 'wall', [w / nx / 2 - 0.02, ch / 2 - 0.02, stone ? 0.3 : 0.06], [x, y, d / 2], [0, 0, 0], wallCol(rng()), stone ? STONE : WOOD);
      part(b, 'box', 'wall', [w / nx / 2 - 0.02, ch / 2 - 0.02, stone ? 0.3 : 0.06], [x, y, -d / 2], [0, 0, 0], wallCol(rng()), stone ? STONE : WOOD);
    }
    for (let i = 0; i < nz; i++) {
      const z = -d / 2 + (i + 0.5) * (d / nz);
      part(b, 'box', 'wall', [stone ? 0.3 : 0.06, ch / 2 - 0.02, d / nz / 2 - 0.02], [w / 2, y, z], [0, 0, 0], wallCol(rng()), stone ? STONE : WOOD);
      part(b, 'box', 'wall', [stone ? 0.3 : 0.06, ch / 2 - 0.02, d / nz / 2 - 0.02], [-w / 2, y, z], [0, 0, 0], wallCol(rng()), stone ? STONE : WOOD);
    }
  }
  // roof panels, three a side
  const pitch = 0.5;
  const rw = (w / 2 + 0.6) / Math.cos(pitch);
  for (const side of [1, -1])
    for (const k of [-1, 0, 1]) part(b, 'box', 'roof', [rw / 2, 0.1, d / 6 + 0.2], [side * (w / 4 + 0.2), h + 0.3 + Math.sin(pitch) * rw * 0.5, k * (d / 3)], [0, 0, -side * pitch], shade(ctx.roof, 0.92 + rng() * 0.16), WOOD);
  part(b, 'log', 'frame', [d / 2 + 0.6, 0.2, 0.2], [0, h + 0.3 + Math.sin(pitch) * rw, 0], [0, Math.PI / 2, 0], shade(ctx.wood, 0.7), WOOD);
  // gable ends
  for (const z of [d / 2, -d / 2]) part(b, 'box', 'wall', [w / 4, 0.8, 0.06], [0, h + 1.0, z], [0, 0, 0], wallCol(0.5), WOOD);
}

function placeStructure(ctx: Ctx, rng: () => number, kind: StructureKind, seg: string, x: number, z: number, yaw: number, opts: { w?: number; d?: number; len?: number; span?: number; height?: number; finale?: boolean; baseY?: number } = {}): StructureDef {
  const b: Builder = { parts: [], local: [] };
  let hx = 2,
    hz = 2,
    height = 4;
  switch (kind) {
    case 'cabin': {
      const w = opts.w ?? 5.5,
        d = opts.d ?? 4.5;
      buildCabin(ctx, rng, b, w, d);
      hx = w / 2 + 0.4;
      hz = d / 2 + 0.4;
      height = 4.8;
      break;
    }
    case 'shed': {
      const w = opts.w ?? 3.6,
        d = opts.d ?? 3;
      buildShed(ctx, rng, b, w, d);
      hx = w / 2 + 0.3;
      hz = d / 2 + 0.3;
      height = 3;
      break;
    }
    case 'tower':
      buildTower(ctx, rng, b);
      hx = hz = 1.9;
      height = 9;
      break;
    case 'fence': {
      const len = opts.len ?? 12;
      buildFence(ctx, rng, b, len);
      hx = len / 2;
      hz = 0.5;
      height = 1.4;
      break;
    }
    case 'logpile': {
      const len = opts.len ?? 5;
      buildLogPile(ctx, rng, b, len);
      hx = len / 2;
      hz = 1.5;
      height = 2.4;
      break;
    }
    case 'watertower':
      buildWaterTower(ctx, rng, b);
      hx = hz = 1.8;
      height = 9;
      break;
    case 'trestle': {
      const span = opts.span ?? 22;
      const h = opts.height ?? 8;
      buildTrestle(ctx, rng, b, span, h);
      hx = span / 2;
      hz = 1.6;
      height = h + 1.4;
      break;
    }
    case 'hall': {
      const w = opts.w ?? 12,
        d = opts.d ?? 9;
      buildHall(ctx, rng, b, w, d, ctx.level.finale.style);
      hx = w / 2 + 0.6;
      hz = d / 2 + 0.6;
      height = 8;
      break;
    }
  }
  const y = opts.baseY ?? ctx.data.heightAt(x, z);
  const sid = ctx.out.structures.length;
  const qYaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  const ids: number[] = [];
  const v = new Vector3();
  const q = new Quaternion();
  const e = new Euler();
  b.parts.forEach((p, i) => {
    const L = b.local[i];
    v.set(...L.pos).applyQuaternion(qYaw);
    e.set(L.rot[0], L.rot[1], L.rot[2], 'YXZ');
    q.setFromEuler(e).premultiply(qYaw);
    const id = ctx.out.parts.length;
    ctx.out.parts.push({ ...p, id, structure: sid, pos: [x + v.x, y + v.y, z + v.z], quat: [q.x, q.y, q.z, q.w] });
    ids.push(id);
  });
  const s: StructureDef = { id: sid, kind, name: STRUCTURE_NAMES[kind], x, y, z, yaw, hx, hz, height, parts: ids, seg, points: STRUCTURE_POINTS[kind] * (opts.finale ? 2 : 1), finale: opts.finale };
  if (opts.finale) s.name = ctx.level.finale.name;
  ctx.out.structures.push(s);
  ctx.occupied.push({ x, z, r: Math.max(hx, hz) + 1 });
  return s;
}

// ------------------------------------------------------------------ per kind of ground

function forest(ctx: Ctx, seg: Segment, pl: Polyline, rng: () => number) {
  for (let s = 26; s < pl.length - 18; s += 1.55) {
    for (let k = 0; k < 2; k++) {
      // dense in the line of fire, thick to either side
      const d = k === 0 ? (rng() * 2 - 1) * 5.2 : (rng() < 0.5 ? -1 : 1) * (5.5 + rng() * 11);
      if (rng() > (k === 0 ? 0.55 : 0.7)) continue;
      const p = at(pl, s + rng() * 1.5, d);
      if (!free(ctx, p.x, p.z, 1.2, seg.id)) continue;
      addTree(ctx, rng, p.x, p.z, seg.id);
    }
  }
  // a woodcutter's shed and a stack of logs somewhere in the trees
  const s0 = pl.length * (0.35 + rng() * 0.3);
  const side = rng() < 0.5 ? -1 : 1;
  const p = at(pl, s0, side * 9);
  if (free(ctx, p.x, p.z, 3, seg.id)) placeStructure(ctx, rng, 'shed', seg.id, p.x, p.z, p.yaw + (rng() - 0.5) * 0.6);
  const q = at(pl, s0 + 26, -side * 1.5);
  if (free(ctx, q.x, q.z, 2.5, seg.id)) placeStructure(ctx, rng, 'logpile', seg.id, q.x, q.z, q.yaw + Math.PI / 2 + (rng() - 0.5) * 0.5, { len: 4.5 });
}

function scree(ctx: Ctx, seg: Segment, pl: Polyline, rng: () => number) {
  for (let s = 24; s < pl.length - 16; s += 4.2) {
    const n = 1 + Math.floor(rng() * 2);
    for (let k = 0; k < n; k++) {
      const big = rng() < 0.12;
      const r = big ? 1.5 + rng() * 0.6 : 0.5 + rng() * 0.75;
      const d = (rng() * 2 - 1) * (big ? 4 : 7.5);
      const p = at(pl, s + rng() * 3, d);
      if (!free(ctx, p.x, p.z, r, seg.id)) continue;
      addRock(ctx, rng, 'rock', p.x, p.z, r, seg.id);
    }
  }
  // stunted trees clinging to the edges
  for (let s = 30; s < pl.length - 20; s += 9) {
    if (rng() < 0.45) continue;
    const d = (rng() < 0.5 ? -1 : 1) * (7 + rng() * 8);
    const p = at(pl, s, d);
    if (free(ctx, p.x, p.z, 1.2, seg.id)) addTree(ctx, rng, p.x, p.z, seg.id, 0.8);
  }
}

function ravine(ctx: Ctx, seg: Segment, pl: Polyline, rng: () => number) {
  let side = rng() < 0.5 ? 1 : -1;
  const trestleS = pl.length * (0.5 + rng() * 0.12);
  for (let s = 52; s < pl.length - 40; s += 26 + rng() * 10) {
    if (Math.abs(s - trestleS) < 14) continue;
    // rock pillars standing off the walls: clip one and it comes down in pieces
    const p = at(pl, s, side * (2.4 + rng() * 0.8));
    addRock(ctx, rng, 'pillar', p.x, p.z, 1.1 + rng() * 0.4, seg.id, 2.6 + rng() * 1.6);
    side = -side;
  }
  for (let s = 40; s < pl.length - 30; s += 11) {
    if (rng() < 0.5) continue;
    const p = at(pl, s, (rng() * 2 - 1) * 1.6);
    if (free(ctx, p.x, p.z, 0.8, seg.id)) addRock(ctx, rng, 'rock', p.x, p.z, 0.45 + rng() * 0.4, seg.id);
  }
  // a mining trestle spans the gorge; its legs stand in your way
  const t = at(pl, trestleS, 0);
  const floor = ctx.data.heightAt(t.x, t.z);
  placeStructure(ctx, rng, 'trestle', seg.id, t.x, t.z, t.yaw + Math.PI / 2 - Math.PI / 2, { span: 20, height: 9.5, baseY: floor });
  // pines on the rims
  for (let s = 40; s < pl.length - 30; s += 7) {
    if (rng() < 0.4) continue;
    const sd = rng() < 0.5 ? -1 : 1;
    const p = at(pl, s, sd * (12 + rng() * 6));
    if (free(ctx, p.x, p.z, 1.2, seg.id)) addTree(ctx, rng, p.x, p.z, seg.id, 0.9);
  }
}

function camp(ctx: Ctx, seg: Segment, pl: Polyline, rng: () => number) {
  const kinds: StructureKind[] = ['fence', 'cabin', 'logpile', 'tower', 'shed', 'cabin', 'watertower', 'fence'];
  let i = Math.floor(rng() * 2);
  for (let s = 34; s < pl.length - 26; s += 22 + rng() * 8) {
    const kind = kinds[i++ % kinds.length];
    const d = kind === 'fence' ? 0 : (rng() * 2 - 1) * 2.2;
    const p = at(pl, s, d);
    const yaw = kind === 'logpile' ? p.yaw + Math.PI / 2 + (rng() - 0.5) * 0.4 : p.yaw + (rng() - 0.5) * 0.25;
    if (!free(ctx, p.x, p.z, 2.5, seg.id)) continue;
    placeStructure(ctx, rng, kind, seg.id, p.x, p.z, yaw, kind === 'fence' ? { len: 14 } : {});
    // a neighbour off the line: falling timber and rolling logs find it
    if (kind === 'cabin' || kind === 'tower') {
      const q = at(pl, s + 6, (rng() < 0.5 ? -1 : 1) * (9 + rng() * 3));
      if (free(ctx, q.x, q.z, 3, seg.id)) placeStructure(ctx, rng, rng() < 0.5 ? 'shed' : 'logpile', seg.id, q.x, q.z, q.yaw + (rng() - 0.5));
    }
  }
  for (let s = 26; s < pl.length - 16; s += 3.2) {
    if (rng() < 0.35) continue;
    const d = (rng() < 0.5 ? -1 : 1) * (8 + rng() * 9);
    const p = at(pl, s, d);
    if (free(ctx, p.x, p.z, 1.2, seg.id)) addTree(ctx, rng, p.x, p.z, seg.id);
  }
}

function loose(ctx: Ctx, seg: Segment, pl: Polyline, rng: () => number) {
  const side = seg.slope ?? 1;
  for (const f of [0.28, 0.62]) {
    const s0 = pl.length * f;
    const slide: SlideDef = { id: ctx.out.slides.length, seg: seg.id, trigger: s0 - 10, rocks: [], side };
    for (let k = 0; k < 26; k++) {
      const s = s0 + rng() * 34;
      const d = side * (8 + rng() * 17);
      const p = at(pl, s, d);
      const r = 0.45 + rng() * 0.6;
      if (!free(ctx, p.x, p.z, r * 0.6, seg.id)) continue;
      slide.rocks.push(addRock(ctx, rng, 'loose', p.x, p.z, r, seg.id, 1, slide.id).id);
    }
    ctx.out.slides.push(slide);
    // what the slide crashes into below the line
    const shedP = at(pl, s0 + 26, -side * (8 + rng() * 2));
    if (free(ctx, shedP.x, shedP.z, 3, seg.id)) placeStructure(ctx, rng, rng() < 0.5 ? 'shed' : 'cabin', seg.id, shedP.x, shedP.z, shedP.yaw + (rng() - 0.5) * 0.5);
  }
  for (let s = 24; s < pl.length - 16; s += 2.6) {
    if (rng() < 0.4) continue;
    const d = -side * (5.5 + rng() * 12);
    const p = at(pl, s, d);
    if (free(ctx, p.x, p.z, 1.2, seg.id)) addTree(ctx, rng, p.x, p.z, seg.id);
  }
  for (let s = 26; s < pl.length - 20; s += 9) {
    const p = at(pl, s, (rng() * 2 - 1) * 4);
    if (rng() < 0.5 && free(ctx, p.x, p.z, 0.8, seg.id)) addRock(ctx, rng, 'rock', p.x, p.z, 0.5 + rng() * 0.5, seg.id);
  }
}

function summit(ctx: Ctx, seg: Segment, pl: Polyline, rng: () => number) {
  for (let s = 40; s < pl.length - 10; s += 10) {
    const p = at(pl, s, (rng() * 2 - 1) * 3.5);
    if (free(ctx, p.x, p.z, 0.8, seg.id)) addRock(ctx, rng, 'rock', p.x, p.z, 0.45 + rng() * 0.45, seg.id);
  }
  for (let s = 60; s < pl.length - 10; s += 4) {
    if (rng() < 0.6) continue;
    const p = at(pl, s, (rng() < 0.5 ? -1 : 1) * (4 + rng() * 9));
    if (free(ctx, p.x, p.z, 1.2, seg.id)) addTree(ctx, rng, p.x, p.z, seg.id, 0.85);
  }
}

function finale(ctx: Ctx, seg: Segment, pl: Polyline, rng: () => number) {
  const S = pl.length - 62;
  ctx.out.finaleS = S;
  // fences across the approach
  for (const s of [38, 74]) {
    const p = at(pl, s, (rng() - 0.5) * 2);
    placeStructure(ctx, rng, 'fence', seg.id, p.x, p.z, p.yaw, { len: 16 });
  }
  // the main building, square on to the line
  const m = at(pl, S, 0);
  placeStructure(ctx, rng, 'hall', seg.id, m.x, m.z, m.yaw, { w: 12, d: 9, finale: true });
  const around: [StructureKind, number, number][] = [
    ['watertower', -14, 11],
    ['logpile', -10, -9],
    ['logpile', 2, -10],
    ['shed', 14, 10],
    ['cabin', 22, -12],
    ['shed', 24, 11],
    ['logpile', -20, 13],
    ['fence', 34, 0],
  ];
  for (const [kind, ds, d] of around) {
    const p = at(pl, S + ds, d);
    if (!free(ctx, p.x, p.z, 1.5, seg.id)) continue;
    placeStructure(ctx, rng, kind, seg.id, p.x, p.z, p.yaw + (kind === 'logpile' ? Math.PI / 2 : 0) + (rng() - 0.5) * 0.3, kind === 'fence' ? { len: 20 } : {});
  }
  for (let s = 20; s < pl.length - 10; s += 3.5) {
    if (rng() < 0.45) continue;
    const d = (rng() < 0.5 ? -1 : 1) * (10 + rng() * 10);
    const p = at(pl, s, d);
    if (free(ctx, p.x, p.z, 1.2, seg.id)) addTree(ctx, rng, p.x, p.z, seg.id);
  }
}

const cache = new Map<string, Layout>();

export function layoutLevel(level: LevelDef, data: LevelData): Layout {
  const hit = cache.get(level.id);
  if (hit) return hit;
  const out: Layout = { trees: [], rocks: [], parts: [], structures: [], slides: [], finaleS: 0 };
  const paths = new Map(level.segments.map((s) => [s.id, makePolyline(s.path)]));
  const ctx: Ctx = { level, data, out, paths, occupied: [], wood: level.theme.wood, roof: level.theme.roof };
  // the finale first: it owns its ground
  const order = [...level.segments].sort((a, b) => (a.kind === 'finale' ? -1 : b.kind === 'finale' ? 1 : 0));
  for (const seg of order) {
    const rng = mulberry32(hashInts(level.boulder.seed, seg.id.length, seg.id.charCodeAt(0), seg.id.charCodeAt(seg.id.length - 1)));
    const pl = paths.get(seg.id)!;
    switch (seg.kind) {
      case 'forest':
        forest(ctx, seg, pl, rng);
        break;
      case 'scree':
        scree(ctx, seg, pl, rng);
        break;
      case 'ravine':
        ravine(ctx, seg, pl, rng);
        break;
      case 'camp':
        camp(ctx, seg, pl, rng);
        break;
      case 'loose':
        loose(ctx, seg, pl, rng);
        break;
      case 'summit':
        summit(ctx, seg, pl, rng);
        break;
      case 'finale':
        finale(ctx, seg, pl, rng);
        break;
    }
  }
  // spires mark each fork: the mountain shows where the ways part
  for (const seg of level.segments) {
    if (seg.next.length < 2) continue;
    for (let i = 0; i < seg.next.length - 1; i++) {
      const A = paths.get(seg.next[i])!,
        B = paths.get(seg.next[i + 1])!;
      for (let s = 30; s < 120; s += 2) {
        const a = pathPointAt(A, s),
          b = pathPointAt(B, s);
        if (Math.hypot(a.x - b.x, a.z - b.z) > 15) {
          const rng = mulberry32(hashInts(s, i, seg.id.length));
          addRock(ctx, rng, 'marker', (a.x + b.x) / 2, (a.z + b.z) / 2, 2.2, seg.id, 2.2);
          break;
        }
      }
    }
  }
  cache.set(level.id, out);
  return out;
}
