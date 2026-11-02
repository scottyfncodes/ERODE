import { PerspectiveCamera, Vector3 } from 'three';
import type { LevelDef } from '../levels/types';
import { clamp } from '../sim/geom';

export type CamMode = 'intro' | 'plan' | 'follow' | 'aftermath';

interface Rig {
  target: Vector3;
  yaw: number;
  pitch: number;
  dist: number;
}

const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt);

/**
 * Camera direction for planning, the live descent and the aftermath.
 * The rig is described by a ground target + yaw/pitch/distance; the actual camera
 * eases toward the desired rig so transitions never cut.
 */
export class CameraDirector {
  mode: CamMode = 'intro';
  readonly cam: PerspectiveCamera;
  private level: LevelDef;
  private ground: (x: number, z: number) => number;
  /** what the player has set while planning */
  plan: Rig;
  private desired: Rig;
  private cur: Rig;
  private shakeAmt = 0;
  private time = 0;
  private closeUntil = 0;
  private pullBackUntil = 0;
  private followYaw = 0;
  /** smoothed focus during follow */
  private focus = new Vector3();
  private focusVel = new Vector3();

  constructor(cam: PerspectiveCamera, level: LevelDef, ground: (x: number, z: number) => number) {
    this.cam = cam;
    this.level = level;
    this.ground = ground;
    const c = level.camera;
    this.plan = { target: new Vector3(...c.target), yaw: c.yaw, pitch: c.pitch, dist: c.distance };
    this.desired = this.cloneRig(this.plan);
    this.cur = { target: new Vector3(0, 296, 4), yaw: -0.5, pitch: 0.16, dist: 46 };
  }

  private cloneRig(r: Rig): Rig {
    return { target: r.target.clone(), yaw: r.yaw, pitch: r.pitch, dist: r.dist };
  }

  setMode(m: CamMode) {
    if (m !== 'follow' && this.mode === 'follow') {
      this.cam.fov = this.baseFov;
      this.cam.updateProjectionMatrix();
    }
    this.mode = m;
    if (m === 'follow') {
      this.snapNext = true;
      this.followYaw = this.cur.yaw;
      this.closeUntil = 0;
      this.pullBackUntil = 0;
    }
  }

  resetPlan() {
    const c = this.level.camera;
    this.plan = { target: new Vector3(...c.target), yaw: c.yaw, pitch: c.pitch, dist: c.distance };
  }

  /** Frame a point of interest while planning (e.g. a selected object). */
  focusOn(p: Vector3, dist?: number) {
    this.plan.target.copy(p);
    if (dist !== undefined) this.plan.dist = dist;
    this.clampPlan();
  }

  private clampPlan() {
    const b = this.level.terrain.bounds;
    this.plan.target.x = clamp(this.plan.target.x, b.x[0] + 4, b.x[1] - 4);
    this.plan.target.z = clamp(this.plan.target.z, b.z[0] + 6, b.z[1] - 4);
    this.plan.yaw = clamp(this.plan.yaw, -0.75, 0.75);
    this.plan.pitch = clamp(this.plan.pitch, 0.22, 1.22);
    this.plan.dist = clamp(this.plan.dist, 14, 160);
  }

  pan(dxPx: number, dyPx: number, viewH: number) {
    const k = (this.plan.dist * 1.25) / Math.max(300, viewH);
    const fx = Math.sin(this.plan.yaw),
      fz = Math.cos(this.plan.yaw);
    const rx = -Math.cos(this.plan.yaw),
      rz = Math.sin(this.plan.yaw);
    // grab the ground: content follows the finger
    this.plan.target.x -= rx * dxPx * k;
    this.plan.target.z -= rz * dxPx * k;
    this.plan.target.x += fx * dyPx * k / Math.max(0.4, Math.sin(this.plan.pitch));
    this.plan.target.z += fz * dyPx * k / Math.max(0.4, Math.sin(this.plan.pitch));
    this.clampPlan();
  }

  zoom(factor: number) {
    this.plan.dist *= factor;
    this.clampPlan();
  }

  rotate(dYaw: number, dPitch: number) {
    this.plan.yaw += dYaw;
    this.plan.pitch += dPitch;
    this.clampPlan();
  }

  shake(amount: number) {
    this.shakeAmt = Math.min(1.2, this.shakeAmt + amount);
  }

  /** Called on a fracture during the live run: move in, then pull back to show the spread. */
  punchIn(now: number) {
    this.closeUntil = now + 0.9;
    this.pullBackUntil = now + 2.6;
  }

  frameAftermath(points: Vector3[]) {
    if (!points.length) return;
    const min = points[0].clone(),
      max = points[0].clone();
    for (const p of points) {
      min.min(p);
      max.max(p);
    }
    const c = min.clone().add(max).multiplyScalar(0.5);
    const r = Math.max(10, min.distanceTo(max) * 0.5);
    const fov = (this.cam.fov * Math.PI) / 180;
    const fit = r / Math.tan(fov / 2) / Math.min(1, this.cam.aspect);
    this.desired = { target: c, yaw: 0, pitch: 0.9, dist: clamp(fit * 0.85, 22, 110) };
  }

  private snapNext = false;
  /** the lens the scene rig chose for this screen; the follow camera widens it with speed */
  baseFov = 50;

  update(dt: number, now: number, follow?: { focus: Vector3; vel: Vector3; spread: number; small?: boolean; size?: number; courseYaw?: number }) {
    this.time += dt;
    let k = 3;
    if (this.mode === 'intro') {
      // the summit spire and its boulder, the whole run falling away below
      const t = this.time;
      this.desired = {
        target: new Vector3(Math.sin(t * 0.07) * 3, 296, 4 + Math.sin(t * 0.05) * 3),
        yaw: -0.5 + Math.sin(t * 0.06) * 0.3,
        pitch: 0.16 + Math.sin(t * 0.045) * 0.05,
        dist: 46,
      };
      k = 0.8;
    } else if (this.mode === 'plan') {
      this.desired = this.cloneRig(this.plan);
      this.desired.target.y = this.ground(this.plan.target.x, this.plan.target.z);
      k = 6;
    } else if (this.mode === 'follow' && follow) {
      // high and behind, looking down the course; never inside the dust
      this.focus.lerp(follow.focus, damp(8, dt));
      this.focusVel.lerp(follow.vel, damp(2, dt));
      const sp = this.focusVel.length();
      if (follow.courseYaw !== undefined) {
        let dy = follow.courseYaw - this.followYaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        this.followYaw += dy * damp(1.2, dt);
      }
      // distance scales with the stone: a boulder fills a big frame, a pebble a tight one
      // the frame shrinks with the stone: a wide shot for the boulder, macro for a pebble
      const r = Math.max(0.03, follow.size ?? 1);
      let dist = 1.1 + r * 6.5 + Math.min(r * 4, sp * 0.12) + Math.min(6, sp * 0.06);
      let pitch = 0.42 + Math.min(0.26, r * 0.13);
      if (now < this.closeUntil) {
        dist *= 0.8;
        pitch = 0.6;
      } else if (now < this.pullBackUntil) {
        dist *= 1.25;
        pitch = 0.74;
      }
      const lead = this.focusVel.clone().multiplyScalar(0.28);
      lead.y = 0;
      this.desired = { target: this.focus.clone().add(lead), yaw: this.followYaw, pitch, dist };
      // speed reads as a wider lens
      const fovTarget = this.baseFov + Math.min(16, sp * 0.45);
      this.cam.fov += (fovTarget - this.cam.fov) * damp(2, dt);
      this.cam.updateProjectionMatrix();
      k = 3.2;
      if (this.snapNext) {
        // hard cut into the chase camera: never drag the lens through the ground
        this.snapNext = false;
        this.focus.copy(follow.focus);
        this.desired.target.copy(follow.focus);
        this.cur = this.cloneRig(this.desired);
      }
    } else if (this.mode === 'aftermath') {
      k = 1.4;
    }

    const a = damp(k, dt);
    this.cur.target.lerp(this.desired.target, a);
    this.cur.yaw += (this.desired.yaw - this.cur.yaw) * a;
    this.cur.pitch += (this.desired.pitch - this.cur.pitch) * a;
    this.cur.dist += (this.desired.dist - this.cur.dist) * a;

    const cp = Math.cos(this.cur.pitch);
    const pos = new Vector3(
      this.cur.target.x - Math.sin(this.cur.yaw) * cp * this.cur.dist,
      this.cur.target.y + Math.sin(this.cur.pitch) * this.cur.dist,
      this.cur.target.z - Math.cos(this.cur.yaw) * cp * this.cur.dist,
    );
    // never dip under the ground (closer allowed when the shot is tight)
    const g = this.ground(pos.x, pos.z) + Math.max(0.35, Math.min(2.5, this.cur.dist * 0.18));
    if (pos.y < g) pos.y = g;
    if (this.shakeAmt > 0.001) {
      const s = this.shakeAmt * 0.35;
      pos.x += Math.sin(this.time * 47) * s;
      pos.y += Math.sin(this.time * 59 + 1) * s;
      pos.z += Math.sin(this.time * 41 + 2) * s;
      this.shakeAmt *= Math.exp(-dt * 5);
    }
    this.cam.position.copy(pos);
    this.cam.lookAt(this.cur.target);
    const near = Math.max(0.04, Math.min(0.3, this.cur.dist * 0.04));
    if (Math.abs(this.cam.near - near) > 0.005) {
      this.cam.near = near;
      this.cam.updateProjectionMatrix();
    }
  }

  /** jump straight to the desired framing (used by tests and after loads) */
  snap() {
    this.update(0.0001, 0);
    this.cur = this.cloneRig(this.desired);
  }

  get lookTarget(): Vector3 {
    return this.cur.target;
  }
  get distance(): number {
    return this.cur.dist;
  }
}
