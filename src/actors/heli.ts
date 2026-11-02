import type { Terrain } from '../world/terrain';

/**
 * The patrol helicopter, flown the friendly way: the stick moves you over the ground (relative to
 * the camera), the lever climbs and descends, and the nose turns to follow where you are going so
 * the scanner looks where you fly. It carries momentum, leans into acceleration and settles onto
 * the ground when you bring it down slowly.
 */

export interface Heli {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  /** body tilt for the mesh (rad) */
  pitch: number;
  roll: number;
  /** rotor speed 0..1 */
  rotor: number;
  /** on the ground */
  landed: boolean;
  /** engines running */
  running: boolean;
  /** hard ground contact this step (m/s) */
  bump: number;
}

export interface HeliProfile {
  accel: number;
  top: number;
  climb: number;
  ceiling: number;
}

export const HELI: HeliProfile = { accel: 8, top: 32, climb: 7, ceiling: 380 };

export const SKID = 0.15;

export const newHeli = (x: number, z: number, yaw: number, t: Terrain): Heli => ({
  x, y: t.height(x, z) + SKID, z, vx: 0, vy: 0, vz: 0, yaw, pitch: 0, roll: 0, rotor: 0, landed: true, running: false, bump: 0,
});

export const heliAgl = (h: Heli, t: Terrain) => h.y - t.height(h.x, h.z);

/**
 * One step. `mx, mz`: desired ground direction (world, magnitude 0..1). `lift`: -1..1.
 * `wind`: a push (m/s²) on the airframe.
 */
export function stepHeli(h: Heli, p: HeliProfile, mx: number, mz: number, lift: number, dt: number, t: Terrain, wind: { x: number; z: number } = { x: 0, z: 0 }): void {
  h.bump = 0;
  h.rotor += ((h.running ? 1 : 0) - h.rotor) * Math.min(1, dt * (h.running ? 1.3 : 0.45));
  const ready = h.rotor > 0.92;
  const gy = t.height(h.x, h.z);
  if (h.landed) {
    h.vx = h.vy = h.vz = 0;
    h.y = gy + SKID;
    h.pitch *= 0.9;
    h.roll *= 0.9;
    if (ready && lift > 0.2) {
      h.landed = false;
      h.vy = 1.5;
    }
    return;
  }
  const mag = Math.min(1, Math.hypot(mx, mz));
  const agl = h.y - gy;
  // ground effect: horizontal movement is gentle right by the ground
  const low = Math.min(1, agl / 6);
  const top = p.top * (0.35 + 0.65 * low);
  const tx = mx * top;
  const tz = mz * top;
  const k = Math.min(1, (p.accel / Math.max(6, p.top)) * dt * 1.6);
  const ax = (tx - h.vx) * k;
  const az = (tz - h.vz) * k;
  h.vx += ax + wind.x * dt;
  h.vz += az + wind.z * dt;
  // climb with the lever; hold altitude when it is centred
  const targetVy = lift * p.climb * (h.rotor > 0.6 ? 1 : 0) - (h.rotor < 0.6 ? 3 : 0);
  h.vy += (targetVy - h.vy) * Math.min(1, dt * 2.5);
  h.x += h.vx * dt;
  h.y += h.vy * dt;
  h.z += h.vz * dt;
  // world edge: a soft wall
  const lim = 940;
  if (Math.abs(h.x) > lim) {
    h.x = Math.sign(h.x) * lim;
    h.vx *= -0.2;
  }
  if (Math.abs(h.z) > lim) {
    h.z = Math.sign(h.z) * lim;
    h.vz *= -0.2;
  }
  const g2 = t.height(h.x, h.z);
  const ceiling = Math.max(g2 + 40, p.ceiling + 300);
  if (h.y > ceiling) {
    h.y = ceiling;
    h.vy = Math.min(0, h.vy);
  }
  if (h.y < g2 + SKID) {
    const sp = Math.hypot(h.vx, h.vz);
    h.bump = Math.max(-h.vy, 0) + (sp > 6 ? sp * 0.3 : 0);
    h.y = g2 + SKID;
    // settle when slow, or skid along
    if (sp < 4 && h.vy <= 0.5 && lift <= 0.05) {
      h.landed = true;
      h.vx = h.vy = h.vz = 0;
    } else {
      h.vy = Math.max(0, h.vy);
      h.vx *= 0.9;
      h.vz *= 0.9;
    }
  }
  // the nose follows the way you are going
  const sp = Math.hypot(h.vx, h.vz);
  if (sp > 2.5 || mag > 0.25) {
    const dx = sp > 2.5 ? h.vx : mx;
    const dz = sp > 2.5 ? h.vz : mz;
    const want = Math.atan2(-dx, -dz);
    let d = want - h.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    h.yaw += d * Math.min(1, dt * 1.8);
  }
  // body attitude: nose down to accelerate, roll into turns
  const fx = -Math.sin(h.yaw);
  const fz = -Math.cos(h.yaw);
  const accF = (ax * fx + az * fz) / Math.max(dt, 1e-3);
  const accR = (ax * -fz + az * fx) / Math.max(dt, 1e-3);
  const fwdSp = h.vx * fx + h.vz * fz;
  const wantPitch = -Math.max(-0.35, Math.min(0.35, fwdSp * 0.008 + accF * 0.03));
  const wantRoll = Math.max(-0.45, Math.min(0.45, accR * 0.04));
  h.pitch += (wantPitch - h.pitch) * Math.min(1, dt * 3);
  h.roll += (wantRoll - h.roll) * Math.min(1, dt * 3);
}
