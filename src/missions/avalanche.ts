import { mulberry32 } from '../sim/noise';
import { BOWL, CHARGE_SPOTS } from '../world/places';
import type { Terrain } from '../world/terrain';

/**
 * Kessel Bowl's snowpack and what happens when it lets go.
 *
 * The start zone carries a slab: a layer of wind-packed snow laid in blocks over a weak layer.
 * A charge on a loaded slope sends a fracture racing across it (the crown); every block inside
 * the fracture lets go in the order the crack reaches it, slides, tumbles, breaks into smaller
 * blocks as it speeds up, and runs down the track until friction and the runout (and the berm)
 * stop it. Stopped snow piles up: later blocks ride over the debris of earlier ones.
 * Pure and deterministic; the renderer draws the blocks and the powder.
 */

export interface Block {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  /** edge length (m) */
  size: number;
  /** 0 resting on the slope, 1 waiting to release, 2 moving, 3 stopped */
  state: 0 | 1 | 2 | 3;
  /** release time (s after detonation) */
  at: number;
  /** tumbling: axis and accumulated angle */
  ax: number;
  az: number;
  angle: number;
  /** which piece shape draws it */
  shape: number;
  /** which slope it belongs to */
  zone: string;
  /** born from a split (no further splitting below this size) */
  gen: number;
}

export interface AvalancheResult {
  /** blocks released / blocks on weak slopes */
  released: number;
  weakReleased: number;
  weakTotal: number;
  /** furthest south (downhill) any snow reached */
  reachZ: number;
  /** did any snow reach the pass road */
  roadHit: boolean;
  secondary: number;
}

export const SHAPES = 10;
const MU = 0.3;
const XI = 0.0022;
const G = 9.81;
const MAX_BLOCKS = 640;
const CROWN_SPEED = 38;

export class Snowpack {
  blocks: Block[] = [];
  private t: Terrain;
  private depo: Float32Array;
  private readonly depoCell = 3;
  private readonly depoX0 = BOWL.cx - 200;
  private readonly depoZ0 = BOWL.zTop - 20;
  private readonly depoW = 134;
  private readonly depoH = 130;
  time = 0;
  fired = false;
  /** blocks currently moving */
  moving = 0;
  /** events for the renderer and sound (cleared each step by the caller) */
  events: { type: 'crack' | 'release' | 'secondary' | 'settled' | 'boom'; x: number; z: number }[] = [];
  private rng = mulberry32(99);
  private secondaryDone = false;
  result: AvalancheResult = { released: 0, weakReleased: 0, weakTotal: 0, reachZ: BOWL.zTop, roadHit: false, secondary: 0 };

  constructor(t: Terrain) {
    this.t = t;
    this.depo = new Float32Array(this.depoW * this.depoH);
    this.lay();
  }

  /** Lay the slab over the start zone. */
  private lay() {
    const s = BOWL.slab;
    const rng = mulberry32(7);
    const step = 6.2;
    for (let z = s.z0; z <= s.z1; z += step) {
      for (let x = s.x0; x <= s.x1; x += step) {
        const px = x + (rng() - 0.5) * 1.6;
        const pz = z + (rng() - 0.5) * 1.6;
        const zone = nearestZone(px, pz);
        const size = 3.6 + rng() * 1.6;
        this.blocks.push({
          x: px, z: pz, y: this.t.height(px, pz) + size * 0.25, vx: 0, vz: 0, size, state: 0, at: 0, ax: 1, az: 0, angle: 0, shape: Math.floor(rng() * SHAPES), zone: zone.id, gen: 0,
        });
      }
    }
    this.result.weakTotal = this.blocks.filter((b) => CHARGE_SPOTS.find((c) => c.id === b.zone)!.weak).length;
  }

  /** Ground plus piled debris. */
  ground(x: number, z: number): number {
    return this.t.height(x, z) + this.depoAt(x, z);
  }

  depoAt(x: number, z: number): number {
    const i = Math.floor((x - this.depoX0) / this.depoCell);
    const j = Math.floor((z - this.depoZ0) / this.depoCell);
    if (i < 0 || j < 0 || i >= this.depoW || j >= this.depoH) return 0;
    return this.depo[j * this.depoW + i];
  }

  private deposit(b: Block) {
    // spread the block's volume over a few cells
    const vol = b.size * b.size * b.size * 0.55;
    const r = Math.max(1, Math.round(b.size / this.depoCell));
    const cells = (2 * r + 1) * (2 * r + 1);
    const ci = Math.floor((b.x - this.depoX0) / this.depoCell);
    const cj = Math.floor((b.z - this.depoZ0) / this.depoCell);
    for (let j = cj - r; j <= cj + r; j++)
      for (let i = ci - r; i <= ci + r; i++) {
        if (i < 0 || j < 0 || i >= this.depoW || j >= this.depoH) continue;
        this.depo[j * this.depoW + i] += vol / cells / (this.depoCell * this.depoCell);
      }
  }

  /** Fire the charges placed on these slopes. Weak slopes release wide; sound ones only crack locally. */
  fire(charged: readonly string[]): void {
    if (this.fired) return;
    this.fired = true;
    this.time = 0;
    for (const id of charged) {
      const c = CHARGE_SPOTS.find((s) => s.id === id)!;
      this.events.push({ type: 'boom', x: c.x, z: c.z });
      const reach = c.weak ? 62 : 11;
      for (const b of this.blocks) {
        if (b.state !== 0) continue;
        const d = Math.hypot(b.x - c.x, b.z - c.z);
        // the crack runs along the slope (across x) faster than up and down it
        const aniso = Math.hypot((b.x - c.x) * 0.8, (b.z - c.z) * 1.35);
        const weakHere = CHARGE_SPOTS.find((s) => s.id === b.zone)!.weak;
        if (aniso < reach && (weakHere || d < 12)) {
          b.state = 1;
          b.at = 0.25 + aniso / CROWN_SPEED;
        }
      }
      this.events.push({ type: 'crack', x: c.x, z: c.z });
    }
  }

  get done(): boolean {
    return this.fired && this.time > 3 && this.moving === 0 && !this.blocks.some((b) => b.state === 1);
  }

  step(dt: number): void {
    if (!this.fired) return;
    this.time += dt;
    let moving = 0;
    const n0 = this.blocks.length;
    for (let k = 0; k < n0; k++) {
      const b = this.blocks[k];
      if (b.state === 1 && this.time >= b.at) {
        b.state = 2;
        this.result.released++;
        if (CHARGE_SPOTS.find((s) => s.id === b.zone)!.weak) this.result.weakReleased++;
        b.vx = (this.rng() - 0.5) * 1.5;
        b.vz = 1.5 + this.rng() * 1.5;
        b.ax = this.rng() - 0.5;
        b.az = 1;
        if (k % 9 === 0) this.events.push({ type: 'release', x: b.x, z: b.z });
      }
      if (b.state !== 2) continue;
      moving++;
      this.moveBlock(b, dt);
    }
    this.moving = moving;
    this.sympathetic();
  }

  private moveBlock(b: Block, dt: number) {
    const e = 2;
    const gx = this.ground(b.x + e, b.z) - this.ground(b.x - e, b.z);
    const gz = this.ground(b.x, b.z + e) - this.ground(b.x, b.z - e);
    const l = Math.hypot(gx, 2 * e, gz);
    const nx = -gx / l;
    const ny = (2 * e) / l;
    const nz = -gz / l;
    // gravity along the ground
    b.vx += G * nx * ny * dt;
    b.vz += G * nz * ny * dt;
    // Voellmy-style resistance: dry friction plus turbulent drag
    const sp = Math.hypot(b.vx, b.vz);
    if (sp > 1e-4) {
      const loss = (MU * G * ny + (XI * sp * sp * 9.81) / Math.max(1.5, b.size)) * dt;
      const k = Math.max(0, sp - loss) / sp;
      b.vx *= k;
      b.vz *= k;
    }
    // the flow spreads a little and wobbles
    b.vx += (this.rng() - 0.5) * 2.4 * dt * Math.min(1, sp / 6);
    b.x += b.vx * dt;
    b.z += b.vz * dt;
    const g = this.ground(b.x, b.z);
    b.y = g + b.size * 0.4;
    b.angle += (sp / Math.max(0.8, b.size * 0.5)) * dt;
    b.ax = b.vz;
    b.az = -b.vx;
    if (b.z > this.result.reachZ) this.result.reachZ = b.z;
    // break up when fast
    if (sp > 11 && b.gen < 2 && b.size > 2 && this.blocks.length < MAX_BLOCKS && this.rng() < dt * 1.4) {
      const half = b.size * 0.7;
      b.size = half;
      b.gen++;
      this.blocks.push({ ...b, size: half * (0.8 + this.rng() * 0.3), x: b.x + (this.rng() - 0.5) * half, z: b.z - this.rng() * half, vx: b.vx * (0.9 + this.rng() * 0.2), vz: b.vz * 0.95, shape: (b.shape + 3) % SHAPES, angle: this.rng() * 6 });
    }
    if (!this.result.roadHit) {
      const r = this.t.onRoute(b.x, b.z, 0);
      if (r && r.route.id === 'pass') this.result.roadHit = true;
    }
    // stop
    if (sp < 0.6 && this.time - b.at > 2) {
      b.state = 3;
      b.vx = b.vz = 0;
      this.deposit(b);
      b.y = this.t.height(b.x, b.z) + this.depoAt(b.x, b.z) - b.size * 0.15;
    }
  }

  /** The flow can knock loose snow off a slope it passes under. */
  private sympathetic() {
    if (this.secondaryDone || this.time < 4) return;
    for (const c of CHARGE_SPOTS) {
      if (c.weak) continue;
      const near = this.blocks.some((b) => b.state === 2 && b.zone !== c.id && Math.abs(b.x - c.x) < 20 && b.z > c.z && b.z - c.z < 40);
      const resting = this.blocks.filter((b) => b.state === 0 && b.zone === c.id && Math.hypot(b.x - c.x, b.z - c.z) < 16);
      if (near && resting.length) {
        for (const b of resting) {
          b.state = 1;
          b.at = this.time + 0.4 + Math.hypot(b.x - c.x, b.z - c.z) / CROWN_SPEED;
        }
        this.result.secondary++;
        this.events.push({ type: 'secondary', x: c.x, z: c.z });
        this.secondaryDone = true;
        return;
      }
    }
  }

  /** Put the slab back (the snow has built up again). */
  reset(): void {
    this.blocks.length = 0;
    this.depo.fill(0);
    this.fired = false;
    this.time = 0;
    this.moving = 0;
    this.secondaryDone = false;
    this.result = { released: 0, weakReleased: 0, weakTotal: 0, reachZ: BOWL.zTop, roadHit: false, secondary: 0 };
    this.lay();
  }
}

function nearestZone(x: number, z: number) {
  let best = CHARGE_SPOTS[0];
  let bd = Infinity;
  for (const c of CHARGE_SPOTS) {
    const d = Math.hypot(c.x - x, (c.z - z) * 0.5);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

/** Simulate a release to the end, headless (tests and tuning). */
export function simulateRelease(t: Terrain, charged: string[], maxT = 120): Snowpack {
  const s = new Snowpack(t);
  s.fire(charged);
  const dt = 1 / 30;
  while (!s.done && s.time < maxT) s.step(dt);
  return s;
}
