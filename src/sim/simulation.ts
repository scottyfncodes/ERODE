import type RAPIER_T from '@dimforge/rapier3d-deterministic-compat';
import { Quaternion, Vector3 } from 'three';
import type { LevelDef, Plan } from '../levels/types';
import { fracturePiece, generateBoulder, type PieceShape } from './fracture';
import { bedAt, loadLevelData, type LevelData, type WaterBody } from './levelData';
import { hashInts, mulberry32 } from './noise';
import { resolveObjects, type ColliderPart, type Material, type ResolvedObject } from './objects';
import { activeWater, countInterventions } from './plan';
import { pathDistance } from './geom';
import { SURFACE_HARDNESS } from './terrain';

type R = typeof RAPIER_T;

export const DT = 1 / 60;
export const RECORD_EVERY = 2; // record at 30 Hz
export const MAX_STONES = 30;
export const DENSITY = 2.7; // tonnes / m^3 — granite
const GRAVITY = 9.81;
const MIN_FRACTURE_RADIUS = 0.3;
const DUST_RADIUS = 0.14;
const MAX_TIME = 48;
const SETTLE_TIME = 1.1;

export type PieceKind = 'stone' | 'loose';

export interface Piece {
  id: number;
  kind: PieceKind;
  shape: PieceShape;
  body: RAPIER_T.RigidBody;
  collider: RAPIER_T.Collider;
  /** current volume (erosion removes some) */
  volume: number;
  spawnVolume: number;
  generation: number;
  parent: number | null;
  bornStep: number;
  immuneUntil: number;
  delivered: boolean;
  wet: boolean;
  submerged: boolean;
  lastImpactStep: number;
  /** steps spent in water */
  waterSteps: number;
  /** decaying sum of recent velocity changes — captures collisions resolved over several steps */
  impactAcc: Vector3;
}

export type SimEventType = 'fracture' | 'impact' | 'splash' | 'deliver' | 'slump' | 'chip' | 'scrape';

export interface SimEvent {
  step: number;
  type: SimEventType;
  pos: [number, number, number];
  intensity: number;
  material?: Material['kind'] | 'terrain';
  label?: string;
  pieces?: number[];
  parent?: number;
  objectId?: string;
}

export interface FractureRecord {
  time: number;
  pos: [number, number, number];
  against: string;
  pieces: number;
  impact: number;
  generation: number;
}

export interface Track {
  id: number;
  kind: PieceKind;
  shape: PieceShape;
  startFrame: number;
  /** frames × 8 floats: px py pz qx qy qz qw scale */
  data: number[];
  endFrame: number | null;
  /** how the track ended */
  fate: 'fractured' | 'carried' | 'lost' | null;
}

export interface Recording {
  frames: number;
  tracks: Track[];
  events: SimEvent[];
  /** objects that changed state during the run (soil slump, etc.) by frame */
  objectChanges: { frame: number; objectId: string; change: 'slumped' }[];
}

export interface SimResult {
  success: boolean;
  massGoalMet: boolean;
  fractureGoalMet: boolean;
  fractures: FractureRecord[];
  deliveredFraction: number;
  remainingFraction: number;
  lostFraction: number;
  sedimentFraction: number;
  waterExposure: number;
  distance: number;
  destination: string;
  duration: number;
  stoneCount: number;
  largestFraction: number;
  interventions: number;
  stars: number;
  unstable: boolean;
  trajectory: [number, number, number][];
  reason: string;
}

interface EnvInfo {
  kind: 'terrain' | 'object';
  material: Material;
  objectId?: string;
  saturated?: boolean;
}

export class Simulation {
  readonly level: LevelDef;
  readonly data: LevelData;
  readonly plan: Plan;
  readonly world: RAPIER_T.World;
  readonly R: R;
  readonly pieces = new Map<number, Piece>();
  readonly recording: Recording = { frames: 0, tracks: [], events: [], objectChanges: [] };
  readonly objects: ResolvedObject[];
  step = 0;
  done = false;
  result: SimResult | null = null;
  /** events produced since the last call to drainEvents() */
  private pending: SimEvent[] = [];
  private env = new Map<number, EnvInfo>();
  private colliderPiece = new Map<number, number>();
  private queue: RAPIER_T.EventQueue;
  private nextId = 1;
  private tracks = new Map<number, Track>();
  private originalVolume: number;
  private fractures: FractureRecord[] = [];
  private dustVolume = 0;
  private sedimentVolume = 0;
  private erodedLostVolume = 0;
  private carriedVolume = 0;
  private lostVolume = 0;
  private deliveredVolume = 0;
  private settleSteps = 0;
  private primaryId = 1;
  private distance = 0;
  private lastPrimaryPos = new Vector3();
  private trajectory: [number, number, number][] = [];
  private waterOn: Set<string>;
  private waters: WaterBody[];
  private released = false;
  private unstable = false;
  private objectColliders = new Map<string, RAPIER_T.Collider[]>();
  private slumped = new Set<string>();
  private waterExposureSteps = 0;
  /** set to an array to collect impact diagnostics (tuning tools only) */
  debugImpacts: string[] | null = null;

  constructor(R: R, level: LevelDef, plan: Plan) {
    this.R = R;
    this.level = level;
    this.plan = plan;
    this.data = loadLevelData(level);
    this.waterOn = activeWater(level, plan);
    this.waters = this.data.water.filter((w) => this.waterOn.has(w.spec.id));
    const world = new R.World({ x: 0, y: -GRAVITY, z: 0 });
    world.timestep = DT;
    world.numSolverIterations = 6;
    this.world = world;
    this.queue = new R.EventQueue(true);

    // terrain
    const t = R.ColliderDesc.trimesh(this.data.mesh.vertices, this.data.mesh.indices)
      .setFriction(0.74)
      .setRestitution(0.08);
    const tc = world.createCollider(t);
    this.env.set(tc.handle, {
      kind: 'terrain',
      material: { hardness: 0.5, friction: 0.8, restitution: 0.08, label: 'the ground', kind: 'granite' },
    });

    // objects
    this.objects = resolveObjects(level, plan, this.data.heightAt);
    for (const o of this.objects) {
      const list: RAPIER_T.Collider[] = [];
      for (const { part, material } of o.parts) {
        const desc = this.partDesc(part);
        if (!desc) continue;
        desc.setFriction(material.friction).setRestitution(material.restitution);
        if (material.kind === 'ice') desc.setFrictionCombineRule(R.CoefficientCombineRule.Min);
        const c = world.createCollider(desc);
        list.push(c);
        this.env.set(c.handle, { kind: 'object', material, objectId: o.id, saturated: o.saturated });
      }
      this.objectColliders.set(o.id, list);
      if (o.dynamic) {
        this.spawn('loose', o.dynamic.piece, o.dynamic.pos, o.dynamic.quat, [0, 0, 0], [0, 0, 0], 0, null, o.dynamic.material);
      }
    }

    // the boulder
    const b = level.boulder;
    const shape = generateBoulder(b.radius, b.seed);
    this.originalVolume = shape.volume;
    const by = this.data.heightAt(b.position[0], b.position[1]) + b.radius * 0.66;
    const boulder = this.spawn('stone', shape, [b.position[0], by, b.position[1]], [0, 0, 0, 1], [0, 0, 0], [0, 0, 0], 0, null);
    this.primaryId = boulder.id;
    this.lastPrimaryPos.set(b.position[0], by, b.position[1]);
    this.trajectory.push([b.position[0], by, b.position[1]]);
    this.record();
  }

  get originalMass(): number {
    return this.originalVolume * DENSITY;
  }

  get fractureCount(): number {
    return this.fractures.length;
  }

  /** delivered so far, as a fraction of the original boulder */
  get deliveredSoFar(): number {
    return (this.deliveredVolume + this.sedimentVolume) / this.originalVolume;
  }

  private partDesc(part: ColliderPart): RAPIER_T.ColliderDesc | null {
    const R = this.R;
    let d: RAPIER_T.ColliderDesc | null = null;
    switch (part.shape) {
      case 'hull':
        d = R.ColliderDesc.convexHull(part.piece.points);
        break;
      case 'capsule':
        d = R.ColliderDesc.capsule(part.halfHeight, part.radius);
        break;
      case 'box':
        d = R.ColliderDesc.cuboid(...part.half);
        break;
      case 'trimesh':
        return R.ColliderDesc.trimesh(part.vertices, part.indices);
    }
    if (!d) return null;
    d.setTranslation(...part.pos);
    d.setRotation({ x: part.quat[0], y: part.quat[1], z: part.quat[2], w: part.quat[3] });
    return d;
  }

  private spawn(
    kind: PieceKind,
    shape: PieceShape,
    pos: [number, number, number],
    quat: [number, number, number, number],
    linvel: [number, number, number],
    angvel: [number, number, number],
    generation: number,
    parent: number | null,
    material?: Material,
  ): Piece {
    const R = this.R;
    const bd = R.RigidBodyDesc.dynamic()
      .setTranslation(...pos)
      .setRotation({ x: quat[0], y: quat[1], z: quat[2], w: quat[3] })
      .setLinvel(...linvel)
      .setAngvel({ x: angvel[0], y: angvel[1], z: angvel[2] })
      .setLinearDamping(0.04)
      .setAngularDamping(this.baseAngularDamping(kind, shape.radius))
      .setCcdEnabled(true);
    const body = this.world.createRigidBody(bd);
    // Rounded hulls: fresh fragments lose their sharpest edges quickly, which lets them tumble
    // instead of locking on a slope. The points are pulled in by the rounding radius so the
    // collision surface stays where the rendered rock is.
    const border = kind === 'stone' ? Math.min(0.14, shape.radius * (generation === 0 ? 0.05 : 0.11)) : 0.03;
    const shrunk = new Float32Array(shape.points.length);
    for (let i = 0; i < shape.points.length; i += 3) {
      const x = shape.points[i],
        y = shape.points[i + 1],
        z = shape.points[i + 2];
      const l = Math.hypot(x, y, z) || 1;
      const k = Math.max(0.3, (l - border) / l);
      shrunk[i] = x * k;
      shrunk[i + 1] = y * k;
      shrunk[i + 2] = z * k;
    }
    const cd = (R.ColliderDesc.roundConvexHull(shrunk, border) ?? R.ColliderDesc.convexHull(shape.points))!
      .setDensity(DENSITY)
      .setFriction(material?.friction ?? 0.55)
      .setRestitution(material?.restitution ?? 0.1)
      .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(shape.volume * DENSITY * GRAVITY * 1.2);
    const collider = this.world.createCollider(cd, body);
    const id = this.nextId++;
    const p: Piece = {
      id,
      kind,
      shape,
      body,
      collider,
      volume: shape.volume,
      spawnVolume: shape.volume,
      generation,
      parent,
      bornStep: this.step,
      immuneUntil: this.step + 14,
      delivered: false,
      wet: false,
      submerged: false,
      lastImpactStep: -100,
      waterSteps: 0,
      impactAcc: new Vector3(),
    };
    this.pieces.set(id, p);
    this.colliderPiece.set(collider.handle, id);
    if (kind === 'loose') {
      this.env.set(collider.handle, { kind: 'object', material: material!, objectId: 'loose' });
    }
    const track: Track = {
      id,
      kind,
      shape,
      startFrame: this.recording.frames,
      data: [],
      endFrame: null,
      fate: null,
    };
    this.tracks.set(id, track);
    this.recording.tracks.push(track);
    return p;
  }

  private despawn(p: Piece, fate: Track['fate']) {
    const t = this.tracks.get(p.id);
    if (t) {
      // write the final pose so replay shows it right up to the moment it ends
      const expected = (this.recording.frames - t.startFrame) * 8;
      if (t.data.length === expected) this.writeFrame(t, p);
      t.endFrame = t.startFrame + t.data.length / 8 - 1;
      t.fate = fate;
    }
    this.colliderPiece.delete(p.collider.handle);
    this.env.delete(p.collider.handle);
    this.world.removeRigidBody(p.body);
    this.pieces.delete(p.id);
  }

  /** Begin the descent. */
  release() {
    if (this.released) return;
    this.released = true;
    const b = this.pieces.get(this.primaryId);
    if (!b) return;
    const push = this.level.boulder.push;
    b.body.setLinvel({ x: push[0], y: push[1], z: push[2] }, true);
    // roll forward: spin about the x axis
    b.body.setAngvel({ x: push[2] / this.level.boulder.radius, y: 0, z: -push[0] / this.level.boulder.radius }, true);
  }

  drainEvents(): SimEvent[] {
    const e = this.pending;
    this.pending = [];
    return e;
  }

  private emit(e: SimEvent) {
    this.pending.push(e);
    this.recording.events.push(e);
  }

  stepOnce() {
    if (this.done) return;
    if (!this.released) this.release();
    const world = this.world;
    const before = new Map<number, Vector3>();
    for (const p of this.pieces.values()) {
      const v = p.body.linvel();
      before.set(p.id, new Vector3(v.x, v.y, v.z));
      this.applyWater(p);
    }

    world.step(this.queue);
    this.step++;

    // gather contacts
    const contacts = new Map<number, { hardness: number; label: string; env: EnvInfo | null; force: number; otherPiece?: number }>();
    this.queue.drainContactForceEvents((ev) => {
      const h1 = ev.collider1(),
        h2 = ev.collider2();
      const f = ev.totalForceMagnitude();
      for (const [a, b] of [
        [h1, h2],
        [h2, h1],
      ]) {
        const pid = this.colliderPiece.get(a);
        if (pid === undefined) continue;
        const other = this.env.get(b);
        const otherPiece = this.colliderPiece.get(b);
        let hardness = 0.5;
        let label = 'the ground';
        if (other) {
          if (other.kind === 'terrain') {
            const p = this.pieces.get(pid)!;
            const t = p.body.translation();
            const s = this.data.terrain.surface(t.x, t.z);
            hardness = SURFACE_HARDNESS[s];
            label = s === 'bedrock' ? 'bedrock' : s === 'scree' ? 'the scree' : s === 'streambed' ? 'the streambed' : 'the slope';
          } else {
            hardness = other.material.hardness;
            label = other.material.label;
          }
        } else if (otherPiece !== undefined) {
          hardness = 0.75;
          label = 'another fragment';
        }
        const prev = contacts.get(pid);
        if (!prev || f * hardness > prev.force * prev.hardness) {
          contacts.set(pid, { hardness, label, env: other ?? null, force: f, otherPiece });
        }
      }
    });

    const fractureQueue: { p: Piece; dv: Vector3; eff: number; label: string }[] = [];
    const g = new Vector3(0, -GRAVITY * DT, 0);
    for (const p of this.pieces.values()) {
      const v = p.body.linvel();
      const vb = before.get(p.id);
      if (!vb) continue;
      if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z) || Math.hypot(v.x, v.y, v.z) > 80) {
        this.unstable = true;
        continue;
      }
      const step = new Vector3(v.x - vb.x, v.y - vb.y, v.z - vb.z).sub(g);
      p.impactAcc.multiplyScalar(0.45).add(step);
      const c = contacts.get(p.id);
      if (!c) continue;
      const dv = p.impactAcc.clone();
      const impact = dv.length();
      const eff = impact * c.hardness;
      const t = p.body.translation();
      if (c.env?.saturated && c.env.objectId && !this.slumped.has(c.env.objectId) && impact > 0.4) {
        this.slump(c.env.objectId, [t.x, t.y, t.z]);
      }
      if (p.kind === 'stone' && impact > 1.4 && this.step - p.lastImpactStep > 6) {
        p.lastImpactStep = this.step;
        this.emit({
          step: this.step,
          type: 'impact',
          pos: [t.x, t.y, t.z],
          intensity: Math.min(1, (eff / 9) * Math.sqrt(p.shape.radius / this.level.boulder.radius) * 1.4),
          material: c.env?.kind === 'object' ? c.env.material.kind : 'terrain',
          label: c.label,
        });
      }
      if (p.kind !== 'stone' || this.step < p.immuneUntil || p.shape.radius < MIN_FRACTURE_RADIUS) continue;
      const strength = this.strength(p);
      if (this.debugImpacts && eff > 3) this.debugImpacts.push(`${(this.step * DT).toFixed(1)}s ${c.label} eff=${eff.toFixed(1)} r=${p.shape.radius.toFixed(2)} z=${t.z.toFixed(0)}`);
      if (eff > strength) fractureQueue.push({ p, dv, eff, label: c.label });
      else if (eff > strength * 0.62 && impact > 3) {
        // a chip: a little stone lost as grit, a puff of dust
        const lost = p.volume * 0.004 * (eff / strength);
        p.volume -= lost;
        this.dustVolume += lost;
        this.emit({ step: this.step, type: 'chip', pos: [t.x, t.y, t.z], intensity: eff / strength, label: c.label });
      }
    }

    // at most two fractures per step keeps the cost bounded
    fractureQueue.sort((a, b) => b.eff - a.eff);
    for (const f of fractureQueue.slice(0, 2)) this.fracture(f.p, f.dv, f.eff, f.label);

    this.updateWaterState();
    this.checkBounds();
    this.trackPrimary();
    if (this.step % RECORD_EVERY === 0) this.record();
    this.checkEnd();
  }

  /** Rolling resistance: the big boulder ploughs and loses more; small stones roll on. */
  private baseAngularDamping(kind: PieceKind, radius: number): number {
    if (kind === 'loose') return 0.5;
    return 0.18 + 0.24 * Math.min(1, radius / this.level.boulder.radius);
  }

  /** Granite gets stronger as it gets smaller (fewer flaws per piece). */
  strength(p: Piece): number {
    return 7.4 * Math.pow(p.shape.radius / this.level.boulder.radius, -0.32);
  }

  private stoneCount(): number {
    let n = 0;
    for (const p of this.pieces.values()) if (p.kind === 'stone') n++;
    return n;
  }

  private fracture(p: Piece, dv: Vector3, eff: number, label: string) {
    if (!this.pieces.has(p.id)) return;
    const room = MAX_STONES - this.stoneCount() + 1;
    const excess = eff / this.strength(p);
    const rng = mulberry32(hashInts(p.id, this.step, this.level.boulder.seed));
    let count = Math.round(2 + (excess - 1) * 4.5 + rng() * 1.2);
    count = Math.min(count, p.shape.radius < 0.7 ? 3 : 6, room);
    if (count < 2) return;
    const t = p.body.translation();
    const r = p.body.rotation();
    const q = new Quaternion(r.x, r.y, r.z, r.w);
    const qi = q.clone().invert();
    // contact is on the side opposite the velocity change
    const impactLocal = dv.clone().normalize().negate().applyQuaternion(qi);
    const minVol = (4 / 3) * Math.PI * DUST_RADIUS ** 3;
    const res = fracturePiece(p.shape, [impactLocal.x, impactLocal.y, impactLocal.z], count, rng() * 1e9, minVol);
    if (res.cells.length < 2) return;
    const lv = p.body.linvel();
    const av = p.body.angvel();
    const w = new Vector3(av.x, av.y, av.z);
    const base = new Vector3(lv.x, lv.y, lv.z);
    // erosion has removed some volume from this piece; scale the children's accounting
    const volScale = p.volume / p.spawnVolume;
    this.despawn(p, 'fractured');
    const childIds: number[] = [];
    const spread = Math.min(2.6, 0.5 + (excess - 1) * 1.6);
    for (const cell of res.cells) {
      const off = new Vector3(...cell.offset).applyQuaternion(q);
      const pos = off.clone().add(new Vector3(t.x, t.y, t.z));
      const vel = base.clone().add(w.clone().cross(off));
      if (off.lengthSq() > 1e-6) vel.add(off.clone().normalize().multiplyScalar(spread * (0.6 + rng() * 0.6)));
      const ch = this.spawn(
        'stone',
        cell.shape,
        [pos.x, pos.y, pos.z],
        [q.x, q.y, q.z, q.w],
        [vel.x, vel.y, vel.z],
        [w.x + (rng() - 0.5) * 2, w.y + (rng() - 0.5) * 2, w.z + (rng() - 0.5) * 2],
        p.generation + 1,
        p.id,
      );
      ch.volume = cell.shape.volume * volScale;
      ch.spawnVolume = cell.shape.volume;
      ch.delivered = p.delivered;
      childIds.push(ch.id);
    }
    this.dustVolume += res.dustVolume * volScale;
    if (p.delivered) {
      // already counted as delivered: keep the books balanced
      this.deliveredVolume -= res.dustVolume * volScale;
      this.sedimentVolume += res.dustVolume * volScale;
      this.dustVolume -= res.dustVolume * volScale;
    }
    const rec: FractureRecord = {
      time: this.step * DT,
      pos: [t.x, t.y, t.z],
      against: label,
      pieces: res.cells.length,
      impact: eff,
      generation: p.generation,
    };
    this.fractures.push(rec);
    this.emit({
      step: this.step,
      type: 'fracture',
      pos: [t.x, t.y, t.z],
      intensity: Math.min(1, (excess - 0.6) * 0.6 + p.shape.radius / 2.5),
      label,
      pieces: childIds,
      parent: p.id,
    });
    if (p.id === this.primaryId) {
      let best = childIds[0];
      for (const id of childIds) if (this.pieces.get(id)!.volume > this.pieces.get(best)!.volume) best = id;
      this.primaryId = best;
    }
  }

  private slump(objectId: string, pos: [number, number, number]) {
    this.slumped.add(objectId);
    for (const c of this.objectColliders.get(objectId) ?? []) {
      this.env.delete(c.handle);
      this.world.removeCollider(c, true);
    }
    this.objectColliders.set(objectId, []);
    this.recording.objectChanges.push({ frame: this.recording.frames, objectId, change: 'slumped' });
    this.emit({ step: this.step, type: 'slump', pos, intensity: 0.8, objectId, label: 'the saturated soil bank' });
  }

  private applyWater(p: Piece) {
    p.body.resetForces(false);
    if (!this.waters.length) return;
    const t = p.body.translation();
    const v = p.body.linvel();
    const r = p.shape.radius;
    const mass = p.volume * DENSITY;
    let wet = false;
    let submerged = false;
    for (const w of this.waters) {
      const pl = w.pl;
      const reach = w.spec.width / 2 + r * 0.4;
      if (t.x < pl.minX - reach || t.x > pl.maxX + reach || t.z < pl.minZ - reach || t.z > pl.maxZ + reach) continue;
      const hit = pathDistance(pl, t.x, t.z);
      if (hit.d > reach) continue;
      const surface = bedAt(w, hit.s) + w.spec.depth;
      const bottom = t.y - r;
      if (bottom > surface + 0.1) continue;
      const frac = Math.max(0, Math.min(1, (surface - bottom) / (2 * r)));
      if (frac <= 0) continue;
      wet = true;
      const vfx = hit.tx * w.spec.flowSpeed,
        vfz = hit.tz * w.spec.flowSpeed;
      if (w.spec.kind === 'stream') {
        submerged = true;
        const buoy = frac * p.volume * 1.0 * GRAVITY;
        const k = 1.5 * frac * mass;
        p.body.addForce({ x: k * (vfx - v.x), y: buoy - 0.9 * frac * mass * v.y, z: k * (vfz - v.z) }, true);
        this.erode(p, frac, Math.hypot(v.x - vfx, v.z - vfz), true);
      } else {
        // a thin sheet of running water: it pushes, lubricates and wears
        const k = 0.6 * Math.min(1, 0.3 + frac * 3) * mass;
        p.body.addForce({ x: k * (vfx - v.x), y: 0, z: k * (vfz - v.z) }, true);
        this.erode(p, frac * 0.5, Math.hypot(v.x - vfx, v.z - vfz), false);
      }
    }
    if (wet !== p.wet) {
      p.wet = wet;
      p.collider.setFriction(wet ? 0.3 : 0.55);
    }
    if (submerged !== p.submerged) {
      p.submerged = submerged;
      p.body.setAngularDamping(submerged ? 1.2 : this.baseAngularDamping(p.kind, p.shape.radius));
      if (submerged && p.kind === 'stone') {
        const sp = Math.hypot(v.x, v.y, v.z);
        if (sp > 1) this.emit({ step: this.step, type: 'splash', pos: [t.x, t.y, t.z], intensity: Math.min(1, (sp / 10) * (r / 1.2)) });
      }
    }
    if (wet && p.kind === 'stone') {
      p.waterSteps++;
      this.waterExposureSteps += p.volume / this.originalVolume;
    }
  }

  private erode(p: Piece, frac: number, rel: number, inGoal: boolean) {
    if (p.kind !== 'stone') return;
    const r = p.shape.radius;
    // abrasion ∝ wetted area × flow speed; capped so pieces don't vanish
    const dv = 0.0011 * frac * Math.PI * r * r * (0.4 + rel) * DT;
    const floor = p.spawnVolume * 0.86;
    const take = Math.min(dv, Math.max(0, p.volume - floor));
    if (take <= 0) return;
    p.volume -= take;
    if (inGoal && p.delivered) {
      this.sedimentVolume += take;
      this.deliveredVolume -= take;
    } else if (inGoal) this.sedimentVolume += take;
    else this.erodedLostVolume += take;
  }

  private updateWaterState() {
    const goal = this.data.water.find((w) => w.spec.goal);
    if (!goal) return;
    for (const p of this.pieces.values()) {
      if (p.kind !== 'stone' || p.delivered || !p.submerged) continue;
      const t = p.body.translation();
      const hit = pathDistance(goal.pl, t.x, t.z);
      if (hit.d > goal.spec.width / 2) continue;
      const surface = bedAt(goal, hit.s) + goal.spec.depth;
      if (t.y - p.shape.radius * 0.5 < surface) {
        p.delivered = true;
        this.deliveredVolume += p.volume;
        this.emit({ step: this.step, type: 'deliver', pos: [t.x, t.y, t.z], intensity: p.volume / this.originalVolume, pieces: [p.id] });
      }
    }
  }

  private checkBounds() {
    const b = this.level.terrain.bounds;
    for (const p of [...this.pieces.values()]) {
      const t = p.body.translation();
      const ground = this.data.heightAt(t.x, t.z);
      const outside = t.x < b.x[0] + 1 || t.x > b.x[1] - 1 || t.z < b.z[0] + 1 || t.z > b.z[1] - 1;
      if (t.y < ground - 4 || outside || !Number.isFinite(t.y)) {
        if (p.kind === 'stone') {
          if (p.delivered) this.carriedVolume += p.volume;
          else this.lostVolume += p.volume;
        }
        this.despawn(p, p.delivered ? 'carried' : 'lost');
      }
    }
  }

  private trackPrimary() {
    let p = this.pieces.get(this.primaryId);
    if (!p) {
      // primary left the world: follow the largest remaining stone
      let best: Piece | undefined;
      for (const q of this.pieces.values()) if (q.kind === 'stone' && (!best || q.volume > best.volume)) best = q;
      if (!best) return;
      this.primaryId = best.id;
      p = best;
      const t0 = p.body.translation();
      this.lastPrimaryPos.set(t0.x, t0.y, t0.z);
    }
    const t = p.body.translation();
    const cur = new Vector3(t.x, t.y, t.z);
    this.distance += cur.distanceTo(this.lastPrimaryPos);
    this.lastPrimaryPos.copy(cur);
    if (this.step % 6 === 0) this.trajectory.push([t.x, t.y, t.z]);
  }

  get primary(): Piece | undefined {
    return this.pieces.get(this.primaryId);
  }

  private writeFrame(track: Track, p: Piece) {
    const t = p.body.translation();
    const r = p.body.rotation();
    const scale = Math.cbrt(Math.max(0.01, p.volume / p.spawnVolume));
    track.data.push(t.x, t.y, t.z, r.x, r.y, r.z, r.w, scale);
  }

  private record() {
    for (const p of this.pieces.values()) {
      const track = this.tracks.get(p.id)!;
      // keep frame alignment: each track has exactly one entry per frame since startFrame
      const expected = (this.recording.frames - track.startFrame) * 8;
      while (track.data.length < expected && track.data.length >= 8) {
        track.data.push(...track.data.slice(track.data.length - 8));
      }
      if (track.data.length === expected) this.writeFrame(track, p);
    }
    this.recording.frames++;
  }

  private checkEnd() {
    const time = this.step * DT;
    let settled = true;
    let stones = 0;
    for (const p of this.pieces.values()) {
      if (p.kind !== 'stone') continue;
      stones++;
      if (p.delivered) continue;
      const v = p.body.linvel();
      const w = p.body.angvel();
      if (Math.hypot(v.x, v.y, v.z) > 0.3 || Math.hypot(w.x, w.y, w.z) > 0.6) {
        settled = false;
        break;
      }
    }
    if (settled && time > 1.5) this.settleSteps++;
    else this.settleSteps = 0;
    const allDelivered = stones > 0 && [...this.pieces.values()].every((p) => p.kind !== 'stone' || p.delivered);
    this.deliveredSteps = allDelivered ? this.deliveredSteps + 1 : 0;
    if (this.unstable) this.finish('unstable');
    else if (stones === 0) this.finish('the stream carried everything away');
    else if (allDelivered) {
      if (this.deliveredSteps * DT > 2.5) this.finish('the stream has it');
    } else if (this.settleSteps * DT > SETTLE_TIME) this.finish('the stone came to rest');
    else if (time > MAX_TIME) this.finish('time');
  }

  private deliveredSteps = 0;

  /** Run to completion (headless). */
  runToEnd(maxSteps = Math.ceil(MAX_TIME / DT) + 10): SimResult {
    while (!this.done && this.step < maxSteps) this.stepOnce();
    if (!this.done) this.finish('time');
    return this.result!;
  }

  private destinationName(): string {
    const p = this.primary;
    if (!p) return this.deliveredVolume > 0 ? 'carried off by the stream' : 'lost';
    if (p.delivered) return 'the stream';
    const t = p.body.translation();
    for (const r of this.level.regions) if (t.x >= r.x[0] && t.x <= r.x[1] && t.z >= r.z[0] && t.z <= r.z[1]) return r.name;
    return 'the mountainside';
  }

  finish(reason: string) {
    if (this.done) return;
    this.done = true;
    this.record();
    // anything still in the world that was delivered stays delivered
    const orig = this.originalVolume;
    let remaining = 0;
    let largest = 0;
    let stones = 0;
    for (const p of this.pieces.values()) {
      if (p.kind !== 'stone') continue;
      remaining += p.volume;
      largest = Math.max(largest, p.volume);
      stones++;
    }
    const delivered = this.deliveredVolume + this.sedimentVolume;
    const deliveredFraction = Math.max(0, Math.min(1, delivered / orig));
    const remainingFraction = Math.max(0, Math.min(1, (remaining + this.carriedVolume) / orig));
    const lostFraction = Math.max(0, Math.min(1, 1 - remainingFraction - this.sedimentVolume / orig));
    const obj = this.level.objective;
    const massGoalMet = deliveredFraction >= obj.minMassFraction;
    const fractureGoalMet = this.fractures.length >= obj.minFractures;
    const success = massGoalMet && fractureGoalMet && !this.unstable;
    const interventions = countInterventions(this.level, this.plan);
    let stars = 0;
    if (success) {
      stars = 1;
      if (deliveredFraction >= this.level.stars.deliveredFraction) stars++;
      if (interventions <= this.level.stars.maxInterventions) stars++;
    }
    const p = this.primary;
    if (p) {
      const t = p.body.translation();
      this.trajectory.push([t.x, t.y, t.z]);
    }
    this.result = {
      success,
      massGoalMet,
      fractureGoalMet,
      fractures: this.fractures,
      deliveredFraction,
      remainingFraction,
      lostFraction,
      sedimentFraction: this.sedimentVolume / orig,
      waterExposure: this.waterExposureSteps * DT,
      distance: this.distance,
      destination: this.destinationName(),
      duration: this.step * DT,
      stoneCount: stones,
      largestFraction: largest / orig,
      interventions,
      stars,
      unstable: this.unstable,
      trajectory: this.trajectory,
      reason,
    };
  }

  dispose() {
    try {
      this.queue.free();
      this.world.free();
    } catch {
      /* already freed */
    }
  }
}
