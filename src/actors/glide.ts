import type { Colliders } from '../world/colliders';
import type { Tree, TreeGrid } from '../world/forest';
import { SURFACE_DRAG, SURFACE_GRIP, type Surface, type Terrain } from '../world/terrain';

/**
 * Anything that slides on snow: the snowmobile and the skis share one arcade model.
 * Velocity lives in the world; the heading pulls it round with grip, so you carve on packed
 * snow, drift in powder and skate on lake ice. Gravity along the slope is real; crests throw
 * you into the air and you land where the ground meets you.
 */

export interface GlideProfile {
  /** engine push (m/s²) at full throttle, 0 for skis */
  engine: number;
  /** soft top speed under power (m/s) */
  top: number;
  /** braking (m/s²) */
  brake: number;
  /** reverse speed (m/s), 0: none */
  reverse: number;
  /** turn rate (rad/s) at a good speed */
  turn: number;
  /** how hard lateral slip is cancelled (1/s) */
  grip: number;
  /** air drag coefficient (per m) */
  air: number;
  /** pushing / poling on the flat (m/s²) and up to what speed */
  push: number;
  pushTop: number;
  /** how much a powder surface slows you (0..1 of its drag) */
  powderDrag: number;
  /** collision radius */
  radius: number;
  /** how well it climbs: fraction of gravity cancelled when pushing uphill (skins, tracks) */
  climb: number;
}

export const SLED: GlideProfile = { engine: 9.5, top: 24, brake: 12, reverse: 4, turn: 1.9, grip: 5.5, air: 0.0016, push: 0, pushTop: 0, powderDrag: 0.55, radius: 1.1, climb: 0.55 };
export const SKIS: GlideProfile = { engine: 0, top: 30, brake: 5, reverse: 0, turn: 2.2, grip: 4.2, air: 0.0022, push: 2.2, pushTop: 4.2, powderDrag: 0.9, radius: 0.5, climb: 0 };

export interface Glider {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  /** -1..1, for the lean */
  lean: number;
  airborne: boolean;
  /** seconds in the air this hop */
  air: number;
  /** the last landing's hardness (m/s down), for effects */
  landed: number;
  /** a tree or wall this step: impact speed */
  bump: number;
  surface: Surface;
  /** throttle as applied (for the engine note) */
  power: number;
  /** sideways slip (m/s), for the spray */
  slip: number;
}

const G = 9.81;
const _trees: Tree[] = [];

export const newGlider = (x: number, z: number, yaw: number, t: Terrain): Glider => ({
  x, y: t.height(x, z), z, vx: 0, vy: 0, vz: 0, yaw, lean: 0, airborne: false, air: 0, landed: 0, bump: 0, surface: 'packed', power: 0, slip: 0,
});

export const glideSpeed = (g: Glider) => Math.hypot(g.vx, g.vz);
/** signed speed along the heading */
export const forwardSpeed = (g: Glider) => -(g.vx * Math.sin(g.yaw) + g.vz * Math.cos(g.yaw));

/**
 * One step. `steer` -1 (left) .. 1 (right), `throttle` -1 (brake / reverse / snowplough) .. 1.
 * `boost` multiplies the engine and top speed (upgrades).
 */
export function stepGlider(g: Glider, p: GlideProfile, steer: number, throttle: number, dt: number, t: Terrain, solid: Colliders, trees: TreeGrid | null, boost = 1): void {
  g.bump = 0;
  g.landed = 0;
  const fx = -Math.sin(g.yaw);
  const fz = -Math.cos(g.yaw);
  const surf = t.surface(g.x, g.z);
  g.surface = surf;
  const n = t.normal(g.x, g.z);
  let fwd = g.vx * fx + g.vz * fz;
  const speed = Math.hypot(g.vx, g.vz);

  if (!g.airborne) {
    // steering: weak when crawling, best at a run, a little less at top speed
    const authority = Math.min(1, Math.abs(fwd) / 4 + 0.15) * (1 - Math.min(0.35, speed / 90));
    const dir = fwd < -0.5 ? -1 : 1;
    g.yaw -= steer * p.turn * authority * dir * dt;

    // gravity along the slope
    let gx = G * n.x * n.y;
    let gz = G * n.z * n.y;
    // engine / pushing
    let push = 0;
    if (throttle > 0) {
      if (p.engine > 0) {
        const top = p.top * boost;
        push = throttle * p.engine * boost * Math.max(0, 1 - Math.max(0, fwd) / top);
      } else if (fwd < p.pushTop) push = throttle * p.push;
      // climbing aid: tracks or skins cancel part of gravity's pull back down
      const back = -(gx * fx + gz * fz);
      if (back > 0 && p.climb > 0) {
        gx += fx * back * p.climb * throttle;
        gz += fz * back * p.climb * throttle;
      }
    }
    g.vx += (fx * push + gx) * dt;
    g.vz += (fz * push + gz) * dt;
    g.power += ((throttle > 0 ? throttle : 0) - g.power) * Math.min(1, dt * 6);

    // braking / reverse / snowplough
    fwd = g.vx * fx + g.vz * fz;
    if (throttle < 0) {
      if (fwd > 0.3) {
        const b = Math.min(fwd, -throttle * p.brake * dt);
        g.vx -= fx * b;
        g.vz -= fz * b;
      } else if (p.reverse > 0 && fwd > -p.reverse) {
        g.vx -= fx * 3 * -throttle * dt;
        g.vz -= fz * 3 * -throttle * dt;
      }
    }

    // grip: cancel the sideways part of the motion
    const lx = -fz;
    const lz = fx;
    const lat = g.vx * lx + g.vz * lz;
    const grip = p.grip * SURFACE_GRIP[surf];
    const keep = Math.exp(-grip * dt);
    g.vx -= lx * lat * (1 - keep);
    g.vz -= lz * lat * (1 - keep);
    g.slip = Math.abs(lat);

    // snow drag and rolling resistance
    const drag = SURFACE_DRAG[surf] * (surf === 'powder' ? p.powderDrag : 1);
    const sp = Math.hypot(g.vx, g.vz);
    if (sp > 1e-4) {
      const loss = (drag * 9 + p.air * sp * sp + (throttle === 0 && p.engine > 0 ? 0.6 : 0)) * dt;
      const k = Math.max(0, sp - loss) / sp;
      g.vx *= k;
      g.vz *= k;
    }
    g.lean += (steer * Math.min(1, sp / 8) - g.lean) * Math.min(1, dt * 6);
  } else {
    g.air += dt;
    g.lean *= 1 - Math.min(1, dt * 2);
    // a little air control
    g.yaw -= steer * 0.6 * dt;
  }

  // move, then meet the ground
  let nx = g.x + g.vx * dt;
  let nz = g.z + g.vz * dt;
  // trees: a glancing knock or a hard stop
  if (trees) {
    for (const tr of trees.near(nx, nz, p.radius, _trees)) {
      const ox = nx - tr.x;
      const oz = nz - tr.z;
      const d = Math.hypot(ox, oz) || 1;
      const ux = ox / d;
      const uz = oz / d;
      const into = -(g.vx * ux + g.vz * uz);
      if (into > 0) {
        g.bump = Math.max(g.bump, into);
        g.vx += ux * into * 1.4;
        g.vz += uz * into * 1.4;
        g.vx *= 0.7;
        g.vz *= 0.7;
      }
      nx = tr.x + ux * (p.radius + tr.r);
      nz = tr.z + uz * (p.radius + tr.r);
    }
  }
  const r = solid.resolve(nx, nz, p.radius);
  if (r.hit) {
    const into = -(g.vx * r.nx + g.vz * r.nz);
    if (into > 0) {
      g.bump = Math.max(g.bump, into);
      g.vx += r.nx * into * 1.3;
      g.vz += r.nz * into * 1.3;
      g.vx *= 0.75;
      g.vz *= 0.75;
    }
    nx = r.x;
    nz = r.z;
  }
  if (!t.inBounds(nx, nz, 40)) {
    nx = g.x;
    nz = g.z;
    g.vx *= -0.3;
    g.vz *= -0.3;
  }

  const gy = t.height(nx, nz);
  if (g.airborne) {
    g.vy -= G * dt;
    let ny = g.y + g.vy * dt;
    if (ny <= gy) {
      g.landed = Math.max(0, -g.vy);
      ny = gy;
      g.airborne = false;
      g.air = 0;
      // keep the part of the fall that runs along the slope
      const n2 = t.normal(nx, nz);
      const vdotn = g.vx * n2.x + g.vy * n2.y + g.vz * n2.z;
      if (vdotn < 0) {
        g.vx -= n2.x * vdotn;
        g.vz -= n2.z * vdotn;
      }
      g.vy = 0;
    }
    g.y = ny;
  } else {
    // would we leave the ground here? (a crest at speed)
    const vyGround = (gy - g.y) / Math.max(dt, 1e-4);
    const predicted = g.y + g.vy * dt - G * dt * dt;
    if (gy < predicted - 0.08 && g.vy > vyGround + 2.2 && Math.hypot(g.vx, g.vz) > 7) {
      g.airborne = true;
      g.air = 0;
      g.y = predicted;
    } else {
      g.vy = vyGround;
      g.y = gy;
    }
  }
  g.x = nx;
  g.z = nz;
}
