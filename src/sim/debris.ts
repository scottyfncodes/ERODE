import { Quaternion, Vector3 } from 'three';

/**
 * Cheap rigid debris on the heightfield: planks, logs and rock chunks.
 * Bodies fall, bounce, slide, roll downhill and settle; settled bodies stop simulating but stay where
 * they came to rest. Only a capped number simulate at once — the oldest are frozen first — so a run
 * can throw thousands of pieces without the cost growing.
 */

export type BodyShape = 'box' | 'log' | 'sphere';

export interface Body {
  id: number;
  shape: BodyShape;
  /** part id (box/log) or chunk slot (sphere) */
  ref: number;
  p: Vector3;
  v: Vector3;
  q: Quaternion;
  w: Vector3;
  half: [number, number, number];
  mass: number;
  active: boolean;
  rest: number;
  age: number;
  /** destruction chain this piece belongs to (-1: none) and how deep in it */
  chain: number;
  depth: number;
  /** can it knock things over? */
  hits: boolean;
  /** steps until it may hit again */
  cool: number;
  /** grounded this step */
  grounded: boolean;
}

export const MAX_ACTIVE = 200;
const G = 9.81;
const UP = new Vector3(0, 1, 0);

const _n = new Vector3();
const _t = new Vector3();
const _u = new Vector3();
const _a = new Vector3();
const _q = new Quaternion();
const _qi = new Quaternion();

export class Debris {
  readonly bodies: Body[] = [];
  /** bodies simulating right now, oldest first */
  readonly active: Body[] = [];
  /** bodies whose pose changed this step (for the renderer) */
  readonly moved = new Set<Body>();
  private ground: (x: number, z: number) => number;

  constructor(ground: (x: number, z: number) => number) {
    this.ground = ground;
  }

  add(opts: {
    shape: BodyShape;
    ref: number;
    pos: [number, number, number] | Vector3;
    quat: [number, number, number, number] | Quaternion;
    vel: Vector3;
    spin: Vector3;
    half: [number, number, number];
    mass: number;
    chain: number;
    depth: number;
    hits: boolean;
  }): Body {
    const b: Body = {
      id: this.bodies.length,
      shape: opts.shape,
      ref: opts.ref,
      p: opts.pos instanceof Vector3 ? opts.pos.clone() : new Vector3(...opts.pos),
      v: opts.vel.clone(),
      q: opts.quat instanceof Quaternion ? opts.quat.clone() : new Quaternion(...opts.quat),
      w: opts.spin.clone(),
      half: opts.half,
      mass: opts.mass,
      active: true,
      rest: 0,
      age: 0,
      chain: opts.chain,
      depth: opts.depth,
      hits: opts.hits,
      cool: 8,
      grounded: false,
    };
    this.bodies.push(b);
    this.active.push(b);
    while (this.active.length > MAX_ACTIVE) this.freeze(this.active[0]);
    this.moved.add(b);
    return b;
  }

  /** wake a body that was resting (or frozen) and give it a shove */
  wake(b: Body, vel: Vector3, spin: Vector3) {
    b.v.copy(vel);
    b.w.copy(spin);
    b.rest = 0;
    b.age = 0;
    if (!b.active) {
      b.active = true;
      this.active.push(b);
      while (this.active.length > MAX_ACTIVE) this.freeze(this.active[0]);
    }
  }

  freeze(b: Body) {
    if (!b.active) return;
    b.active = false;
    b.v.set(0, 0, 0);
    b.w.set(0, 0, 0);
    const i = this.active.indexOf(b);
    if (i >= 0) this.active.splice(i, 1);
    this.moved.add(b);
  }

  /** remove from the world entirely (its slot is being reused) */
  retire(b: Body) {
    this.freeze(b);
    b.p.set(0, -1e4, 0);
    this.moved.add(b);
  }

  /** how far the body reaches below its centre along world up */
  private extentDown(b: Body): number {
    if (b.shape === 'sphere') return b.half[0];
    _qi.copy(b.q).invert();
    _u.copy(UP).applyQuaternion(_qi);
    return Math.abs(_u.x) * b.half[0] + Math.abs(_u.y) * b.half[1] + Math.abs(_u.z) * b.half[2];
  }

  private normalAt(x: number, z: number, out: Vector3): Vector3 {
    const e = 0.6;
    const hx = this.ground(x + e, z) - this.ground(x - e, z);
    const hz = this.ground(x, z + e) - this.ground(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  /** Lay planks and logs flat as they come to rest: turn the thin axis toward up. */
  private settle(b: Body, k: number) {
    let axis: Vector3;
    if (b.shape === 'log') {
      // a log rests on its side: whichever of its round axes is nearer up
      const ay = _a.set(0, 1, 0).applyQuaternion(b.q);
      const az = _t.set(0, 0, 1).applyQuaternion(b.q);
      axis = Math.abs(ay.y) > Math.abs(az.y) ? ay : az;
    } else {
      const h = b.half;
      const i = h[0] <= h[1] && h[0] <= h[2] ? 0 : h[1] <= h[2] ? 1 : 2;
      axis = _a.set(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0).applyQuaternion(b.q);
    }
    if (axis.y < 0) axis.negate();
    const dot = Math.min(1, axis.y);
    if (dot > 0.995) return;
    _u.crossVectors(axis, UP);
    const len = _u.length();
    if (len < 1e-5) return;
    _u.divideScalar(len);
    _q.setFromAxisAngle(_u, Math.acos(dot) * k);
    b.q.premultiply(_q).normalize();
  }

  step(dt: number, onMove?: (b: Body) => void) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const b = this.active[i];
      b.age += dt;
      if (b.cool > 0) b.cool--;
      b.v.y -= G * dt;
      b.p.addScaledVector(b.v, dt);
      const wl = b.w.length();
      if (wl > 1e-4) {
        _q.setFromAxisAngle(_a.copy(b.w).divideScalar(wl), wl * dt);
        b.q.premultiply(_q).normalize();
      }
      const gh = this.ground(b.p.x, b.p.z);
      const ext = this.extentDown(b);
      b.grounded = false;
      if (b.p.y - ext < gh) {
        b.grounded = true;
        b.p.y = gh + ext;
        const n = this.normalAt(b.p.x, b.p.z, _n);
        const vn = b.v.dot(n);
        const sphere = b.shape === 'sphere';
        if (vn < 0) b.v.addScaledVector(n, -(1 + (sphere ? 0.28 : 0.18)) * vn);
        // friction: rock rolls on, timber scrapes to a stop
        _t.copy(b.v).addScaledVector(n, -b.v.dot(n));
        const fr = sphere ? 0.55 : b.shape === 'log' ? 1.1 : 3.2;
        b.v.addScaledVector(_t, -(1 - Math.exp(-fr * dt)));
        if (sphere) {
          // rolling: spin follows the motion over the ground
          _u.crossVectors(n, _t).divideScalar(Math.max(0.05, b.half[0]));
          b.w.lerp(_u, 0.25);
        } else {
          b.w.multiplyScalar(b.shape === 'log' ? 0.94 : 0.86);
          this.settle(b, 0.12);
        }
      }
      // out of the world, or long done: stop simulating
      const still = b.v.lengthSq() < 0.12 && b.w.lengthSq() < 0.3;
      b.rest = still && b.grounded ? b.rest + 1 : 0;
      if (b.rest > 24 || b.age > 14 || b.p.y < gh - 6) {
        this.freeze(b);
        if (onMove) onMove(b);
        continue;
      }
      this.moved.add(b);
      if (onMove) onMove(b);
    }
  }

  clear() {
    this.bodies.length = 0;
    this.active.length = 0;
    this.moved.clear();
  }
}
