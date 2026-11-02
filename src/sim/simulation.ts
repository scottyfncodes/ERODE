import type RAPIER_T from '@dimforge/rapier3d-deterministic-compat';
import { Quaternion, Vector3 } from 'three';
import type { LevelDef, Plan } from '../levels/types';
import { fracturePiece, generateBoulder, generateStone, type PieceShape } from './fracture';
import { bedAt, loadLevelData, type LevelData, type WaterBody } from './levelData';
import { hashInts, mulberry32 } from './noise';
import { resolveObjects, type ColliderPart, type Material, type ResolvedObject } from './objects';
import { activeWater, countInterventions } from './plan';
import { makePolyline, pathDistance, type Polyline, type PathHit } from './geom';
import { SURFACE_HARDNESS } from './terrain';

type R = typeof RAPIER_T;

export const DT = 1 / 60;
export const RECORD_EVERY = 3; // 20 Hz
/** floats per recorded frame: px py pz qx qy qz qw scale smooth */
export const FRAME = 9;
export const MAX_STONES = 34;
export const DENSITY = 2.7;
const GRAVITY = 9.81;
/** below this, the collider stops shrinking; the stone keeps shrinking visually */
export const MIN_PHYSICAL_RADIUS = 0.16;
const MAX_TIME = 240;
const STONE_FRICTION = 0.26;

/** Boulder → Fragment → Rock → Pebble → Gravel → Sand (radius thresholds, m). */
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

export type PieceKind = 'stone' | 'loose' | 'chip';

export interface Piece {
  id: number;
  kind: PieceKind;
  shape: PieceShape;
  body: RAPIER_T.RigidBody;
  collider: RAPIER_T.Collider;
  /** true size (radius, m) */
  size: number;
  /** collider scale relative to shape */
  physScale: number;
  /** 0 = fresh jagged granite, 1 = water-polished pebble */
  smooth: number;
  generation: number;
  parent: number | null;
  bornStep: number;
  immuneUntil: number;
  wet: boolean;
  submerged: boolean;
  lastImpactStep: number;
  lastContactStep: number;
  contactSurface: string | null;
  impactAcc: Vector3;
  grinding: number;
}

export type SimEventType = 'fracture' | 'chip' | 'crack' | 'impact' | 'splash' | 'slump' | 'score' | 'stage' | 'air' | 'breakoff' | 'nudge';

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
  data: number[];
  endFrame: number | null;
  fate: 'fractured' | 'carried' | 'lost' | 'culled' | null;
}

export interface Recording {
  frames: number;
  tracks: Track[];
  events: SimEvent[];
  objectChanges: { frame: number; objectId: string; change: 'slumped' }[];
  /** hero id per frame, for the replay camera */
  leader: number[];
}

export interface SimResult {
  score: number;
  distance: number;
  progress: number;
  size: number;
  stage: number;
  bestStage: number;
  landed: boolean;
  sand: boolean;
  smashes: number;
  chips: number;
  maxCombo: number;
  airTime: number;
  waterTime: number;
  topSpeed: number;
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

const COMBO_STEPS = Math.round(2.5 / DT);

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
  /** live steering input, -1 (left) … 1 (right), screen-relative for a camera looking down the course */
  steer = 0;
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
  private heroId = 1;
  private startZ: number;
  private finishZ: number;
  private maxZ: number;
  private heroStill = 0;
  private lastHero: { x: number; y: number; z: number; size: number } | null = null;
  private beachSteps = 0;
  private course: Polyline | null;
  private courseHit: PathHit = { d: 0, t: 0, s: 0, px: 0, pz: 0, tx: 0, tz: 1 };
  private smashPoints = 0;
  private bonusPoints = 0;
  private smashes = 0;
  private chips = 0;
  private combo = 0;
  private maxCombo = 0;
  private lastSmashStep = -1000;
  private bestStage = 0;
  private airSteps = 0;
  private totalAir = 0;
  private waterSteps = 0;
  private topSpeed = 0;
  private breakdown: { label: string; points: number }[] = [];
  nudgesLeft: number;
  private nudgesUsed = 0;
  debugImpacts: string[] | null = null;

  constructor(R: R, level: LevelDef, plan: Plan) {
    this.R = R;
    this.level = level;
    this.plan = plan;
    this.data = loadLevelData(level);
    const waterOn = activeWater(level, plan);
    this.waters = this.data.water.filter((w) => waterOn.has(w.spec.id));
    this.nudgesLeft = level.nudges ?? 0;
    this.course = level.terrain.course ? makePolyline(level.terrain.course) : null;
    const world = new R.World({ x: 0, y: -GRAVITY, z: 0 });
    world.timestep = DT;
    world.numSolverIterations = 5;
    this.world = world;
    this.queue = new R.EventQueue(true);

    const t = R.ColliderDesc.trimesh(this.data.mesh.vertices, this.data.mesh.indices).setFriction(0.74).setRestitution(0.1);
    const tc = world.createCollider(t);
    this.env.set(tc.handle, { kind: 'terrain', material: { hardness: 0.5, friction: 0.8, restitution: 0.08, label: 'the ground', kind: 'granite' } });

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
    this.heroId = boulder.id;
    this.startZ = pose.pos[2];
    this.maxZ = this.startZ;
    this.finishZ = level.beach?.z[0] ?? level.terrain.bounds.z[1];
    this.trajectory.push([...pose.pos]);
    this.record();
  }

  get fractureCount(): number {
    return this.fractures.length;
  }
  /** the largest piece of the original boulder */
  get leader(): Piece | undefined {
    return this.pieces.get(this.heroId);
  }
  get hero(): Piece | undefined {
    return this.leader;
  }
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

  /** Collider for a stone at a given scale: a rounded hull, rounder as it smooths. */
  private stoneCollider(p: { shape: PieceShape; kind: PieceKind; generation: number; smooth: number }, scale: number, material?: Material): RAPIER_T.ColliderDesc {
    const R = this.R;
    const shape = p.shape;
    const r = shape.radius * scale;
    const roundness = p.kind === 'loose' ? 0.03 / r : (p.generation === 0 ? 0.05 : 0.12) + p.smooth * 0.3;
    const border = Math.min(r * 0.45, Math.max(0.01, r * roundness));
    const pts = new Float32Array(shape.points.length);
    for (let i = 0; i < shape.points.length; i += 3) {
      const x = shape.points[i] * scale,
        y = shape.points[i + 1] * scale,
        z = shape.points[i + 2] * scale;
      const l = Math.hypot(x, y, z) || 1;
      const k = Math.max(0.3, (l - border) / l);
      pts[i] = x * k;
      pts[i + 1] = y * k;
      pts[i + 2] = z * k;
    }
    const vol = shape.volume * scale ** 3;
    return (R.ColliderDesc.roundConvexHull(pts, border) ?? R.ColliderDesc.convexHull(pts))!
      .setDensity(DENSITY)
      .setFriction(material?.friction ?? STONE_FRICTION)
      .setFrictionCombineRule(R.CoefficientCombineRule.Min)
      .setRestitution(material?.restitution ?? 0.18)
      .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(vol * DENSITY * GRAVITY * 0.9);
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
      .setLinearDamping(0.02 + 0.08 * Math.min(1, shape.radius / this.level.boulder.radius))
      .setAngularDamping(this.baseAngularDamping(kind, shape.radius))
      .setCcdEnabled(kind !== 'chip');
    const body = this.world.createRigidBody(bd);
    const proto = { shape, kind, generation, smooth: 0 };
    const collider = this.world.createCollider(this.stoneCollider(proto, 1, material), body);
    const id = this.nextId++;
    const p: Piece = {
      id,
      kind,
      shape,
      body,
      collider,
      size: shape.radius,
      physScale: 1,
      smooth: 0,
      generation,
      parent,
      bornStep: this.step,
      immuneUntil: this.step + 10,
      wet: false,
      submerged: false,
      lastImpactStep: -100,
      lastContactStep: this.step,
      contactSurface: null,
      impactAcc: new Vector3(),
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

  /** Physically shrink a stone's collider to match its worn size. */
  private rescale(p: Piece) {
    const want = Math.max(MIN_PHYSICAL_RADIUS / p.shape.radius, p.size / p.shape.radius);
    if (want > p.physScale * 0.9) return;
    this.colliderPiece.delete(p.collider.handle);
    this.world.removeCollider(p.collider, false);
    p.physScale = want;
    p.collider = this.world.createCollider(this.stoneCollider(p, want), p.body);
    p.collider.setFriction(p.wet ? 0.18 : STONE_FRICTION);
    this.colliderPiece.set(p.collider.handle, p.id);
    p.body.setLinearDamping(0.02 + 0.08 * Math.min(1, p.size / this.level.boulder.radius));
    p.body.setAngularDamping(this.baseAngularDamping(p.kind, p.size));
  }

  private despawn(p: Piece, fate: Track['fate']) {
    const t = this.tracks.get(p.id);
    if (t) {
      const expected = (this.recording.frames - t.startFrame) * FRAME;
      if (t.data.length === expected) this.writeFrame(t, p);
      t.endFrame = t.startFrame + t.data.length / FRAME - 1;
      t.fate = fate;
    }
    this.colliderPiece.delete(p.collider.handle);
    this.env.delete(p.collider.handle);
    this.world.removeRigidBody(p.body);
    this.pieces.delete(p.id);
  }

  release() {
    if (this.released) return;
    this.released = true;
    const b = this.pieces.get(this.heroId);
    if (!b) return;
    const push = this.level.boulder.push;
    b.body.setLinvel({ x: push[0], y: push[1], z: push[2] }, true);
    b.body.setAngvel({ x: push[2] / this.level.boulder.radius, y: 0, z: -push[0] / this.level.boulder.radius }, true);
    const t = b.body.translation();
    this.emit({ step: this.step, type: 'breakoff', pos: [t.x, t.y, t.z], intensity: 1, label: 'the summit' });
  }

  /** A one-off sideways shove (kept for keyboard/tests). */
  nudge(dir: number): boolean {
    const p = this.hero;
    if (!p || this.nudgesLeft <= 0 || this.done) return false;
    this.nudgesLeft--;
    this.nudgesUsed++;
    const [rx, rz] = this.rightAt(p);
    const m = p.body.mass();
    p.body.applyImpulse({ x: rx * dir * m * 5.5, y: m * 2.2, z: rz * dir * m * 5.5 }, true);
    const t = p.body.translation();
    this.emit({ step: this.step, type: 'nudge', pos: [t.x, t.y, t.z], intensity: 0.6 });
    return true;
  }

  /** screen-right across the course at a stone's position */
  private rightAt(p: Piece): [number, number] {
    const t = p.body.translation();
    if (!this.course) return [-1, 0];
    pathDistance(this.course, t.x, t.z, this.courseHit);
    return [-this.courseHit.tz, this.courseHit.tx];
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
      p.body.resetForces(false);
      this.applyWater(p);
    }
    this.driveHero();

    this.world.step(this.queue);
    this.step++;

    const contacts = new Map<number, { hardness: number; label: string; env: EnvInfo | null; force: number; surface: string | null }>();
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
        let surface: string | null = null;
        if (other) {
          if (other.kind === 'terrain') {
            const p = this.pieces.get(pid)!;
            const t = p.body.translation();
            const s = this.data.terrain.surface(t.x, t.z);
            surface = s;
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
        if (!prev || f * hardness > prev.force * prev.hardness) contacts.set(pid, { hardness, label, env: other ?? null, force: f, surface });
      }
    });

    const breaks: { p: Piece; dv: Vector3; eff: number; label: string }[] = [];
    const g = new Vector3(0, -GRAVITY * DT, 0);
    for (const p of this.pieces.values()) {
      const v = p.body.linvel();
      const vb = before.get(p.id);
      if (!vb) continue;
      if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z) || Math.hypot(v.x, v.y, v.z) > 95) {
        this.unstable = true;
        continue;
      }
      const stepDv = new Vector3(v.x - vb.x, v.y - vb.y, v.z - vb.z).sub(g);
      p.impactAcc.multiplyScalar(0.45).add(stepDv);
      const c = contacts.get(p.id);
      if (!c) continue;
      p.lastContactStep = this.step;
      p.contactSurface = c.surface;
      const dv = p.impactAcc.clone();
      const impact = dv.length();
      const eff = impact * c.hardness;
      const t = p.body.translation();
      if (c.env?.saturated && c.env.objectId && !this.slumped.has(c.env.objectId) && impact > 0.4) this.slump(c.env.objectId, [t.x, t.y, t.z]);
      if (p.kind === 'stone' && c.hardness >= 1.3 && p.wet) p.grinding = 12;
      if (p.kind !== 'chip' && impact > 1.4 && this.step - p.lastImpactStep > 6) {
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
      if (eff > this.strength(p)) breaks.push({ p, dv, eff, label: c.label });
    }
    breaks.sort((a, b) => b.eff - a.eff);
    for (const b of breaks.slice(0, 2)) this.hit(b.p, b.dv, b.eff, b.label);

    this.wearOnGround();
    this.updateHero();
    this.checkBounds();
    if (this.step % 30 === 0) this.cull();
    if (this.step % RECORD_EVERY === 0) this.record();
    this.checkEnd();
  }

  /** Steering and the pull of the mountain on the hero stone. */
  private driveHero() {
    const p = this.hero;
    if (!p) return;
    const grounded = this.step - p.lastContactStep < 6 || p.wet;
    const [rx, rz] = this.rightAt(p);
    const tx = this.courseHit.tx,
      tz = this.courseHit.tz;
    const m = p.body.mass();
    const v = p.body.linvel();
    const control = grounded ? 1 : 0.35;
    // steer across the course; damp sideways drift a little so it feels responsive
    const side = v.x * rx + v.z * rz;
    const steerAcc = 14 * this.steer * control - side * 0.6 * Math.abs(this.steer) * control;
    // smaller stone runs faster: a growing pull down the course
    const small = 1 - Math.min(1, p.size / this.level.boulder.radius);
    const pull = grounded ? 2.5 + 6 * small : 0;
    const course = this.course ? Math.min(1, Math.max(0, (this.courseHit.d - 6) / 10)) : 0;
    // keep it from climbing the valley walls forever: a gentle nudge back toward the line
    const back = course * 4;
    const toLine = this.course ? Math.sign((this.courseHit.px - p.body.translation().x) * rx + (this.courseHit.pz - p.body.translation().z) * rz) : 0;
    p.body.addForce(
      {
        x: m * (rx * (steerAcc + back * toLine) + tx * pull),
        y: 0,
        z: m * (rz * (steerAcc + back * toLine) + tz * pull),
      },
      true,
    );
  }

  /** Granite gets a little stronger as it gets smaller. */
  strength(p: Piece): number {
    return 5.2 * Math.pow(Math.max(0.0005, p.size) / this.level.boulder.radius, -0.15);
  }

  private baseAngularDamping(kind: PieceKind, radius: number): number {
    if (kind === 'loose') return 0.5;
    return 0.08 + 0.4 * Math.pow(Math.min(1, radius / this.level.boulder.radius), 1.5);
  }

  private stoneCount(): number {
    let n = 0;
    for (const p of this.pieces.values()) if (p.kind !== 'loose') n++;
    return n;
  }

  private registerSmash(size: number, pos: [number, number, number], label: string, kind: 'break' | 'chip') {
    if (kind === 'break') this.smashes++;
    else this.chips++;
    this.combo = this.step - this.lastSmashStep < COMBO_STEPS ? this.combo + 1 : 1;
    this.lastSmashStep = this.step;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const st = stageOf(size);
    const pts = (kind === 'break' ? 600 : 220) * (1 + st * 0.6) * Math.min(10, this.combo);
    this.smashPoints += pts;
    this.award(pts, kind === 'break' ? `SMASH! ${label}` : `CHIP! ${label}`, pos, this.combo);
  }

  /** A hard hit: chips fly off, or — if it's brutal — the stone splits. */
  private hit(p: Piece, dv: Vector3, eff: number, label: string) {
    if (!this.pieces.has(p.id)) return;
    const excess = eff / this.strength(p);
    const isHero = p.id === this.heroId;
    if (excess > 2.1 && p.size > 0.55 && p.size >= p.shape.radius * 0.97 && this.stoneCount() < MAX_STONES - 4) {
      this.split(p, dv, eff, label);
      return;
    }
    // chip: knock pieces off and wear the stone down
    const t = p.body.translation();
    const pos: [number, number, number] = [t.x, t.y, t.z];
    const rng = mulberry32(hashInts(p.id, this.step, 77));
    const before = p.size;
    p.size *= Math.max(0.5, 0.9 - (excess - 1) * 0.12 - rng() * 0.05);
    p.smooth *= 0.75;
    p.immuneUntil = this.step + 9;
    const lost = before - p.size;
    // throw off one or two real chips
    const n = isHero && this.stoneCount() < MAX_STONES ? (excess > 1.5 ? 2 : 1) : 0;
    const out = dv.clone().normalize();
    const v = p.body.linvel();
    for (let i = 0; i < n; i++) {
      const cr = Math.max(0.07, Math.min(0.6, lost * (0.9 + rng() * 0.6)));
      const shape = generateStone(cr, hashInts(p.id, this.step, i), 0.7);
      const side = new Vector3(rng() - 0.5, rng() * 0.6 + 0.2, rng() - 0.5).normalize();
      const dir = out.clone().multiplyScalar(-0.6).add(side).normalize();
      const off = dir.clone().multiplyScalar(p.size * p.physScale > 0 ? p.shape.radius * p.physScale + cr : cr);
      const sp = 3 + (excess - 1) * 4 + rng() * 3;
      this.spawn(
        'chip',
        shape,
        [t.x + off.x, t.y + off.y, t.z + off.z],
        [0, 0, 0, 1],
        [v.x + dir.x * sp, v.y + dir.y * sp + 2, v.z + dir.z * sp],
        [(rng() - 0.5) * 20, (rng() - 0.5) * 20, (rng() - 0.5) * 20],
        p.generation + 1,
        p.id,
      );
    }
    this.fractures.push({ time: this.step * DT, pos, against: label, pieces: n, impact: eff, generation: p.generation });
    this.emit({ step: this.step, type: 'chip', pos, intensity: Math.min(1, 0.3 + excess * 0.25 + Math.sqrt(p.size) * 0.2), label, parent: p.id });
    if (isHero) {
      this.registerSmash(before, pos, label, 'chip');
      this.checkStage();
    }
    this.rescale(p);
  }

  private split(p: Piece, dv: Vector3, eff: number, label: string) {
    const t = p.body.translation();
    const pos: [number, number, number] = [t.x, t.y, t.z];
    const excess = eff / this.strength(p);
    const rng = mulberry32(hashInts(p.id, this.step, this.level.boulder.seed));
    const room = MAX_STONES - this.stoneCount() + 1;
    const count = Math.min(Math.round(2 + (excess - 2) * 1.5 + rng()), 5, room);
    if (count < 2) return;
    const r = p.body.rotation();
    const q = new Quaternion(r.x, r.y, r.z, r.w);
    const impactLocal = dv.clone().normalize().negate().applyQuaternion(q.clone().invert());
    const minVol = (4 / 3) * Math.PI * 0.12 ** 3;
    const res = fracturePiece(p.shape, [impactLocal.x, impactLocal.y, impactLocal.z], count, rng() * 1e9, minVol);
    if (res.cells.length < 2) return;
    const lv = p.body.linvel();
    const av = p.body.angvel();
    const w = new Vector3(av.x, av.y, av.z);
    const base = new Vector3(lv.x, lv.y, lv.z);
    const wasHero = p.id === this.heroId;
    const parentSize = p.size;
    this.despawn(p, 'fractured');
    const ids: number[] = [];
    const spread = Math.min(7, 2 + (excess - 2) * 2.5);
    let biggest: Piece | null = null;
    for (const cell of res.cells) {
      const off = new Vector3(...cell.offset).applyQuaternion(q);
      const cpos = off.clone().add(new Vector3(t.x, t.y, t.z));
      const vel = base.clone().add(w.clone().cross(off));
      if (off.lengthSq() > 1e-6) vel.add(off.clone().normalize().multiplyScalar(spread * (0.6 + rng() * 0.7)));
      vel.y += spread * 0.25;
      const ch = this.spawn(
        cell.shape.radius < 0.3 ? 'chip' : 'stone',
        cell.shape,
        [cpos.x, cpos.y, cpos.z],
        [q.x, q.y, q.z, q.w],
        [vel.x, vel.y, vel.z],
        [w.x + (rng() - 0.5) * 4, w.y + (rng() - 0.5) * 4, w.z + (rng() - 0.5) * 4],
        p.generation + 1,
        p.id,
      );
      ids.push(ch.id);
      if (ch.kind === 'stone' && (!biggest || ch.size > biggest.size)) biggest = ch;
    }
    this.fractures.push({ time: this.step * DT, pos, against: label, pieces: res.cells.length, impact: eff, generation: p.generation });
    this.emit({ step: this.step, type: 'fracture', pos, intensity: Math.min(1, (excess - 1) * 0.4 + parentSize / 2.5), label, pieces: ids, parent: p.id });
    if (wasHero && biggest) {
      // the camera stays with the largest piece of the original boulder
      this.heroId = biggest.id;
      this.registerSmash(parentSize, pos, label, 'break');
      this.checkStage();
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

  /** Abrasion: shrink and polish. Water is strongest, sand is gentle, rolling rock barely. */
  private wear(p: Piece, rate: number) {
    if (p.kind !== 'stone' || rate <= 0) return;
    const k = Math.exp(-rate * DT);
    p.size = Math.max(0.0004, p.size * k);
    p.smooth = Math.min(1, p.smooth + rate * DT * 6);
    if (p.id === this.heroId) this.checkStage();
    if (this.step % 20 === p.id % 20) this.rescale(p);
  }

  private wearOnGround() {
    for (const p of this.pieces.values()) {
      if (p.kind !== 'stone' || p.wet || this.step - p.lastContactStep > 3) continue;
      const v = p.body.linvel();
      const sp = Math.hypot(v.x, v.y, v.z);
      if (sp < 0.5) continue;
      const sand = p.contactSurface === 'sand';
      this.wear(p, (sand ? 0.009 : 0.0006) * sp);
    }
  }

  private applyWater(p: Piece) {
    const t = p.body.translation();
    const v = p.body.linvel();
    const r = p.shape.radius * p.physScale;
    const vol = (4 / 3) * Math.PI * r * r * r;
    const mass = p.body.mass();
    let wet = false;
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
      const vfx = hit.tx * w.spec.flowSpeed,
        vfz = hit.tz * w.spec.flowSpeed;
      const k = 1.6 * frac * mass;
      p.body.addForce({ x: k * (vfx - v.x), y: frac * vol * GRAVITY - 0.9 * frac * mass * v.y, z: k * (vfz - v.z) }, true);
      rel = Math.max(rel, Math.hypot(v.x - vfx, v.z - vfz) + w.spec.flowSpeed * 0.35);
      break;
    }
    const sea = this.level.sea;
    if (!wet && sea && t.z > sea.shoreZ - 12 && t.y - r < sea.level) {
      const frac = Math.max(0, Math.min(1, (sea.level - (t.y - r)) / (2 * r)));
      if (frac > 0) {
        wet = true;
        const surge = Math.sin(this.step * DT * 0.9 + t.z * 0.15) * 2.4 - 1.2;
        const k = 1.1 * frac * mass;
        p.body.addForce({ x: -k * v.x * 0.6, y: frac * vol * GRAVITY - 0.9 * frac * mass * v.y, z: k * (surge - v.z) }, true);
        rel = Math.max(rel, 1.5 + Math.abs(surge));
      }
    }
    if (wet !== p.wet) {
      p.wet = wet;
      p.collider.setFriction(wet ? 0.18 : STONE_FRICTION);
      p.body.setAngularDamping(wet ? 1.0 : this.baseAngularDamping(p.kind, p.size));
      if (wet && p.kind === 'stone') {
        const sp = Math.hypot(v.x, v.y, v.z);
        if (sp > 1) this.emit({ step: this.step, type: 'splash', pos: [t.x, t.y, t.z], intensity: Math.min(1, (sp / 10) * (r / 1.2) + 0.15) });
      }
    }
    p.submerged = wet;
    if (wet && p.kind === 'stone') {
      if (p.id === this.heroId) this.waterSteps++;
      const grind = p.grinding > 0 ? 7 : 1;
      if (p.grinding > 0) p.grinding--;
      // water wears big stone too (slowly), small stone fast
      const sizeFactor = p.size < 0.6 ? 1 : 0.35;
      this.wear(p, 0.0085 * rel * grind * sizeFactor);
    }
  }

  private checkStage() {
    const p = this.hero;
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

  private updateHero() {
    let hero = this.hero;
    if (!hero) {
      // the hero left the world: follow the largest stone that remains
      let best: Piece | undefined;
      for (const p of this.pieces.values()) if (p.kind === 'stone' && (!best || p.size > best.size)) best = p;
      if (!best) return;
      this.heroId = best.id;
      hero = best;
    }
    // always the largest piece of the original boulder that is still in the race
    if (this.step % 10 === 0) {
      const hz = hero.body.translation().z;
      for (const p of this.pieces.values()) {
        if (p.kind !== 'stone' || p.id === hero.id) continue;
        if (p.size > hero.size * 1.08 && p.body.translation().z > hz - 15) {
          hero = p;
          this.heroId = p.id;
        }
      }
    }
    const t = hero.body.translation();
    this.lastHero = { x: t.x, y: t.y, z: t.z, size: hero.size };
    const v = hero.body.linvel();
    const sp = Math.hypot(v.x, v.y, v.z);
    this.topSpeed = Math.max(this.topSpeed, sp);
    if (t.z > this.maxZ) this.maxZ = Math.min(t.z, this.finishZ + 60);
    if (this.step % 6 === 0) this.trajectory.push([t.x, t.y, t.z]);
    const ground = this.data.heightAt(t.x, t.z);
    const airborne = this.step - hero.lastContactStep > 4 && t.y - ground > hero.shape.radius * hero.physScale + 0.8 && !hero.wet;
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
    this.heroStill = sp < 0.4 ? this.heroStill + 1 : 0;
    const beach = this.level.beach;
    if (beach && t.z >= beach.z[0]) this.beachSteps++;
  }

  /** Chips and stone far behind no longer matter. */
  private cull() {
    const hero = this.hero;
    if (!hero) return;
    const hz = hero.body.translation().z;
    for (const p of [...this.pieces.values()]) {
      if (p.id === hero.id) continue;
      const t = p.body.translation();
      const old = p.kind === 'chip' && this.step - p.bornStep > 60 * 6;
      if (t.z < hz - 60 || old) this.despawn(p, 'culled');
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

  private framePose(p: Piece): number[] {
    const t = p.body.translation();
    const r = p.body.rotation();
    const scale = Math.max(0.0015, p.size / p.shape.radius);
    // a stone smaller than its collider sits at the bottom of it
    const drop = Math.max(0, p.physScale - scale) * p.shape.radius * 0.85;
    return [t.x, t.y - drop, t.z, r.x, r.y, r.z, r.w, scale, p.smooth];
  }

  private writeFrame(track: Track, p: Piece) {
    track.data.push(...this.framePose(p));
  }

  pose(p: Piece): { pos: [number, number, number]; quat: [number, number, number, number]; scale: number; smooth: number } {
    const f = this.framePose(p);
    return { pos: [f[0], f[1], f[2]], quat: [f[3], f[4], f[5], f[6]], scale: f[7], smooth: f[8] };
  }

  private record() {
    for (const p of this.pieces.values()) {
      const track = this.tracks.get(p.id)!;
      const expected = (this.recording.frames - track.startFrame) * FRAME;
      while (track.data.length < expected && track.data.length >= FRAME) track.data.push(...track.data.slice(track.data.length - FRAME));
      if (track.data.length === expected) this.writeFrame(track, p);
    }
    this.recording.leader.push(this.heroId);
    this.recording.frames++;
  }

  private checkEnd() {
    const time = this.step * DT;
    const hero = this.hero;
    if (this.unstable) return this.finish('unstable');
    const beach = this.level.beach;
    if (!hero) return this.finish(beach && this.lastHero && this.lastHero.z >= beach.z[0] ? 'landed' : 'lost');
    const hz = hero.body.translation().z;
    if (beach && hz >= beach.z[0] && (this.heroStill > 50 || this.beachSteps > 60 * 7)) return this.finish('landed');
    if (this.heroStill > 150 && time > 3) return this.finish('stopped');
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
    const hero = this.hero;
    const ht = hero?.body.translation() ?? this.lastHero ?? undefined;
    const size = hero?.size ?? this.lastHero?.size ?? 0;
    const stage = stageOf(size);
    const landed = reason === 'landed';
    const sand = landed && stage === STAGES.length - 1;
    const distance = Math.max(0, this.maxZ - this.startZ);
    const distPts = this.distancePoints();
    const breakdown = [
      { label: `Distance ${Math.round(distance)} m`, points: Math.round(distPts) },
      { label: `Smashes ×${this.smashes} · chips ×${this.chips}`, points: Math.round(this.smashPoints) },
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
    const score = Math.round(raw * STAGES[stage].mult);
    breakdown.push({ label: `${STAGES[stage].name} size multiplier`, points: score - Math.round(raw) });
    if (ht) this.trajectory.push([ht.x, ht.y, ht.z]);
    this.result = {
      score,
      distance,
      progress: Math.min(1, distance / (this.finishZ - this.startZ)),
      size,
      stage,
      bestStage: this.bestStage,
      landed,
      sand,
      smashes: this.smashes,
      chips: this.chips,
      maxCombo: this.maxCombo,
      airTime: this.totalAir,
      waterTime: this.waterSteps * DT,
      topSpeed: this.topSpeed,
      fractures: this.fractures,
      destination: landed ? 'the beach' : ht ? this.placeName(ht.z, ht.x) : 'nowhere',
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

export function gradeFor(score: number): string {
  if (score >= 400000) return 'S';
  if (score >= 150000) return 'A';
  if (score >= 60000) return 'B';
  if (score >= 20000) return 'C';
  return 'D';
}

const boulderCache = new Map<string, PieceShape>();
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
