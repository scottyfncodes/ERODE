import type { Colliders } from '../world/colliders';
import type { TreeGrid, Tree } from '../world/forest';
import type { Terrain } from '../world/terrain';

/**
 * On foot: walking, running, turning to face where you go, wading slower through powder,
 * and leaning into the climb. Steep slopes push back.
 */

export interface Walker {
  x: number;
  y: number;
  z: number;
  /** facing (rad); forward is (-sin, -cos) */
  yaw: number;
  vx: number;
  vz: number;
  /** horizontal speed (m/s) */
  speed: number;
  /** how far the stride cycle has gone (for the legs) */
  stride: number;
}

export const WALK = 2.2;
export const RUN = 5.8;

/**
 * The speed a stick throw asks for: nothing in the deadzone, a careful walk to a brisk one over most
 * of the throw, then a jog building to a full run over the last part. Continuous, so the gait (which
 * is shaped by speed) never jumps between a walk and a run.
 */
export function stickSpeed(mag: number): number {
  if (mag < 0.08) return 0;
  if (mag <= 0.7) return 0.7 + (WALK - 0.7) * ((mag - 0.08) / 0.62);
  const t = Math.min(1, (mag - 0.7) / 0.25);
  return WALK + (RUN - WALK) * t * t * (3 - 2 * t);
}

/** Getting going takes a step or two; stopping is quicker (you dig in), turning is quick. */
export const ACCEL = 7.5;
export const BRAKE = 13;
export const BODY_R = 0.42;

const _trees: Tree[] = [];

export const newWalker = (x: number, z: number, yaw: number, t: Terrain): Walker => ({ x, y: t.height(x, z), z, yaw, vx: 0, vz: 0, speed: 0, stride: 0 });

/**
 * One step. `mx, mz`: desired direction in the world (already turned by the camera),
 * magnitude 0..1; the last quarter of the throw builds from a walk to a run (`stickSpeed`).
 */
export function stepWalker(w: Walker, mx: number, mz: number, dt: number, t: Terrain, solid: Colliders, trees: TreeGrid | null, indoors = false): void {
  const mag = Math.min(1, Math.hypot(mx, mz));
  let target = stickSpeed(mag);
  const surf = indoors ? 'packed' : t.surface(w.x, w.z);
  if (surf === 'powder') target *= 0.82;
  if (surf === 'ice') target *= 0.9;
  let dx = 0;
  let dz = 0;
  if (mag > 0.08) {
    dx = mx / mag;
    dz = mz / mag;
    // uphill is slower, too steep is a wall
    const n = t.normal(w.x, w.z);
    const up = -(dx * n.x + dz * n.z) / Math.max(0.2, n.y);
    if (!indoors && up > 0.25) target *= Math.max(0.15, 1 - (up - 0.25) * 1.3);
    if (!indoors && up > 0.95) target = 0;
    // face where you are going
    const want = Math.atan2(-dx, -dz);
    let d = want - w.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    w.yaw += d * Math.min(1, dt * 12);
  }
  // ease towards the wanted velocity, but no faster than legs can push: a run builds over about
  // three quarters of a second and a stop takes a stride or so, instead of either happening in a frame
  const k = Math.min(1, dt * (mag > 0.08 ? 9 : 12));
  let ax = (dx * target - w.vx) * k;
  let az = (dz * target - w.vz) * k;
  const lim = (target > Math.hypot(w.vx, w.vz) ? ACCEL : BRAKE) * dt;
  const a = Math.hypot(ax, az);
  if (a > lim) {
    ax *= lim / a;
    az *= lim / a;
  }
  w.vx += ax;
  w.vz += az;
  let nx = w.x + w.vx * dt;
  let nz = w.z + w.vz * dt;
  // trees
  if (trees) {
    for (const tr of trees.near(nx, nz, BODY_R, _trees)) {
      const ox = nx - tr.x;
      const oz = nz - tr.z;
      const d = Math.hypot(ox, oz) || 1;
      const push = BODY_R + tr.r - d;
      if (push > 0) {
        nx += (ox / d) * push;
        nz += (oz / d) * push;
      }
    }
  }
  const r = solid.resolve(nx, nz, BODY_R);
  nx = r.x;
  nz = r.z;
  if (!t.inBounds(nx, nz, 40)) {
    nx = w.x;
    nz = w.z;
  }
  const moved = Math.hypot(nx - w.x, nz - w.z);
  w.speed = moved / Math.max(dt, 1e-4);
  w.x = nx;
  w.z = nz;
  const gy = t.height(nx, nz);
  w.y += (gy - w.y) * Math.min(1, dt * 20);
  if (Math.abs(gy - w.y) > 1.5) w.y = gy;
  w.stride += moved;
}
