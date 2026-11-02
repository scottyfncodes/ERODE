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
export const RECORD_EVERY = 3; // record at 20 Hz
export const MAX_STONES = 34;
export const DENSITY = 2.7; // tonnes / m^3 — granite
const GRAVITY = 9.81;
/** stones are never simulated smaller than this; below it, size is tracked (and drawn) virtually */
export const MIN_PHYSICAL_RADIUS = 0.24;
const MAX_TIME = 240;
/** arcade grip: stone skids down anything steeper than ~17° rather than parking on it */
const STONE_FRICTION = 0.26;

/** The journey: Boulder → Fragment → Rock → Pebble → Gravel → Sand (thresholds are radius in metres). */
export const STAGES = [
  { name: 'Boulder', min: 0.9, mult: 1 },
  { name: 'Fragment', min: 0.45, mult: 1.5 },
  { name: 'Rock', min: 0.16, mult: 2 },
  { name: 'Pebble', min: 0.025, mult: 3 },
  { name: 'Gravel', min: 0.0025, mult: 5 },
  { name: 'Sand', min: 0, mult: 8 },
] as const;

export function stageOf(size: number): number {
  for (let i = 0; i < STAGES.length; i++) if (size >= STAGES[i].min) return i;
  return STAGES.length - 1;
}

export type PieceKind = 'stone' | 'loose';

export interface Piece {
  id: number;
  kind: PieceKind;
  shape: PieceShape;
  body: RAPIER_T.RigidBody;
  collider: RAPIER_T.Collider;
  /** true size of the stone (radius, m); smaller than the shape once it is ground below physics scale */
  size: number;
  generation: number;
  parent: number | null;
  bornStep: number;
  immuneUntil: number;
  wet: boolean;
  submerged: boolean;
  lastImpactStep: number;
  lastContactStep: number;
  impactAcc: Vector3;
  /** stuck counter (steps) */
  still: number;
  grinding: number;
}

export type SimEventType = 'fracture' | 'crack' | 'impact' | 'splash' | 'chip' | 'slump' | 'score' | 'stage' | 'air' | 'breakoff' | 'nudge';

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
  points?: number;
  combo?: number;
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
  fate: 'fractured' | 'carried' | 'lost' | 'culled' | null;
}

export interface Recording {
  frames: number;
  tracks: Track[];
  events: SimEvent[];
  objectChanges: { frame: number; objectId: string; change: 'slumped' }[];
  /** leader id per frame, for the replay camera */
  leader: number[];
}

export interface SimResult {
  score: number;
  /** metres travelled down the course by the leading stone */
  distance: number;
  /** progress as a fraction of the course to the beach */
  progress: number;
  /** final size of the leading stone (radius, m) */
  size: number;
  stage: number;
  bestStage: number;
  landed: boolean;
  sand: boolean;
  smashes: number;
  maxCombo: number;
  airTime: number;
  waterTime: number;
  fractures: FractureRecord[];
  destination: string;
  duration: number;
  stoneCount: number;
  interventions: number;
  nudgesUsed: number;
  unstable: boolean;
  trajectory: [number, number, number][];
  reason: string;
  breakdown: { label: string; points: number }[];
  grade: string;
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
  readonly recording: Recording = { frames: 0, tracks: [], events: [], objectChanges: [], leader: [] };
  readonly objects: ResolvedObject[];
  step = 0;
  done = false;
  result: SimResult | null = null;
  private pending: SimEvent[] = [];
  private env = new Map<number, EnvInfo>();
  private colliderPiece = new Map<number, number>();
  private queue: RAPIER_T.EventQueue;
  private nextId = 1;
  private tracks = new Map<number, Track>();
  private fractures: FractureRecord[] = [];
  private trajectory: [number, number, number][] = [];
  private waters: WaterBody[];
  private released = false;
  private unstable = false;
  private objectColliders = new Map<string, RAPIER_T.Collider[]>();
  private slumped = new Set<string>();
  private leaderId = 1;
  private startZ: number;
  private finishZ: number;
  private maxZ: number;
  private leaderStill = 0;
  private landedSteps = 0;
  // scoring
  private smashPoints = 0;
  private bonusPoints = 0;
  private smashes = 0;
  private combo = 0;
  private maxCombo = 0;
  private lastSmashStep = -1000;
  private bestStage = 0;
  private airSteps = 0;
  private totalAir = 0;
  private waterSteps = 0;
  private breakdown: { label: string; points: number }[] = [];
  nudgesLeft: number;
  private nudgesUsed = 0;
  /** set to an array to collect impact diagnostics (tuning tools only) */
  debugImpacts: string[] | null = null;

  constructor(R: R, level: LevelDef, plan: Plan) {
    this.R = R;
    this.level = level;
    this.plan = plan;
    this.data = loadLevelData(level);
    const waterOn = activeWater(level, plan);
    this.waters = this.data.water.filter((w) => waterOn.has(w.spec.id));
    this.nudgesLeft = level.nudges ?? 0;
    const world = new R.World({ x: 0, y: -GRAVITY, z: 0 });
    world.timestep = DT;
    world.numSolverIterations = 5;
    this.world = world;
    this.queue = new R.EventQueue(true);

    const t = R.ColliderDesc.trimesh(this.data.mesh.vertices, this.data.mesh.indices).setFriction(0.74).setRestitution(0.1);
    const tc = world.createCollider(t);
    this.env.set(tc.handle, {
      kind: 'terrain',
      material: { hardness: 0.5, friction: 0.8, restitution: 0.08, label: 'the ground', kind: 'granite' },
    });

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
      if (o.dynamic) this.spawn('loose', o.dynamic.piece, o.dynamic.pos, o.dynamic.quat, [0, 0, 0], [0, 0, 0], 0, null, o.dynamic.material);
    }

    const pose = restingBoulder(level);
    const boulder = this.spawn('stone', pose.shape, pose.pos, [0, 0, 0, 1], [0, 0, 0], [0, 0, 0], 0, null);
    this.leaderId = boulder.id;
    this.startZ = pose.pos[2];
    this.maxZ = this.startZ;
    this.finishZ = level.beach?.z[0] ?? level.terrain.bounds.z[1];
    this.trajectory.push([...pose.pos]);
    this.record();
  }

  get fractureCount(): number {
    return this.fractures.length;
  }
  get leader(): Piece | undefined {
    return this.pieces.get(this.leaderId);
  }
  /** live score shown during the run (before the final multipliers) */
  get liveScore(): number {
    return Math.round(this.distancePoints() + this.smashPoints + this.bonusPoints);
  }
  get liveDistance(): number {
    return Math.max(0, this.maxZ - this.startZ);
  }
  get liveCombo(): number {
    return this.step - this.lastSmashStep < COMBO_STEPS ? this.combo : 0;
  }
  private distancePoints() {
    return Math.max(0, this.maxZ - this.startZ) * 10;
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
      .setLinearDamping(0.02 + 0.1 * Math.min(1, shape.radius / this.level.boulder.radius))
      .setAngularDamping(this.baseAngularDamping(kind, shape.radius))
      .setCcdEnabled(true);
    const body = this.world.createRigidBody(bd);
    // rounded hulls let fresh fragments tumble instead of locking on slopes
    const border = kind === 'stone' ? Math.min(0.14, shape.radius * (generation === 0 ? 0.05 : 0.12)) : 0.03;
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
      .setFriction(material?.friction ?? STONE_FRICTION)
      .setFrictionCombineRule(R.CoefficientCombineRule.Min)
      .setRestitution(material?.restitution ?? 0.16)
      .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(shape.volume * DENSITY * GRAVITY * 0.9);
    const collider = this.world.createCollider(cd, body);
    const id = this.nextId++;
    const p: Piece = {
      id,
      kind,
      shape,
      body,
      collider,
      size: shape.radius,
      generation,
      parent,
      bornStep: this.step,
      immuneUntil: this.step + 10,
      wet: false,
      submerged: false,
      lastImpactStep: -100,
      lastContactStep: this.step,
      impactAcc: new Vector3(),
      still: 0,
      grinding: 0,
    };
    this.pieces.set(id, p);
    this.colliderPiece.set(collider.handle, id);
    if (kind === 'loose') this.env.set(collider.handle, { kind: 'object', material: material!, objectId: 'loose' });
    const track: Track = { id, kind, shape, startFrame: this.recording.frames, data: [], endFrame: null, fate: null };
    this.tracks.set(id, track);
    this.recording.tracks.push(track);
    return p;
  }

  private despawn(p: Piece, fate: Track['fate']) {
    const t = this.tracks.get(p.id);
    if (t) {
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

  /** The boulder snaps off the summit and goes over the edge. */
  release() {
    if (this.released) return;
    this.released = true;
    const b = this.pieces.get(this.leaderId);
    if (!b) return;
    const push = this.level.boulder.push;
    b.body.setLinvel({ x: push[0], y: push[1], z: push[2] }, true);
    b.body.setAngvel({ x: push[2] / this.level.boulder.radius, y: 0, z: -push[0] / this.level.boulder.radius }, true);
    const t = b.body.translation();
    this.emit({ step: this.step, type: 'breakoff', pos: [t.x, t.y, t.z], intensity: 1, label: 'the summit' });
  }

  /** A live shove left (-1) or right (+1). */
  nudge(dir: number): boolean {
    const p = this.leader;
    if (!p || this.nudgesLeft <= 0 || this.done) return false;
    this.nudgesLeft--;
    this.nudgesUsed++;
    const v = p.body.linvel();
    const sp = Math.hypot(v.x, v.z);
    // across the direction of travel; "right" is screen-right for a camera looking downhill (-x)
    let ax = sp > 0.5 ? -v.z / sp : -1;
    let az = sp > 0.5 ? v.x / sp : 0;
    ax *= dir;
    az *= dir;
    const m = p.body.mass();
    p.body.applyImpulse({ x: ax * m * 5.5, y: m * 2.2, z: az * m * 5.5 }, true);
    const t = p.body.translation();
    this.emit({ step: this.step, type: 'nudge', pos: [t.x, t.y, t.z], intensity: 0.6 });
    return true;
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

  private award(points: number, label: string, pos: [number, number, number], combo?: number) {
    points = Math.round(points);
    this.emit({ step: this.step, type: 'score', pos, intensity: points, points, label, combo });
  }

  stepOnce() {
    if (this.done) return;
    if (!this.released) this.release();
    const before = new Map<number, Vector3>();
    for (const p of this.pieces.values()) {
      const v = p.body.linvel();
      before.set(p.id, new Vector3(v.x, v.y, v.z));
      this.applyWater(p);
    }

    this.world.step(this.queue);
    this.step++;

    const contacts = new Map<number, { hardness: number; label: string; env: EnvInfo | null; force: number }>();
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
            label = s === 'bedrock' ? 'bedrock' : s === 'scree' ? 'the scree' : s === 'streambed' ? 'the riverbed' : s === 'sand' ? 'the sand' : 'the slope';
          } else {
            hardness = other.material.hardness;
            label = other.material.label;
          }
        } else if (otherPiece !== undefined) {
          hardness = 0.8;
          label = 'another fragment';
        }
        const prev = contacts.get(pid);
        if (!prev || f * hardness > prev.force * prev.hardness) contacts.set(pid, { hardness, label, env: other ?? null, force: f });
      }
    });

    const fractureQueue: { p: Piece; dv: Vector3; eff: number; label: string }[] = [];
    const g = new Vector3(0, -GRAVITY * DT, 0);
    for (const p of this.pieces.values()) {
      const v = p.body.linvel();
      const vb = before.get(p.id);
      if (!vb) continue;
      if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z) || Math.hypot(v.x, v.y, v.z) > 90) {
        this.unstable = true;
        continue;
      }
      const stepDv = new Vector3(v.x - vb.x, v.y - vb.y, v.z - vb.z).sub(g);
      p.impactAcc.multiplyScalar(0.45).add(stepDv);
      const c = contacts.get(p.id);
      if (!c) continue;
      p.lastContactStep = this.step;
      const dv = p.impactAcc.clone();
      const impact = dv.length();
      const eff = impact * c.hardness;
      const t = p.body.translation();
      if (c.env?.saturated && c.env.objectId && !this.slumped.has(c.env.objectId) && impact > 0.4) this.slump(c.env.objectId, [t.x, t.y, t.z]);
      if (p.kind === 'stone' && c.hardness >= 1.3 && p.wet) p.grinding = 12;
      if (p.kind === 'stone' && impact > 1.4 && this.step - p.lastImpactStep > 6) {
        p.lastImpactStep = this.step;
        this.emit({
          step: this.step,
          type: 'impact',
          pos: [t.x, t.y, t.z],
          intensity: Math.min(1, (eff / 9) * Math.sqrt(Math.max(0.05, p.size) / this.level.boulder.radius) * 1.6),
          material: c.env?.kind === 'object' ? c.env.material.kind : 'terrain',
          label: c.label,
        });
      }
      if (this.debugImpacts && eff > 3) this.debugImpacts.push(`${(this.step * DT).toFixed(1)}s ${c.label} eff=${eff.toFixed(1)} r=${p.size.toFixed(2)} z=${t.z.toFixed(0)}`);
      if (p.kind !== 'stone' || this.step < p.immuneUntil) continue;
      const strength = this.strength(p);
      if (eff > strength) fractureQueue.push({ p, dv, eff, label: c.label });
    }

    fractureQueue.sort((a, b) => b.eff - a.eff);
    for (const f of fractureQueue.slice(0, 2)) this.fracture(f.p, f.dv, f.eff, f.label);

    this.updateLeader();
    this.checkBounds();
    if (this.step % 30 === 0) this.cull();
    if (this.step % RECORD_EVERY === 0) this.record();
    this.checkEnd();
  }

  /** Granite gets a little stronger as it gets smaller. */
  strength(p: Piece): number {
    return 5.6 * Math.pow(Math.max(0.0005, p.size) / this.level.boulder.radius, -0.2);
  }

  private baseAngularDamping(kind: PieceKind, radius: number): number {
    if (kind === 'loose') return 0.5;
    return 0.1 + 0.4 * Math.pow(Math.min(1, radius / this.level.boulder.radius), 1.5);
  }

  private stoneCount(): number {
    let n = 0;
    for (const p of this.pieces.values()) if (p.kind === 'stone') n++;
    return n;
  }

  private registerSmash(p: Piece, pos: [number, number, number], label: string, kind: 'break' | 'crack') {
    this.smashes++;
    this.combo = this.step - this.lastSmashStep < COMBO_STEPS ? this.combo + 1 : 1;
    this.lastSmashStep = this.step;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    // smaller stone = harder to break = worth more; combos multiply
    const st = stageOf(p.size);
    const pts = (kind === 'break' ? 300 : 450) * (1 + st * 0.6) * Math.min(8, this.combo);
    this.smashPoints += pts;
    this.award(pts, kind === 'break' ? `SMASH! ${label}` : `CRACK! ${label}`, pos, this.combo);
  }

  private fracture(p: Piece, dv: Vector3, eff: number, label: string) {
    if (!this.pieces.has(p.id)) return;
    const t = p.body.translation();
    const pos: [number, number, number] = [t.x, t.y, t.z];
    const excess = eff / this.strength(p);
    const rng = mulberry32(hashInts(p.id, this.step, this.level.boulder.seed));
    // Below physics scale (or if the world is full), stone shrinks in place: chips and cracks.
    const room = MAX_STONES - this.stoneCount() + 1;
    if (p.shape.radius < MIN_PHYSICAL_RADIUS * 2.1 || room < 2 || p.size < p.shape.radius * 0.98) {
      const before = p.size;
      p.size *= Math.max(0.28, 0.72 - (excess - 1) * 0.12 - rng() * 0.08);
      p.immuneUntil = this.step + 8;
      this.fractures.push({ time: this.step * DT, pos, against: label, pieces: 1, impact: eff, generation: p.generation });
      this.emit({ step: this.step, type: 'crack', pos, intensity: Math.min(1, excess * 0.4), label, parent: p.id, pieces: [p.id] });
      if (p.id === this.leaderId) this.registerSmash({ ...p, size: before }, pos, label, 'crack');
      this.checkStage();
      return;
    }
    let count = Math.round(2 + (excess - 1) * 4 + rng() * 1.5);
    count = Math.min(count, 6, room);
    if (count < 2) return;
    const r = p.body.rotation();
    const q = new Quaternion(r.x, r.y, r.z, r.w);
    const impactLocal = dv.clone().normalize().negate().applyQuaternion(q.clone().invert());
    const minVol = (4 / 3) * Math.PI * MIN_PHYSICAL_RADIUS ** 3;
    const res = fracturePiece(p.shape, [impactLocal.x, impactLocal.y, impactLocal.z], count, rng() * 1e9, minVol);
    if (res.cells.length < 2) {
      // could only chip it: shrink in place instead
      p.size *= 0.8;
      p.immuneUntil = this.step + 8;
      this.emit({ step: this.step, type: 'chip', pos, intensity: 0.6, label });
      return;
    }
    const lv = p.body.linvel();
    const av = p.body.angvel();
    const w = new Vector3(av.x, av.y, av.z);
    const base = new Vector3(lv.x, lv.y, lv.z);
    const wasLeader = p.id === this.leaderId;
    const parentSize = p.size;
    this.despawn(p, 'fractured');
    const childIds: number[] = [];
    // arcade: breaks throw pieces apart hard
    const spread = Math.min(6, 1.4 + (excess - 1) * 2.6);
    let best: Piece | null = null;
    let bestKey = -Infinity;
    for (const cell of res.cells) {
      const off = new Vector3(...cell.offset).applyQuaternion(q);
      const cpos = off.clone().add(new Vector3(t.x, t.y, t.z));
      const vel = base.clone().add(w.clone().cross(off));
      if (off.lengthSq() > 1e-6) vel.add(off.clone().normalize().multiplyScalar(spread * (0.6 + rng() * 0.7)));
      vel.y += spread * 0.25;
      const ch = this.spawn(
        'stone',
        cell.shape,
        [cpos.x, cpos.y, cpos.z],
        [q.x, q.y, q.z, q.w],
        [vel.x, vel.y, vel.z],
        [w.x + (rng() - 0.5) * 4, w.y + (rng() - 0.5) * 4, w.z + (rng() - 0.5) * 4],
        p.generation + 1,
        p.id,
      );
      // keep any earlier wear proportionally
      ch.size = cell.shape.radius * Math.min(1, parentSize / p.shape.radius);
      childIds.push(ch.id);
      const key = cpos.z + vel.z * 0.8;
      if (key > bestKey) {
        bestKey = key;
        best = ch;
      }
    }
    this.fractures.push({ time: this.step * DT, pos, against: label, pieces: res.cells.length, impact: eff, generation: p.generation });
    this.emit({
      step: this.step,
      type: 'fracture',
      pos,
      intensity: Math.min(1, (excess - 0.6) * 0.6 + p.shape.radius / 2.5),
      label,
      pieces: childIds,
      parent: p.id,
    });
    if (wasLeader && best) {
      this.leaderId = best.id;
      this.registerSmash({ ...p, size: parentSize }, pos, label, 'break');
      this.checkStage();
    } else {
      // breaking any piece still counts, at a discount
      this.smashPoints += 80;
      this.award(80, 'Shatter', pos);
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
    this.emit({ step: this.step, type: 'slump', pos, intensity: 0.8, objectId, label: 'the soaked bank' });
  }

  private applyWater(p: Piece) {
    p.body.resetForces(false);
    const t = p.body.translation();
    const v = p.body.linvel();
    const r = p.shape.radius;
    const vol = (4 / 3) * Math.PI * r * r * r;
    const mass = p.body.mass();
    let wet = false;
    let submerged = false;
    let rel = 0;
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
      submerged = true;
      const vfx = hit.tx * w.spec.flowSpeed,
        vfz = hit.tz * w.spec.flowSpeed;
      const k = 1.6 * frac * mass;
      p.body.addForce({ x: k * (vfx - v.x), y: frac * vol * GRAVITY - 0.9 * frac * mass * v.y, z: k * (vfz - v.z) }, true);
      rel = Math.max(rel, Math.hypot(v.x - vfx, v.z - vfz) + w.spec.flowSpeed * 0.35);
      break;
    }
    // the sea: buoyancy, and waves that wash stone back up the beach
    const sea = this.level.sea;
    if (!wet && sea && t.z > sea.shoreZ - 12 && t.y - r < sea.level) {
      const frac = Math.max(0, Math.min(1, (sea.level - (t.y - r)) / (2 * r)));
      if (frac > 0) {
        wet = true;
        submerged = true;
        const surge = Math.sin(this.step * DT * 0.9 + t.z * 0.15) * 2.4 - 1.2;
        const k = 1.1 * frac * mass;
        p.body.addForce({ x: -k * v.x * 0.6, y: frac * vol * GRAVITY - 0.9 * frac * mass * v.y, z: k * (surge - v.z) }, true);
        rel = Math.max(rel, 1.5 + Math.abs(surge));
      }
    }
    if (wet !== p.wet) {
      p.wet = wet;
      p.collider.setFriction(wet ? 0.18 : STONE_FRICTION);
    }
    if (submerged !== p.submerged) {
      p.submerged = submerged;
      p.body.setAngularDamping(submerged ? 1.0 : this.baseAngularDamping(p.kind, p.shape.radius));
      if (submerged && p.kind === 'stone') {
        const sp = Math.hypot(v.x, v.y, v.z);
        if (sp > 1) this.emit({ step: this.step, type: 'splash', pos: [t.x, t.y, t.z], intensity: Math.min(1, (sp / 10) * (r / 1.2) + 0.15) });
      }
    }
    if (wet && p.kind === 'stone') {
      if (p.id === this.leaderId) this.waterSteps++;
      // abrasion: water grinds stone down, much faster against hard rock
      const grind = p.grinding > 0 ? 7 : 1;
      if (p.grinding > 0) p.grinding--;
      const rate = 0.0085 * rel * grind;
      if (p.size < 0.6) {
        p.size *= Math.exp(-rate * DT);
        if (p.id === this.leaderId) this.checkStage();
      }
    }
  }

  private checkStage() {
    const p = this.leader;
    if (!p) return;
    const st = stageOf(p.size);
    if (st > this.bestStage) {
      this.bestStage = st;
      const pts = 1500 * st;
      this.bonusPoints += pts;
      this.breakdown.push({ label: `${STAGES[st].name}!`, points: pts });
      const t = p.body.translation();
      this.emit({ step: this.step, type: 'stage', pos: [t.x, t.y, t.z], intensity: st, label: STAGES[st].name, points: pts });
    }
  }

  private updateLeader() {
    let cur = this.leader;
    if (this.step % 10 === 0 || !cur) {
      let best: Piece | undefined;
      let bestKey = -Infinity;
      for (const p of this.pieces.values()) {
        if (p.kind !== 'stone') continue;
        const t = p.body.translation();
        const v = p.body.linvel();
        const moving = Math.hypot(v.x, v.y, v.z) > 0.5;
        const key = t.z + (moving ? 0 : -35);
        if (key > bestKey) {
          bestKey = key;
          best = p;
        }
      }
      if (best && cur && best.id !== cur.id) {
        const ct = cur.body.translation();
        const cv = cur.body.linvel();
        const curKey = ct.z + (Math.hypot(cv.x, cv.y, cv.z) > 0.5 ? 0 : -35);
        if (bestKey > curKey + 5) cur = best;
      } else if (!cur) cur = best;
      if (cur) this.leaderId = cur.id;
    }
    if (!cur) return;
    const t = cur.body.translation();
    const v = cur.body.linvel();
    if (t.z > this.maxZ) this.maxZ = Math.min(t.z, this.finishZ + 60);
    if (this.step % 6 === 0) this.trajectory.push([t.x, t.y, t.z]);
    // air time: no contact and well above the ground
    const ground = this.data.heightAt(t.x, t.z);
    const airborne = this.step - cur.lastContactStep > 4 && t.y - ground > cur.shape.radius + 0.8 && !cur.wet;
    if (airborne) this.airSteps++;
    else if (this.airSteps > 0) {
      const air = this.airSteps * DT;
      if (air > 0.7) {
        this.totalAir += air;
        const pts = Math.round(air * 400);
        this.bonusPoints += pts;
        this.award(pts, `BIG AIR ${air.toFixed(1)}s`, [t.x, t.y, t.z]);
        this.emit({ step: this.step, type: 'air', pos: [t.x, t.y, t.z], intensity: Math.min(1, air / 3) });
      }
      this.airSteps = 0;
    }
    const sp = Math.hypot(v.x, v.y, v.z);
    this.leaderStill = sp < 0.35 ? this.leaderStill + 1 : 0;
    const beach = this.level.beach;
    if (beach && t.z >= beach.z[0]) this.landedSteps++;
  }

  /** Stone left far behind no longer matters; free it. */
  private cull() {
    const lead = this.leader;
    if (!lead) return;
    const lz = lead.body.translation().z;
    for (const p of [...this.pieces.values()]) {
      if (p.id === lead.id) continue;
      const t = p.body.translation();
      if (t.z < lz - 70) this.despawn(p, 'culled');
    }
  }

  private checkBounds() {
    const b = this.level.terrain.bounds;
    for (const p of [...this.pieces.values()]) {
      const t = p.body.translation();
      const ground = this.data.heightAt(t.x, t.z);
      const outside = t.x < b.x[0] + 1 || t.x > b.x[1] - 1 || t.z < b.z[0] + 1 || t.z > b.z[1] - 1;
      if (t.y < ground - 4 || outside || !Number.isFinite(t.y)) this.despawn(p, 'lost');
    }
  }

  private writeFrame(track: Track, p: Piece) {
    const t = p.body.translation();
    const r = p.body.rotation();
    const scale = Math.max(0.002, p.size / p.shape.radius);
    // a virtually-small stone sits at the bottom of its (larger) physics body
    const drop = (1 - Math.min(1, scale)) * p.shape.radius * 0.85;
    track.data.push(t.x, t.y - drop, t.z, r.x, r.y, r.z, r.w, scale);
  }

  /** Render pose for a live piece (matches recorded frames). */
  pose(p: Piece): { pos: [number, number, number]; quat: [number, number, number, number]; scale: number } {
    const t = p.body.translation();
    const r = p.body.rotation();
    const scale = Math.max(0.002, p.size / p.shape.radius);
    const drop = (1 - Math.min(1, scale)) * p.shape.radius * 0.85;
    return { pos: [t.x, t.y - drop, t.z], quat: [r.x, r.y, r.z, r.w], scale };
  }

  private record() {
    for (const p of this.pieces.values()) {
      const track = this.tracks.get(p.id)!;
      const expected = (this.recording.frames - track.startFrame) * 8;
      while (track.data.length < expected && track.data.length >= 8) track.data.push(...track.data.slice(track.data.length - 8));
      if (track.data.length === expected) this.writeFrame(track, p);
    }
    this.recording.leader.push(this.leaderId);
    this.recording.frames++;
  }

  private checkEnd() {
    const time = this.step * DT;
    const lead = this.leader;
    if (this.unstable) return this.finish('unstable');
    if (!lead || this.stoneCount() === 0) return this.finish('lost');
    const beach = this.level.beach;
    const lz = lead.body.translation().z;
    if (beach && lz >= beach.z[0] && (this.leaderStill > 50 || this.landedSteps > 60 * 6)) return this.finish('landed');
    // stuck: the leader has stopped and nothing else is moving near it
    if (this.leaderStill > 150 && time > 3) {
      let moving = false;
      for (const p of this.pieces.values()) {
        if (p.kind !== 'stone' || p.id === lead.id) continue;
        const v = p.body.linvel();
        if (Math.hypot(v.x, v.y, v.z) > 0.6 && p.body.translation().z > lz - 25) moving = true;
      }
      if (!moving) return this.finish('stopped');
    }
    if (time > MAX_TIME) this.finish('time');
  }

  runToEnd(maxSteps = Math.ceil(MAX_TIME / DT) + 10): SimResult {
    while (!this.done && this.step < maxSteps) this.stepOnce();
    if (!this.done) this.finish('time');
    return this.result!;
  }

  private placeName(z: number, x: number): string {
    for (const r of this.level.regions) if (x >= r.x[0] && x <= r.x[1] && z >= r.z[0] && z <= r.z[1]) return r.name;
    return 'the mountainside';
  }

  finish(reason: string) {
    if (this.done) return;
    this.done = true;
    this.record();
    const lead = this.leader;
    const lt = lead?.body.translation();
    const size = lead?.size ?? 0;
    const stage = stageOf(size);
    const landed = reason === 'landed';
    const sand = landed && stage === STAGES.length - 1;
    const distance = Math.max(0, this.maxZ - this.startZ);
    const distPts = this.distancePoints();
    const breakdown = [
      { label: `Distance ${Math.round(distance)} m`, points: Math.round(distPts) },
      { label: `Smashes ×${this.smashes}`, points: Math.round(this.smashPoints) },
      ...this.breakdown,
    ];
    let bonus = this.bonusPoints;
    if (this.totalAir > 0) breakdown.push({ label: `Air ${this.totalAir.toFixed(1)}s`, points: Math.round(this.totalAir * 400) });
    if (landed) {
      bonus += 6000;
      breakdown.push({ label: 'Reached the beach', points: 6000 });
    }
    if (sand) {
      bonus += 25000;
      breakdown.push({ label: 'PERFECT EROSION — sand on the beach', points: 25000 });
    }
    const raw = distPts + this.smashPoints + bonus;
    const mult = STAGES[stage].mult;
    const score = Math.round(raw * mult);
    breakdown.push({ label: `${STAGES[stage].name} size multiplier`, points: score - Math.round(raw) });
    if (lt) this.trajectory.push([lt.x, lt.y, lt.z]);
    const span = this.finishZ - this.startZ;
    this.result = {
      score,
      distance,
      progress: Math.min(1, distance / span),
      size,
      stage,
      bestStage: this.bestStage,
      landed,
      sand,
      smashes: this.smashes,
      maxCombo: this.maxCombo,
      airTime: this.totalAir,
      waterTime: this.waterSteps * DT,
      fractures: this.fractures,
      destination: landed ? 'the beach' : lt ? this.placeName(lt.z, lt.x) : 'nowhere',
      duration: this.step * DT,
      stoneCount: this.stoneCount(),
      interventions: countInterventions(this.level, this.plan),
      nudgesUsed: this.nudgesUsed,
      unstable: this.unstable,
      trajectory: this.trajectory,
      reason,
      breakdown,
      grade: gradeFor(score),
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

const COMBO_STEPS = Math.round(2.5 / DT);

export function gradeFor(score: number): string {
  if (score >= 400000) return 'S';
  if (score >= 150000) return 'A';
  if (score >= 60000) return 'B';
  if (score >= 20000) return 'C';
  return 'D';
}

const boulderCache = new Map<string, PieceShape>();
/** The boulder perched on the summit before it breaks away. */
export function restingBoulder(level: LevelDef): { shape: PieceShape; pos: [number, number, number] } {
  const b = level.boulder;
  let shape = boulderCache.get(level.id);
  if (!shape) {
    shape = generateBoulder(b.radius, b.seed);
    boulderCache.set(level.id, shape);
  }
  const data = loadLevelData(level);
  const y = data.heightAt(b.position[0], b.position[1]) + b.radius * 0.66;
  return { shape, pos: [b.position[0], y, b.position[1]] };
}
