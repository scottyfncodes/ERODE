import type RAPIER_T from '@dimforge/rapier3d-deterministic-compat';
import { Quaternion, Vector3 } from 'three';
import type { LevelDef, Plan, SurfaceKind } from '../levels/types';
import { fracturePiece, generateBoulder, generateStone, type PieceShape } from './fracture';
import { bedAt, loadLevelData, type LevelData, type WaterBody } from './levelData';
import { hashInts, mulberry32 } from './noise';
import { resolveObjects, type ColliderPart, type Material, type ResolvedObject } from './objects';
import { activeWater, countInterventions } from './plan';
import { makePolyline, pathDistance, type Polyline, type PathHit } from './geom';
import { SURFACE_ABRASION, SURFACE_DRAG, SURFACE_HARDNESS, SURFACE_LABEL } from './terrain';
import { layoutProps, type Props } from './props';
import { composition as compositionOf, severityOf, type Composition, type CompositionId } from './composition';

type R = typeof RAPIER_T;

export const DT = 1 / 60;
export const RECORD_EVERY = 3; // 20 Hz
/** floats per recorded frame: px py pz qx qy qz qw scale smooth */
export const FRAME = 9;
export const MAX_STONES = 30;
const GRAVITY = 9.81;
/** below this, the collider stops shrinking; the stone keeps shrinking visually */
export const MIN_PHYSICAL_RADIUS = 0.16;
const MAX_TIME = 240;
const STONE_FRICTION = 0.26;
/** damage tuning: kg lost = mass × K × (dv − threshold)² × hardness^1.5 × vulnerability / toughness */
const DAMAGE_K = 0.0016;
const DAMAGE_THRESHOLD = 2.2;
/** momentum (kg·m/s) a pine needs to be snapped, and what snapping it costs */
const TREE_BREAK = 30000;
const TREE_DRAIN = 11000;

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
  /** 0 = fresh jagged stone, 1 = water-polished */
  smooth: number;
  generation: number;
  parent: number | null;
  bornStep: number;
  immuneUntil: number;
  wet: boolean;
  submerged: boolean;
  lastImpactStep: number;
  lastContactStep: number;
  contactSurface: SurfaceKind | null;
  impactAcc: Vector3;
}

export type SimEventType = 'fracture' | 'chip' | 'impact' | 'splash' | 'slump' | 'breakoff' | 'tree' | 'bowl' | 'damage' | 'smash' | 'finish' | 'route';

export type Severity = 'minor' | 'moderate' | 'major';

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
  dir?: [number, number];
  /** damage events: kilograms lost and how bad */
  kg?: number;
  severity?: Severity;
}

export interface Collision {
  time: number;
  pos: [number, number, number];
  kg: number;
  severity: Severity;
  against: string;
  material: Material['kind'] | 'terrain';
  /** speed going in (m/s) */
  speed: number;
  headOn: boolean;
  split: boolean;
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
  objectChanges: { frame: number; objectId: string; change: 'slumped' | 'felled' | 'smashed'; dir?: [number, number] }[];
  /** hero id per frame, for the replay camera */
  leader: number[];
  /** hero mass (kg) per frame, for the replay HUD */
  mass: number[];
}

export type Medal = 'none' | 'bronze' | 'silver' | 'gold' | 'platinum';
export const MEDALS: Medal[] = ['none', 'bronze', 'silver', 'gold', 'platinum'];

export interface SimResult {
  finished: boolean;
  reason: 'finished' | 'stuck' | 'lost' | 'time' | 'unstable';
  /** a sentence: where and why the run ended */
  cause: string;
  composition: CompositionId;
  startMass: number;
  mass: number;
  massLost: number;
  /** fraction of the starting mass still in the stone */
  retained: number;
  impactLoss: number;
  abrasionLoss: number;
  splitLoss: number;
  startSize: number;
  size: number;
  duration: number;
  topSpeed: number;
  finishSpeed: number;
  distance: number;
  progress: number;
  collisions: Collision[];
  counts: Record<Severity, number>;
  splits: number;
  treesFelled: number;
  treeHits: number;
  smashed: string[];
  route: string | null;
  medal: Medal;
  objectives: { id: string; label: string; done: boolean }[];
  destination: string;
  interventions: number;
  unstable: boolean;
  trajectory: [number, number, number][];
  waterTime: number;
}

interface EnvInfo {
  kind: 'terrain' | 'object';
  material: Material;
  objectId?: string;
  saturated?: boolean;
}

export interface SimOptions {
  composition?: CompositionId;
}

export class Simulation {
  readonly level: LevelDef;
  readonly data: LevelData;
  readonly plan: Plan;
  readonly world: RAPIER_T.World;
  readonly R: R;
  readonly comp: Composition;
  readonly pieces = new Map<number, Piece>();
  readonly recording: Recording = { frames: 0, tracks: [], events: [], objectChanges: [], leader: [], mass: [] };
  readonly objects: ResolvedObject[];
  step = 0;
  done = false;
  result: SimResult | null = null;
  /** live lean input, -1 (left) … 1 (right), screen-relative for a camera looking down the course */
  steer = 0;
  readonly startMass: number;
  private pending: SimEvent[] = [];
  private env = new Map<number, EnvInfo>();
  private colliderPiece = new Map<number, number>();
  private queue: RAPIER_T.EventQueue;
  private nextId = 1;
  private tracks = new Map<number, Track>();
  private trajectory: [number, number, number][] = [];
  private waters: WaterBody[];
  private released = false;
  private unstable = false;
  private objectColliders = new Map<string, RAPIER_T.Collider[]>();
  private slumped = new Set<string>();
  readonly props: Props;
  private treeColliders = new Map<number, RAPIER_T.Collider>();
  private treesFelled = 0;
  private treeHits = new Set<string>();
  private bowled = new Set<number>();
  private smashed: string[] = [];
  private heroId = 1;
  private startZ: number;
  private finishZ: number;
  private maxZ: number;
  private heroStill = 0;
  private lastHero: { x: number; y: number; z: number; size: number; mass: number } | null = null;
  private course: Polyline | null;
  private courseHit: PathHit = { d: 0, t: 0, s: 0, px: 0, pz: 0, tx: 0, tz: 1 };
  private collisions: Collision[] = [];
  private impactLoss = 0;
  private abrasionLoss = 0;
  private splitLoss = 0;
  private splits = 0;
  private waterSteps = 0;
  private topSpeed = 0;
  private finishSpeed = 0;
  private crossedStep = -1;
  private routeProgress: number[];
  private routeDone: string | null = null;
  private wedged: string | null = null;
  debugImpacts: string[] | null = null;

  constructor(R: R, level: LevelDef, plan: Plan, opts: SimOptions = {}) {
    this.R = R;
    this.level = level;
    this.plan = plan;
    this.comp = compositionOf(opts.composition);
    this.data = loadLevelData(level);
    const waterOn = activeWater(level, plan);
    this.waters = this.data.water.filter((w) => waterOn.has(w.spec.id));
    this.course = level.terrain.course ? makePolyline(level.terrain.course) : null;
    this.routeProgress = level.routes.map(() => 0);
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
      if (o.dynamic) this.spawn('loose', o.dynamic.piece, o.dynamic.pos, o.dynamic.quat, [0, 0, 0], [0, 0, 0], 0, null, o.dynamic.material, false, 2.7);
    }

    // smashable props: pines to snap, loose stones to scatter
    this.props = layoutProps(level, this.data);
    const pine: Material = { hardness: 0.34, friction: 0.6, restitution: 0.2, label: 'a pine', kind: 'wood' };
    for (const tr of this.props.trees) {
      const c = world.createCollider(
        R.ColliderDesc.capsule(tr.h * 0.3, 0.4)
          .setTranslation(tr.x, tr.y + tr.h * 0.3, tr.z)
          .setFriction(0.6)
          .setRestitution(0.2),
      );
      this.treeColliders.set(tr.id, c);
      this.env.set(c.handle, { kind: 'object', material: pine, objectId: `tree:${tr.id}` });
    }
    const looseMat: Material = { hardness: 0.85, friction: 0.6, restitution: 0.3, label: 'a loose stone', kind: 'granite' };
    for (const rk of this.props.rocks) {
      this.spawn('loose', generateStone(rk.r, rk.seed, 0.8), [rk.x, rk.y, rk.z], [0, 0, 0, 1], [0, 0, 0], [0, 0, 0], 0, null, looseMat, true, 2.7);
    }

    const pose = restingBoulder(level);
    const boulder = this.spawn('stone', pose.shape, pose.pos, [0, 0, 0, 1], [0, 0, 0], [0, 0, 0], 0, null);
    this.heroId = boulder.id;
    this.startMass = this.massOf(boulder);
    this.startZ = pose.pos[2];
    this.maxZ = this.startZ;
    this.finishZ = level.finish.z;
    this.trajectory.push([...pose.pos]);
    this.record();
  }

  /** the largest piece of the original boulder */
  get leader(): Piece | undefined {
    return this.pieces.get(this.heroId);
  }
  get hero(): Piece | undefined {
    return this.leader;
  }
  get liveDistance(): number {
    return Math.max(0, this.maxZ - this.startZ);
  }
  get liveMass(): number {
    const h = this.hero;
    return h ? this.massOf(h) : (this.lastHero?.mass ?? 0);
  }
  get crossed(): boolean {
    return this.crossedStep >= 0;
  }
  get routeId(): string | null {
    return this.routeDone;
  }

  /** mass of a piece in kilograms */
  massOf(p: Piece): number {
    const k = p.size / p.shape.radius;
    return p.shape.volume * k * k * k * this.densityOf(p) * 1000;
  }
  private densityOf(p: Piece): number {
    return p.kind === 'loose' ? 2.7 : this.comp.density;
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
  private stoneCollider(p: { shape: PieceShape; kind: PieceKind; generation: number; smooth: number }, scale: number, density: number, material?: Material): RAPIER_T.ColliderDesc {
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
      .setDensity(density)
      .setFriction(material?.friction ?? STONE_FRICTION)
      .setFrictionCombineRule(R.CoefficientCombineRule.Min)
      .setRestitution(material?.restitution ?? 0.25)
      .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(vol * density * GRAVITY * 0.9);
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
    asleep = false,
    density = this.comp.density,
  ): Piece {
    const R = this.R;
    const bd = R.RigidBodyDesc.dynamic()
      .setSleeping(asleep)
      .setTranslation(...pos)
      .setRotation({ x: quat[0], y: quat[1], z: quat[2], w: quat[3] })
      .setLinvel(...linvel)
      .setAngvel({ x: angvel[0], y: angvel[1], z: angvel[2] })
      .setLinearDamping(0.02 + 0.06 * Math.min(1, shape.radius / this.level.boulder.radius))
      .setAngularDamping(this.baseAngularDamping(kind, shape.radius))
      .setCcdEnabled(kind !== 'chip');
    const body = this.world.createRigidBody(bd);
    const proto = { shape, kind, generation, smooth: 0 };
    const collider = this.world.createCollider(this.stoneCollider(proto, 1, density, material), body);
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
    };
    this.pieces.set(id, p);
    this.colliderPiece.set(collider.handle, id);
    if (kind === 'loose') this.env.set(collider.handle, { kind: 'object', material: material!, objectId: 'loose' });
    const track: Track = { id, kind, shape, startFrame: this.recording.frames, data: [], endFrame: null, fate: null };
    this.tracks.set(id, track);
    this.recording.tracks.push(track);
    return p;
  }

  /** Physically shrink a stone's collider to match its worn size — so mass loss changes how it rolls and what it fits through. */
  private rescale(p: Piece, force = false) {
    const want = Math.max(MIN_PHYSICAL_RADIUS / p.shape.radius, p.size / p.shape.radius);
    if (!force && want > p.physScale * 0.985) return;
    if (Math.abs(want - p.physScale) < 1e-4) return;
    this.colliderPiece.delete(p.collider.handle);
    this.world.removeCollider(p.collider, false);
    p.physScale = want;
    p.collider = this.world.createCollider(this.stoneCollider(p, want, this.densityOf(p)), p.body);
    p.collider.setFriction(p.wet ? 0.18 : STONE_FRICTION);
    this.colliderPiece.set(p.collider.handle, p.id);
    p.body.setLinearDamping(0.02 + 0.06 * Math.min(1, p.size / this.level.boulder.radius));
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

    const contacts = new Map<number, { hardness: number; label: string; env: EnvInfo | null; force: number; surface: SurfaceKind | null }>();
    const knocks: [number, number][] = [];
    const bowls: number[] = [];
    const smashes = new Set<string>();
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
        if (other?.objectId?.startsWith('tree:')) knocks.push([pid, Number(other.objectId.slice(5))]);
        if (other?.objectId === 'loose' && pid === this.heroId && otherPiece !== undefined) bowls.push(otherPiece);
        if (pid === this.heroId && other?.objectId && this.breakable(other.objectId)) smashes.add(other.objectId);
        if (pid === this.heroId && other?.objectId && this.isTreeObject(other.objectId)) this.treeHits.add(other.objectId);
        let hardness = 0.5;
        let label = 'the ground';
        let surface: SurfaceKind | null = null;
        if (other) {
          if (other.kind === 'terrain') {
            const p = this.pieces.get(pid)!;
            const t = p.body.translation();
            const s = this.data.terrain.surface(t.x, t.z);
            surface = s;
            hardness = SURFACE_HARDNESS[s];
            label = SURFACE_LABEL[s];
          } else {
            hardness = other.material.hardness;
            label = other.material.label;
            // a sheet of ice laid over the ground counts as ice underfoot: no grip, no drag
            if (other.material.kind === 'ice' && other.objectId && !other.objectId.startsWith('tree:')) surface = 'ice';
          }
        } else if (otherPiece !== undefined) {
          hardness = 0.8;
          label = 'a broken fragment';
        }
        const prev = contacts.get(pid);
        if (!prev || f * hardness > prev.force * prev.hardness) contacts.set(pid, { hardness, label, env: other ?? null, force: f, surface: surface ?? prev?.surface ?? null });
      }
    });

    for (const id of smashes) this.smashObject(id, before.get(this.heroId));
    for (const [pid, tid] of knocks) this.knockTree(pid, tid, before.get(pid));
    for (const lid of bowls) this.bowl(lid);
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
      if (c.surface) p.contactSurface = c.surface;
      const impact = p.impactAcc.length();
      const t = p.body.translation();
      if (c.env?.saturated && c.env.objectId && !this.slumped.has(c.env.objectId) && impact > 0.4) this.slump(c.env.objectId, [t.x, t.y, t.z]);
      if (p.kind !== 'chip' && impact > 1.4 && this.step - p.lastImpactStep > 6) {
        p.lastImpactStep = this.step;
        this.emit({
          step: this.step,
          type: 'impact',
          pos: [t.x, t.y, t.z],
          intensity: Math.min(1, ((impact * c.hardness) / 9) * Math.sqrt(Math.max(0.05, p.size) / this.level.boulder.radius) * 1.6),
          material: c.env?.kind === 'object' ? c.env.material.kind : 'terrain',
          label: c.label,
        });
      }
      if (p.id !== this.heroId || this.step < p.immuneUntil || this.crossed) continue;
      this.damage(p, vb, c.hardness, c.label, c.env?.kind === 'object' ? c.env.material.kind : 'terrain');
    }

    this.abrade();
    this.updateHero();
    this.checkBounds();
    if (this.step % 30 === 0) this.cull();
    if (this.step % RECORD_EVERY === 0) this.record();
    this.checkEnd();
  }

  /** How much of the stone an impact takes: speed change, what it hit, what the stone is made of. */
  private damage(p: Piece, vBefore: Vector3, hardness: number, label: string, material: Material['kind'] | 'terrain') {
    const dv = p.impactAcc.clone();
    const impact = dv.length();
    const threshold = DAMAGE_THRESHOLD * this.comp.threshold;
    if (impact <= threshold) return;
    const mass = this.massOf(p);
    const vuln = this.comp.against[material] ?? 1;
    let kg = mass * DAMAGE_K * (impact - threshold) ** 2 * Math.pow(hardness, 1.5) * vuln / this.comp.toughness;
    if (kg < 4) return;
    kg = Math.min(kg, mass * 0.4);
    const speed = vBefore.length();
    // head-on when the change in velocity opposes the motion
    const headOn = speed > 0.5 && dv.dot(vBefore) / (impact * speed) < -0.55;
    p.impactAcc.set(0, 0, 0);
    p.immuneUntil = this.step + 3;
    const t = p.body.translation();
    const pos: [number, number, number] = [t.x, t.y, t.z];
    const frac = kg / mass;
    let split = false;
    let lost = kg;
    if (frac > this.comp.splitAt && p.size > 0.45 && this.stoneCount() < MAX_STONES - 4) {
      const res = this.split(p, dv, frac, label);
      if (res !== null) {
        split = true;
        lost = res;
      }
    }
    if (!split) this.chip(p, dv, kg, label);
    const severity: Severity = split ? 'major' : severityOf(lost, mass);
    if (split) this.splitLoss += lost;
    else this.impactLoss += lost;
    if (split) this.splits++;
    const col: Collision = { time: this.step * DT, pos, kg: lost, severity, against: label, material, speed, headOn, split };
    if (lost >= 15) this.collisions.push(col);
    if (this.debugImpacts) this.debugImpacts.push(`${(this.step * DT).toFixed(1)}s ${label} dv=${impact.toFixed(1)} -${lost.toFixed(0)}kg ${severity} z=${t.z.toFixed(0)}`);
    this.emit({ step: this.step, type: 'damage', pos, intensity: Math.min(1, frac * 12), label, kg: lost, severity, material });
  }

  /** Knock chips off: the stone shrinks by exactly the mass lost. */
  private chip(p: Piece, dv: Vector3, kg: number, label: string) {
    const mass = this.massOf(p);
    const ratio = Math.max(0.05, (mass - kg) / mass);
    const before = p.size;
    p.size *= Math.cbrt(ratio);
    p.smooth *= 0.7;
    const t = p.body.translation();
    const pos: [number, number, number] = [t.x, t.y, t.z];
    const rng = mulberry32(hashInts(p.id, this.step, 77));
    // throw off real chips — the bigger the loss, the bigger the pieces
    const lostR = Math.cbrt(Math.max(0, before ** 3 - p.size ** 3));
    const n = kg < 30 ? 1 : kg < 300 ? 2 : 3;
    const out = dv.clone().normalize();
    const v = p.body.linvel();
    for (let i = 0; i < n && this.stoneCount() < MAX_STONES; i++) {
      const cr = Math.max(0.05, Math.min(0.55, lostR * (0.45 + rng() * 0.25)));
      const shape = generateStone(cr, hashInts(p.id, this.step, i), 0.7);
      const side = new Vector3(rng() - 0.5, rng() * 0.6 + 0.2, rng() - 0.5).normalize();
      const dir = out.clone().multiplyScalar(-0.6).add(side).normalize();
      const off = dir.clone().multiplyScalar(p.shape.radius * p.physScale + cr);
      const sp = 3 + Math.min(8, kg / 60) + rng() * 3;
      this.spawn('chip', shape, [t.x + off.x, t.y + off.y, t.z + off.z], [0, 0, 0, 1], [v.x + dir.x * sp, v.y + dir.y * sp + 2, v.z + dir.z * sp], [(rng() - 0.5) * 20, (rng() - 0.5) * 20, (rng() - 0.5) * 20], p.generation + 1, p.id);
    }
    this.emit({ step: this.step, type: 'chip', pos, intensity: Math.min(1, 0.25 + (kg / mass) * 10), label, parent: p.id });
    this.rescale(p);
  }

  /** A brutal hit: the stone splits; you carry on with the largest piece. Returns the mass lost, or null if it held. */
  private split(p: Piece, dv: Vector3, frac: number, label: string): number | null {
    const t = p.body.translation();
    const pos: [number, number, number] = [t.x, t.y, t.z];
    const massBefore = this.massOf(p);
    const rng = mulberry32(hashInts(p.id, this.step, this.level.boulder.seed));
    const room = MAX_STONES - this.stoneCount() + 1;
    const count = Math.min(frac > 0.3 ? 4 : frac > 0.2 ? 3 : 2, room);
    if (count < 2) return null;
    const r = p.body.rotation();
    const q = new Quaternion(r.x, r.y, r.z, r.w);
    const impactLocal = dv.clone().normalize().negate().applyQuaternion(q.clone().invert());
    const minVol = (4 / 3) * Math.PI * 0.12 ** 3;
    // the shape is in original units; fracture the worn stone at its current scale
    const res = fracturePiece(p.shape, [impactLocal.x, impactLocal.y, impactLocal.z], count, rng() * 1e9, minVol);
    if (res.cells.length < 2) return null;
    const scale = p.size / p.shape.radius;
    const lv = p.body.linvel();
    const av = p.body.angvel();
    const w = new Vector3(av.x, av.y, av.z);
    const base = new Vector3(lv.x, lv.y, lv.z);
    this.despawn(p, 'fractured');
    const ids: number[] = [];
    const spread = 1.5 + frac * 6;
    let biggest: Piece | null = null;
    for (const cell of res.cells) {
      const off = new Vector3(...cell.offset).multiplyScalar(scale).applyQuaternion(q);
      const cpos = off.clone().add(new Vector3(t.x, t.y, t.z));
      const vel = base.clone().add(w.clone().cross(off));
      if (off.lengthSq() > 1e-6) vel.add(off.clone().normalize().multiplyScalar(spread * (0.6 + rng() * 0.7)));
      vel.y += spread * 0.25;
      const ch = this.spawn(cell.shape.radius * scale < 0.3 ? 'chip' : 'stone', cell.shape, [cpos.x, cpos.y, cpos.z], [q.x, q.y, q.z, q.w], [vel.x, vel.y, vel.z], [w.x + (rng() - 0.5) * 4, w.y + (rng() - 0.5) * 4, w.z + (rng() - 0.5) * 4], p.generation + 1, p.id);
      if (scale < 0.999) {
        ch.size = cell.shape.radius * scale;
        this.rescale(ch, true);
      }
      ids.push(ch.id);
      if (!biggest || this.massOf(ch) > this.massOf(biggest)) biggest = ch;
    }
    if (!biggest) return null;
    if (biggest.kind === 'chip') {
      biggest.kind = 'stone';
      const tr = this.tracks.get(biggest.id);
      if (tr) tr.kind = 'stone';
    }
    this.heroId = biggest.id;
    biggest.immuneUntil = this.step + 20;
    this.emit({ step: this.step, type: 'fracture', pos, intensity: Math.min(1, 0.5 + frac), label, pieces: ids, parent: p.id });
    return massBefore - this.massOf(biggest);
  }

  private isTreeObject(id: string) {
    return this.level.objects.some((o) => o.id === id && o.type === 'tree');
  }

  private breakable(id: string): boolean {
    if (this.smashed.includes(id)) return false;
    const o = this.level.objects.find((q) => q.id === id);
    return !!o && o.type === 'branches' && !!o.breakMomentum;
  }

  /** A heavy, fast stone bursts through timber; a light or slow one is stopped by it. */
  private smashObject(id: string, vBefore: Vector3 | undefined) {
    const hero = this.hero;
    const o = this.level.objects.find((q) => q.id === id);
    if (!hero || !vBefore || !o || o.type !== 'branches' || !o.breakMomentum) return;
    const mass = this.massOf(hero);
    const speed = vBefore.length();
    const momentum = mass * speed;
    if (momentum < o.breakMomentum) return;
    this.smashed.push(id);
    for (const c of this.objectColliders.get(id) ?? []) {
      this.env.delete(c.handle);
      this.world.removeCollider(c, true);
    }
    this.objectColliders.set(id, []);
    // bursting through costs momentum: the structure's resistance
    const drain = o.breakMomentum * 0.45;
    const k = Math.max(0.25, 1 - drain / momentum);
    hero.body.setLinvel({ x: vBefore.x * k, y: vBefore.y * k, z: vBefore.z * k }, true);
    const dir: [number, number] = [vBefore.x / (speed || 1), vBefore.z / (speed || 1)];
    this.recording.objectChanges.push({ frame: this.recording.frames, objectId: id, change: 'smashed', dir });
    const t = hero.body.translation();
    this.emit({ step: this.step, type: 'smash', pos: [t.x, t.y, t.z], intensity: Math.min(1, speed / 14), objectId: id, label: o.name, dir });
    // timber is soft, but it isn't nothing: a scrape off the stone
    const mat = o.style === 'beaver' || o.style === 'debris' || o.style === 'deadfall' ? 0.16 : 0.3;
    hero.impactAcc.set(0, 0, 0).addScaledVector(vBefore, -(1 - k) * 1.6);
    this.damage(hero, vBefore, mat, `the ${o.name.toLowerCase()}`, o.style === 'logjam' || o.style === 'fence' || o.style === 'trestle' ? 'wood' : 'branches');
  }

  /** A heavy stone moving fast snaps a pine; a light one bounces off it. */
  private knockTree(pid: number, tid: number, vBefore: Vector3 | undefined) {
    const c = this.treeColliders.get(tid);
    const p = this.pieces.get(pid);
    if (!c || !p || p.kind !== 'stone') return;
    if (pid === this.heroId) this.treeHits.add(`tree:${tid}`);
    const lv = p.body.linvel();
    const v = vBefore ?? new Vector3(lv.x, lv.y, lv.z);
    const sp = Math.hypot(v.x, v.z);
    const mass = this.massOf(p);
    if (mass * sp < TREE_BREAK) return;
    this.treeColliders.delete(tid);
    this.env.delete(c.handle);
    this.world.removeCollider(c, false);
    const tr = this.props.trees[tid];
    const dir: [number, number] = [v.x / (sp || 1), v.z / (sp || 1)];
    this.recording.objectChanges.push({ frame: this.recording.frames, objectId: `tree:${tid}`, change: 'felled', dir });
    const k = Math.max(0.3, 1 - TREE_DRAIN / (mass * sp));
    p.body.setLinvel({ x: v.x * k, y: v.y, z: v.z * k }, true);
    this.treesFelled++;
    const pos: [number, number, number] = [tr.x, tr.y + 1.5, tr.z];
    this.emit({ step: this.step, type: 'tree', pos, intensity: Math.min(1, sp / 15), objectId: `tree:${tid}`, dir });
    if (pid === this.heroId && !this.crossed && this.step >= p.immuneUntil) {
      // snapping a trunk is a real blow
      p.impactAcc.set(-v.x * 0.6, 0, -v.z * 0.6);
      this.damage(p, v, 0.34, 'a pine', 'wood');
    }
  }

  private bowl(lid: number) {
    if (this.bowled.has(lid)) return;
    const hero = this.hero;
    const rock = this.pieces.get(lid);
    if (!hero || !rock) return;
    const v = hero.body.linvel();
    if (Math.hypot(v.x, v.y, v.z) < 4) return;
    this.bowled.add(lid);
    const t = rock.body.translation();
    this.emit({ step: this.step, type: 'bowl', pos: [t.x, t.y, t.z], intensity: 0.6 });
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

  /** Steady wear: rolling over rough ground, tumbling in water. */
  private abrade() {
    const p = this.hero;
    if (!p || this.crossed) return;
    const v = p.body.linvel();
    const sp = Math.hypot(v.x, v.y, v.z);
    let frac = 0;
    if (p.wet) {
      // water: wear grows with how hard the current drives grit against it
      frac = 1e-4 * (sp + 1) * DT * this.comp.abrasion * this.comp.water;
    } else if (this.step - p.lastContactStep <= 3 && sp > 0.5 && p.contactSurface) {
      frac = SURFACE_ABRASION[p.contactSurface] * sp * DT * this.comp.abrasion;
    }
    if (frac <= 0) return;
    const mass = this.massOf(p);
    const kg = mass * frac;
    p.size *= Math.cbrt(1 - frac);
    p.smooth = Math.min(1, p.smooth + frac * (p.wet ? 120 : 20));
    this.abrasionLoss += kg;
    if (this.step % 20 === p.id % 20) this.rescale(p);
  }

  /** Lean and the mountain's pull on the hero stone. */
  private driveHero() {
    const p = this.hero;
    if (!p) return;
    const grounded = this.step - p.lastContactStep < 6 || p.wet;
    const [rx, rz] = this.rightAt(p);
    const tx = this.courseHit.tx,
      tz = this.courseHit.tz;
    const m = p.body.mass();
    const v = p.body.linvel();
    const surf = grounded && !p.wet ? p.contactSurface : null;
    // in the water the current has a say; on ice there's nothing to lean on; in the air, little
    const control = p.wet ? 0.45 : surf === 'ice' ? 0.25 : grounded ? 1 : 0.4;
    const side = v.x * rx + v.z * rz;
    let steerAcc = 0;
    // weight: a heavy stone carves wide and answers slowly; a light one darts
    const mass = this.massOf(p);
    const nimble = Math.max(0.65, Math.min(1.6, Math.pow(10000 / mass, 0.22)));
    const steer = this.crossed ? 0 : this.steer;
    if (Math.abs(steer) > 0.02) {
      const want = steer * 7 * nimble;
      const resp = 2.6 * nimble;
      steerAcc = Math.max(-18, Math.min(18, (want - side) * resp)) * control;
    } else if (grounded && !p.wet) {
      steerAcc = -side * 0.5;
    }
    // the mountain's pull keeps it moving down the line on gentle ground
    const pull = grounded && !this.crossed ? 1.2 : 0;
    const course = this.course ? Math.min(1, Math.max(0, (this.courseHit.d - 18) / 10)) : 0;
    const back = course * 4;
    const tp = p.body.translation();
    const toLine = this.course ? Math.sign((this.courseHit.px - tp.x) * rx + (this.courseHit.pz - tp.z) * rz) : 0;
    // soft ground swallows momentum
    const drag = surf ? SURFACE_DRAG[surf] : 0;
    p.body.addForce(
      {
        x: m * (rx * (steerAcc + back * toLine) + tx * pull - v.x * drag),
        y: 0,
        z: m * (rz * (steerAcc + back * toLine) + tz * pull - v.z * drag),
      },
      true,
    );
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

  private applyWater(p: Piece) {
    const t = p.body.translation();
    const v = p.body.linvel();
    const r = p.shape.radius * p.physScale;
    const vol = (4 / 3) * Math.PI * r * r * r;
    const mass = p.body.mass();
    let wet = false;
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
      // the current shoves a light stone harder than a heavy one
      const k = 1.6 * frac * mass * Math.min(1.6, Math.max(0.6, Math.pow(10000 / Math.max(1, this.massOf(p)), 0.2)));
      p.body.addForce({ x: k * (vfx - v.x), y: frac * vol * GRAVITY - 0.9 * frac * mass * v.y, z: k * (vfz - v.z) }, true);
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
    if (wet && p.id === this.heroId) this.waterSteps++;
  }

  private updateHero() {
    let hero = this.hero;
    if (!hero) {
      let best: Piece | undefined;
      for (const p of this.pieces.values()) if (p.kind === 'stone' && (!best || p.size > best.size)) best = p;
      if (!best) return;
      this.heroId = best.id;
      hero = best;
    }
    const t = hero.body.translation();
    const v = hero.body.linvel();
    const sp = Math.hypot(v.x, v.y, v.z);
    this.lastHero = { x: t.x, y: t.y, z: t.z, size: hero.size, mass: this.massOf(hero) };
    if (!this.crossed) this.topSpeed = Math.max(this.topSpeed, sp);
    if (t.z > this.maxZ) this.maxZ = Math.min(t.z, this.finishZ + 40);
    if (this.step % 6 === 0) this.trajectory.push([t.x, t.y, t.z]);
    this.heroStill = sp < 0.45 ? this.heroStill + 1 : 0;
    // narrow passages: the stone fits or it doesn't
    for (const g of this.level.passages ?? []) {
      if (this.wedged || this.crossed) break;
      if (Math.abs(t.z - g.z) > 1.2 || Math.abs(t.x - g.x) > g.width * 0.5 + hero.size) continue;
      if (2 * hero.size > g.width) {
        this.wedged = g.name;
        hero.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        hero.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        hero.body.setBodyType(this.R.RigidBodyType.Fixed, true);
        this.emit({ step: this.step, type: 'impact', pos: [t.x, t.y, t.z], intensity: 1, material: 'granite', label: g.name });
      }
    }
    // routes: pass each gate in order
    this.level.routes.forEach((r, i) => {
      const k = this.routeProgress[i];
      if (k >= r.gates.length) return;
      const gt = r.gates[k];
      if (t.x >= gt.x[0] && t.x <= gt.x[1] && t.z >= gt.z[0] && t.z <= gt.z[1]) {
        this.routeProgress[i]++;
        if (this.routeProgress[i] === r.gates.length && !this.routeDone) {
          this.routeDone = r.id;
          this.emit({ step: this.step, type: 'route', pos: [t.x, t.y, t.z], intensity: 0.5, label: r.name });
        }
      }
    });
    // the finish line
    const f = this.level.finish;
    if (!this.crossed && t.z >= f.z && (!f.x || (t.x >= f.x[0] && t.x <= f.x[1]))) {
      this.crossedStep = this.step;
      this.finishSpeed = sp;
      this.emit({ step: this.step, type: 'finish', pos: [t.x, t.y, t.z], intensity: 1, label: f.name });
    }
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
    this.recording.mass.push(Math.round(this.liveMass));
    this.recording.frames++;
  }

  private checkEnd() {
    const time = this.step * DT;
    const hero = this.hero;
    if (this.unstable) return this.finish('unstable');
    if (this.crossed) {
      // let it run out past the line, then call it
      if (!hero || this.heroStill > 30 || this.step - this.crossedStep > 150) this.finish('finished');
      return;
    }
    if (!hero) return this.finish('lost');
    if (this.wedged && this.heroStill > 40) return this.finish('stuck');
    if (this.heroStill > 150 && time > 3) return this.finish('stuck');
    if (time > MAX_TIME) this.finish('time');
  }

  runToEnd(maxSteps = Math.ceil(MAX_TIME / DT) + 400): SimResult {
    while (!this.done && this.step < maxSteps) this.stepOnce();
    if (!this.done) this.finish('time');
    return this.result!;
  }

  private placeName(z: number, x: number): string {
    for (const r of this.level.regions) if (x >= r.x[0] && x <= r.x[1] && z >= r.z[0] && z <= r.z[1]) return r.name;
    return 'the mountainside';
  }

  /** What stopped it: the nearest structure, gap or formation. */
  private stopCause(x: number, z: number, size: number): string {
    let best = '';
    let bestD = 7 + size;
    for (const o of this.level.objects) {
      const p = 'position' in o ? o.position : o.center;
      const st = this.plan[o.id];
      if (o.type === 'branches' && ((st?.type === 'branches' && st.removed) || this.smashed.includes(o.id))) continue;
      const reach = o.type === 'branches' ? o.span * 0.5 : 0;
      const d = Math.max(0, Math.hypot(p[0] - x, p[1] - z) - reach);
      if (d < bestD) {
        bestD = d;
        best = o.type === 'branches' ? `Stopped dead by the ${o.name.toLowerCase()}` : `Came to rest against the ${o.name.toLowerCase()}`;
      }
    }
    for (const f of this.level.formations) {
      const d = Math.max(0, Math.hypot(f.position[0] - x, f.position[1] - z) - Math.max(f.size[0], f.size[2]) * 0.5);
      if (d < bestD) {
        bestD = d;
        best = f.gap ? `Wedged in ${f.name}` : `Came to rest against ${f.name}`;
      }
    }
    if (best) return best;
    const s = this.data.terrain.surface(x, z);
    if (s === 'mud') return `Bogged down in the mud at ${this.placeName(z, x)}`;
    if (s === 'snow') return `Buried in snow at ${this.placeName(z, x)}`;
    return `Ran out of momentum at ${this.placeName(z, x)}`;
  }

  finish(reason: SimResult['reason']) {
    if (this.done) return;
    this.done = true;
    this.record();
    const hero = this.hero;
    const ht = hero?.body.translation() ?? this.lastHero ?? undefined;
    const size = hero?.size ?? this.lastHero?.size ?? 0;
    const finished = reason === 'finished';
    const mass = finished ? (hero ? this.massOf(hero) : (this.lastHero?.mass ?? 0)) : hero ? this.massOf(hero) : 0;
    const retained = this.startMass > 0 ? mass / this.startMass : 0;
    const distance = Math.max(0, this.maxZ - this.startZ);
    const m = this.level.medals;
    const medal: Medal = !finished ? 'none' : retained >= m.platinum ? 'platinum' : retained >= m.gold ? 'gold' : retained >= m.silver ? 'silver' : 'bronze';
    const counts: Record<Severity, number> = { minor: 0, moderate: 0, major: 0 };
    for (const c of this.collisions) counts[c.severity]++;
    const interventions = countInterventions(this.level, this.plan);
    const duration = (this.crossed ? this.crossedStep : this.step) * DT;
    const objectives = this.level.objectives.map((o) => {
      let done = false;
      if (finished)
        switch (o.type) {
          case 'noTrees':
            done = this.treeHits.size === 0;
            break;
          case 'route':
            done = this.routeDone === o.route || this.routeProgress[this.level.routes.findIndex((r) => r.id === o.route)] === this.level.routes.find((r) => r.id === o.route)?.gates.length;
            break;
          case 'smash':
            done = this.smashed.includes(o.object);
            break;
          case 'speed':
            done = this.finishSpeed * 3.6 >= o.kmh;
            break;
          case 'retain':
            done = retained >= o.fraction;
            break;
          case 'moves':
            done = interventions <= o.max;
            break;
          case 'noMajor':
            done = counts.major === 0;
            break;
          case 'time':
            done = duration <= o.seconds;
            break;
        }
      return { id: o.id, label: o.label, done };
    });
    const cause = finished
      ? `Reached ${this.level.finish.name}`
      : reason === 'lost'
        ? 'Lost over the edge'
        : reason === 'unstable'
          ? 'The physics slipped'
          : reason === 'time'
            ? 'Out of time'
            : this.wedged
              ? `Wedged in ${this.wedged} — ${(2 * size).toFixed(2)} m across, too wide by ${Math.max(1, Math.round((2 * size - (this.level.passages?.find((g) => g.name === this.wedged)?.width ?? 0)) * 100))} cm`
              : ht
                ? this.stopCause(ht.x, ht.z, size)
                : 'Stopped';
    if (ht) this.trajectory.push([ht.x, ht.y, ht.z]);
    this.result = {
      finished,
      reason,
      cause,
      composition: this.comp.id,
      startMass: this.startMass,
      mass,
      massLost: this.startMass - mass,
      retained,
      impactLoss: this.impactLoss,
      abrasionLoss: this.abrasionLoss,
      splitLoss: this.splitLoss,
      startSize: this.level.boulder.radius,
      size,
      duration,
      topSpeed: this.topSpeed,
      finishSpeed: this.finishSpeed,
      distance,
      progress: Math.min(1, distance / Math.max(1, this.finishZ - this.startZ)),
      collisions: this.collisions,
      counts,
      splits: this.splits,
      treesFelled: this.treesFelled,
      treeHits: this.treeHits.size,
      smashed: [...this.smashed],
      route: this.routeDone,
      medal,
      objectives,
      destination: finished ? this.level.finish.name : ht ? this.placeName(ht.z, ht.x) : 'nowhere',
      interventions,
      unstable: this.unstable,
      trajectory: this.trajectory,
      waterTime: this.waterSteps * DT,
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
