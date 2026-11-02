import { PerspectiveCamera, Vector3 } from 'three';
import type { LevelDef } from '../levels/types';
import { clamp, smoothstep } from '../sim/geom';

export type CamMode = 'intro' | 'summit' | 'chase' | 'finale' | 'recap' | 'orbit';

interface Rig {
  target: Vector3;
  yaw: number;
  pitch: number;
  dist: number;
}

const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt);
function angDiff(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export interface ChaseInfo {
  pos: Vector3;
  /** a point on the route ahead (where the boulder is going) */
  ahead: Vector3;
  speed: number;
  /** seconds to the next fork and where it is */
  fork: { t: number; at: Vector3 } | null;
  /** the boulder is in the air */
  air: boolean;
}

/**
 * The camera rides behind and above the boulder, looking down the route it is committed to.
 * Approaching a fork it rises and pulls back so every way down can be read; once a way is chosen
 * it swings smoothly onto it. Transitions always ease — the camera never cuts mid-run.
 */
export class CameraDirector {
  mode: CamMode = 'intro';
  readonly cam: PerspectiveCamera;
  private level: LevelDef;
  private ground: (x: number, z: number) => number;
  private desired: Rig;
  private cur: Rig;
  private shakeAmt = 0;
  private time = 0;
  private yaw = 0;
  private forkF = 0;
  private fovKick = 0;
  private focus = new Vector3();
  private snapNext = false;
  /** the lens chosen for this screen; speed widens it */
  baseFov = 50;
  /** the finale shot: where the set piece stands and which way the boulder came */
  finaleAt = new Vector3();
  finaleYaw = 0;
  private finaleT = 0;
  /** recap: the path to fly back over */
  private recapPath: Vector3[] = [];
  private recapT = 0;
  subject = new Vector3();
  subjectYaw = 0;
  orbitDist = 26;

  constructor(cam: PerspectiveCamera, level: LevelDef, ground: (x: number, z: number) => number) {
    this.cam = cam;
    this.level = level;
    this.ground = ground;
    const [bx, bz] = level.boulder.position;
    this.desired = { target: new Vector3(bx, ground(bx, bz), bz + 30), yaw: 0, pitch: 0.3, dist: 30 };
    this.cur = { target: this.desired.target.clone(), yaw: 0.3, pitch: 0.3, dist: 40 };
  }

  setLevel(level: LevelDef, ground: (x: number, z: number) => number) {
    this.level = level;
    this.ground = ground;
  }

  setMode(m: CamMode, snap = false) {
    if (m !== this.mode && (m === 'chase' || m === 'summit')) this.forkF = 0;
    if (m === 'finale') this.finaleT = 0;
    if (m === 'recap') this.recapT = 0;
    this.mode = m;
    this.snapNext = snap;
  }

  /** Small knocks are ignored; big ones give a short, capped rumble. */
  shake(amount: number) {
    if (amount < 0.25) return;
    this.shakeAmt = Math.min(0.55, Math.max(this.shakeAmt, amount * 0.4));
  }
  /** a quick widening of the lens on a big hit */
  punch(amount: number) {
    this.fovKick = Math.max(this.fovKick, Math.min(9, amount * 9));
  }

  recap(path: Vector3[]) {
    this.recapPath = path;
    this.setMode('recap');
  }

  update(dt: number, chase?: ChaseInfo) {
    this.time += dt;
    let k = 3;
    const [bx, bz] = this.level.boulder.position;
    if (this.mode === 'intro') {
      // over the boulder's shoulder: the stone in the foreground, the whole run falling away below
      const t = this.time;
      const by = this.ground(bx, bz) + this.level.boulder.radius;
      const yaw = 0.3 + Math.sin(t * 0.06) * 0.1;
      const pitch = 0.26 + Math.sin(t * 0.045) * 0.025;
      const dist = 80;
      const back = 9 + this.level.boulder.radius * 5;
      const cam = new Vector3(bx - Math.sin(yaw) * back, by + 4 + this.level.boulder.radius * 2, bz - Math.cos(yaw) * back);
      this.desired = {
        target: new Vector3(cam.x + Math.sin(yaw) * Math.cos(pitch) * dist, cam.y - Math.sin(pitch) * dist, cam.z + Math.cos(yaw) * Math.cos(pitch) * dist),
        yaw,
        pitch,
        dist,
      };
      k = 0.9;
    } else if (this.mode === 'summit') {
      // poised: low behind the boulder, the drop and the first fork below
      const by = this.ground(bx, bz) + this.level.boulder.radius;
      this.desired = { target: new Vector3(bx, by - 4, bz + 26), yaw: Math.sin(this.time * 0.25) * 0.05, pitch: 0.34, dist: 36 };
      k = 2;
    } else if (this.mode === 'chase' && chase) {
      this.focus.lerp(chase.pos, damp(10, dt));
      const want = Math.atan2(chase.ahead.x - chase.pos.x, chase.ahead.z - chase.pos.z);
      this.yaw += angDiff(this.yaw, want) * damp(2.4, dt);
      const sp = chase.speed;
      // approaching a fork: rise and pull back so the choices read
      const f = chase.fork ? smoothstep(5.5, 2.4, chase.fork.t) : 0;
      this.forkF += (f - this.forkF) * damp(f > this.forkF ? 2.2 : 1.1, dt);
      const ff = this.forkF;
      const r = this.level.boulder.radius;
      let dist = 6 + r * 4 + Math.min(8, sp * 0.22) + ff * 12;
      let pitch = 0.36 + ff * 0.22;
      if (chase.air) {
        dist += 2;
        pitch += 0.04;
      }
      const target = this.focus.clone().add(new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(6 + sp * 0.3 + ff * 10));
      target.y += r * 0.6;
      if (chase.fork && ff > 0.01) target.lerp(new Vector3(chase.fork.at.x, chase.fork.at.y, chase.fork.at.z), 0.16 * ff);
      this.desired = { target, yaw: this.yaw, pitch, dist };
      const fovTarget = this.baseFov + Math.min(14, sp * 0.4) + ff * 4;
      this.cam.fov += (fovTarget + this.fovKick - this.cam.fov) * damp(3, dt);
      this.cam.updateProjectionMatrix();
      k = 4.2;
      if (this.snapNext) {
        this.snapNext = false;
        this.yaw = want;
        this.focus.copy(chase.pos);
        this.cur = { target: this.desired.target.clone(), yaw: this.desired.yaw, pitch: this.desired.pitch, dist: this.desired.dist };
      }
    } else if (this.mode === 'finale' && chase) {
      // the set piece from three-quarters on, then lift to take in the wreck
      this.finaleT += dt;
      this.focus.lerp(chase.pos, damp(6, dt));
      const lift = smoothstep(1.2, 4, this.finaleT);
      const target = this.finaleAt.clone().lerp(this.focus, 0.35);
      target.y += 2;
      this.desired = { target, yaw: this.finaleYaw + 0.95 - lift * 0.4, pitch: 0.2 + lift * 0.25, dist: 26 + lift * 14 };
      this.cam.fov += (this.baseFov + this.fovKick - this.cam.fov) * damp(2, dt);
      this.cam.updateProjectionMatrix();
      k = 2.6;
    } else if (this.mode === 'recap' && this.recapPath.length > 1) {
      // fly back up the line: the whole trail of wreckage, end to start
      this.recapT += dt;
      const path = this.recapPath;
      const u = Math.min(1, this.recapT / 7.5);
      const e = u * u * (3 - 2 * u);
      const f = (1 - e) * (path.length - 1);
      const i = Math.min(path.length - 2, Math.floor(f));
      const p = path[i].clone().lerp(path[i + 1], f - i);
      const back = path[Math.min(path.length - 1, i + 6)];
      const yaw = Math.atan2(back.x - p.x, back.z - p.z);
      this.desired = { target: p, yaw: yaw + 0.5, pitch: 0.55, dist: 38 };
      k = 1.8;
      if (this.recapT > 8.2) {
        this.subject.copy(path[path.length - 1]);
        this.subjectYaw = yaw;
        this.setMode('orbit');
      }
    } else if (this.mode === 'orbit') {
      this.desired = { target: this.subject.clone(), yaw: this.subjectYaw + this.time * 0.08, pitch: 0.42, dist: this.orbitDist };
      k = 1.2;
    }
    if (this.mode !== 'chase' && this.mode !== 'finale' && Math.abs(this.cam.fov - this.baseFov) > 0.05) {
      this.cam.fov += (this.baseFov - this.cam.fov) * damp(2, dt);
      this.cam.updateProjectionMatrix();
    }
    this.fovKick *= Math.exp(-dt * 5);

    const a = damp(k, dt);
    this.cur.target.lerp(this.desired.target, a);
    this.cur.yaw += angDiff(this.cur.yaw, this.desired.yaw) * a;
    this.cur.pitch += (this.desired.pitch - this.cur.pitch) * a;
    this.cur.dist += (this.desired.dist - this.cur.dist) * a;

    const cp = Math.cos(this.cur.pitch);
    const pos = new Vector3(
      this.cur.target.x - Math.sin(this.cur.yaw) * cp * this.cur.dist,
      this.cur.target.y + Math.sin(this.cur.pitch) * this.cur.dist,
      this.cur.target.z - Math.cos(this.cur.yaw) * cp * this.cur.dist,
    );
    // never below the ground (or inside a ravine wall)
    const g = Math.max(this.ground(pos.x, pos.z), this.ground(pos.x * 0.7 + this.cur.target.x * 0.3, pos.z * 0.7 + this.cur.target.z * 0.3)) + 2.2;
    if (pos.y < g) pos.y = g;
    const look = this.cur.target.clone();
    if (this.shakeAmt > 0.001) {
      const s = this.shakeAmt * 0.03 * clamp(this.cur.dist, 8, 40);
      const off = new Vector3(Math.sin(this.time * 23) * s, Math.sin(this.time * 29 + 1) * s * 0.7, Math.sin(this.time * 19 + 2) * s * 0.5);
      pos.add(off);
      look.add(off.multiplyScalar(0.6));
      this.shakeAmt *= Math.exp(-dt * 8);
    }
    this.cam.position.copy(pos);
    this.cam.lookAt(look);
    const near = clamp(this.cur.dist * 0.02, 0.15, 0.5);
    if (Math.abs(this.cam.near - near) > 0.01) {
      this.cam.near = near;
      this.cam.updateProjectionMatrix();
    }
  }

  /** jump straight to the desired framing */
  snap() {
    this.update(0.0001);
    this.cur = { target: this.desired.target.clone(), yaw: this.desired.yaw, pitch: this.desired.pitch, dist: this.desired.dist };
    this.update(0.0001);
  }

  get lookTarget(): Vector3 {
    return this.cur.target;
  }
  get distance(): number {
    return this.cur.dist;
  }
}
