import { Quaternion, Vector3 } from 'three';
import type { LevelDef, Segment, SegmentKind } from '../levels/types';
import type { LevelData } from '../sim/levelData';
import { makePolyline, pathPointAt, type Polyline } from '../sim/geom';
import { hashInts, mulberry32 } from '../sim/noise';
import { composition as compositionOf, type Composition, type CompositionId } from '../sim/composition';
import { generateBoulder, type PieceShape } from '../sim/fracture';
import { CHANNEL_HALF, layoutLevel, type Layout, type StructureDef } from './layout';
import { Debris, type Body } from './debris';

export const DT = 1 / 60;
const G = 9.81;
/** seconds (game time) the player has to choose at a fork */
export const DECISION_WINDOW = 2.5;
/** the camera starts framing a fork this long before it */
export const FORK_LOOKAHEAD = 5.5;
const MAX_TIME = 200;
/** speed above which the mountain starts holding the boulder back hard (m/s) */
const SOFT_CAP = 31;
const DRAG = 0.0011;
export const CHUNK_SLOTS = 260;

/** rolling resistance by ground */
const MU: Record<SegmentKind, number> = {
  summit: 0.03,
  forest: 0.055,
  scree: 0.02,
  ravine: 0.016,
  camp: 0.04,
  loose: 0.026,
  finale: 0.05,
};

export const KIND_LABEL: Record<SegmentKind, string> = {
  summit: 'Summit',
  forest: 'Dense forest',
  scree: 'Rocky slope',
  ravine: 'Narrow ravine',
  camp: 'Timber camp',
  loose: 'Loose ground',
  finale: 'Final run',
};

export type Category = 'timber' | 'rock' | 'structure' | 'terrain' | 'slide';
export const CATEGORY_LABEL: Record<Category, string> = { timber: 'Timber', rock: 'Rock', structure: 'Buildings', terrain: 'Terrain', slide: 'Slides' };

export type RunEventType =
  | 'release'
  | 'approach'
  | 'decision'
  | 'commit'
  | 'enter'
  | 'tree'
  | 'treeLand'
  | 'crack'
  | 'rock'
  | 'pillar'
  | 'hit'
  | 'collapse'
  | 'wall'
  | 'land'
  | 'slide'
  | 'milestone'
  | 'chain'
  | 'score'
  | 'finale'
  | 'shatter'
  | 'end';

export interface RunEvent {
  type: RunEventType;
  pos: [number, number, number];
  intensity: number;
  label?: string;
  points?: number;
  dir?: [number, number];
  depth?: number;
  id?: number;
  /** for a commit: was it the player's choice, or the mountain's? */
  auto?: boolean;
}

export interface ForkOption {
  id: string;
  name: string;
  kind: SegmentKind;
  side: 'left' | 'centre' | 'right';
}

export interface Decision {
  from: string;
  options: ForkOption[];
  /** what happens if the player doesn't choose */
  fallback: number;
  chosen: number | null;
  /** game seconds left before the boulder reaches the fork */
  timeLeft: number;
  window: number;
}

export interface RunStats {
  trees: number;
  treesChain: number;
  cracked: number;
  rocks: number;
  pillars: number;
  structures: number;
  structuresDamaged: number;
  parts: number;
  slides: number;
  slideRocks: number;
  wallHits: number;
  landings: number;
  airTime: number;
  longestChain: number;
  chains: number;
  distance: number;
  topSpeed: number;
  milestones: number[];
  finaleSpeed: number;
  finaleFlattened: boolean;
  decisions: number;
  autoDecisions: number;
}

export interface ScoreBreakdown {
  destruction: number;
  chain: number;
  variety: number;
  distance: number;
  speed: number;
  completion: number;
  total: number;
}

export interface RunResult {
  finished: boolean;
  reason: 'finished' | 'shattered' | 'stalled' | 'time';
  cause: string;
  composition: CompositionId;
  score: ScoreBreakdown;
  stats: RunStats;
  /** segment ids, in the order the boulder rode them */
  route: string[];
  categories: Category[];
  /** biggest single moments */
  highlights: { label: string; points: number }[];
  duration: number;
  integrity: number;
  trajectory: [number, number, number][];
}

interface SegRT {
  seg: Segment;
  pl: Polyline;
  len: number;
  /** heading change per metre, sampled each metre */
  curv: Float32Array;
}

interface StructRT {
  def: StructureDef;
  blastedCount: number;
  frameBlasted: number;
  collapsed: boolean;
  collapseAt: number;
  scored: boolean;
  chain: number;
  depth: number;
  touched: boolean;
}

const UP = new Vector3(0, 1, 0);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const _v = new Vector3();
const _w = new Vector3();
const _d = new Vector3();
const _q = new Quaternion();

export class RunSim {
  readonly level: LevelDef;
  readonly data: LevelData;
  readonly layout: Layout;
  readonly comp: Composition;
  readonly debris: Debris;
  readonly shape: PieceShape;
  readonly mass: number;
  readonly radius: number;
  readonly maxIntegrity: number;

  step = 0;
  time = 0;
  done = false;
  result: RunResult | null = null;
  released = false;

  // ---- the boulder
  seg: SegRT;
  s = 0;
  v = 2.5;
  lat = 0;
  latV = 0;
  y = 0;
  vy = 0;
  grounded = true;
  airborne = 0;
  integrity: number;
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  readonly quat = new Quaternion();
  /** direction of travel (unit, horizontal) */
  readonly heading = new Vector3(0, 0, 1);
  shattered = false;
  private surge = 0;
  private jolt = 0;
  private stallT = 0;
  private endT = -1;
  private finaleHit = false;

  // ---- the route
  decision: Decision | null = null;
  /** next fork ahead: seconds until it, and where it is */
  forkAhead: { t: number; at: Vector3; options: string[] } | null = null;
  private approachSent = false;
  readonly route: string[] = [];
  private segs = new Map<string, SegRT>();

  // ---- the destructibles
  readonly treeState: Uint8Array;
  readonly treeAng: Float32Array;
  readonly treeAngV: Float32Array;
  readonly treeDir: Float32Array;
  readonly treeSnap: Float32Array;
  readonly treeSway: Float32Array;
  readonly treeSwayV: Float32Array;
  private treeChain: Int32Array;
  private treeDepth: Uint8Array;
  private treeEnergy: Float32Array;
  /** trees moving right now (falling or swaying) */
  readonly movingTrees = new Set<number>();
  /** trees whose look changed since the renderer last asked */
  readonly changedTrees = new Set<number>();
  readonly rockGone: Uint8Array;
  readonly changedRocks = new Set<number>();
  readonly partBody: Int32Array;
  readonly chunkBody: (Body | null)[] = new Array(CHUNK_SLOTS).fill(null);
  readonly chunkVariant = new Uint8Array(CHUNK_SLOTS);
  readonly chunkRadius = new Float32Array(CHUNK_SLOTS);
  /** chunks that are a released loose rock keep its look */
  readonly chunkRock = new Int32Array(CHUNK_SLOTS).fill(-1);
  private nextChunk = 0;
  private structs: StructRT[];
  private pendingCollapse: StructRT[] = [];
  private slideFired: boolean[];
  private slideQueue: { rock: number; at: number; chain: number }[] = [];
  private grid = new Map<number, number[]>();

  // ---- score
  readonly stats: RunStats = {
    trees: 0,
    treesChain: 0,
    cracked: 0,
    rocks: 0,
    pillars: 0,
    structures: 0,
    structuresDamaged: 0,
    parts: 0,
    slides: 0,
    slideRocks: 0,
    wallHits: 0,
    landings: 0,
    airTime: 0,
    longestChain: 0,
    chains: 0,
    distance: 0,
    topSpeed: 0,
    milestones: [],
    finaleSpeed: 0,
    finaleFlattened: false,
    decisions: 0,
    autoDecisions: 0,
  };
  destruction = 0;
  chainBonus = 0;
  private categories = new Set<Category>();
  private chainSize = new Map<number, number>();
  private nextChain = 1;
  private highlights: { label: string; points: number }[] = [];
  private trajectory: [number, number, number][] = [];
  private pending: RunEvent[] = [];
  private rng: () => number;

  constructor(level: LevelDef, data: LevelData, opts: { composition?: CompositionId; seed?: number } = {}) {
    this.level = level;
    this.data = data;
    this.layout = layoutLevel(level, data);
    this.comp = compositionOf(opts.composition);
    this.rng = mulberry32(opts.seed ?? hashInts(level.boulder.seed, 99));
    this.debris = new Debris(data.heightAt);
    for (const s of level.segments) this.segs.set(s.id, this.makeSeg(s));
    this.seg = this.segs.get(level.start)!;
    this.route.push(this.seg.seg.id);
    this.shape = generateBoulder(level.boulder.radius, level.boulder.seed);
    this.radius = level.boulder.radius;
    this.mass = this.shape.volume * this.comp.density * 1000;
    this.maxIntegrity = 100 * this.comp.toughness;
    this.integrity = this.maxIntegrity;

    const L = this.layout;
    const nT = L.trees.length;
    this.treeState = new Uint8Array(nT);
    this.treeAng = new Float32Array(nT);
    this.treeAngV = new Float32Array(nT);
    this.treeDir = new Float32Array(nT * 2);
    this.treeSnap = new Float32Array(nT);
    this.treeSway = new Float32Array(nT * 2);
    this.treeSwayV = new Float32Array(nT * 2);
    this.treeChain = new Int32Array(nT);
    this.treeDepth = new Uint8Array(nT);
    this.treeEnergy = new Float32Array(nT);
    this.rockGone = new Uint8Array(L.rocks.length);
    this.partBody = new Int32Array(L.parts.length).fill(-1);
    this.structs = L.structures.map((def) => ({ def, blastedCount: 0, frameBlasted: 0, collapsed: false, collapseAt: -1, scored: false, chain: -1, depth: 0, touched: false }));
    this.slideFired = L.slides.map(() => false);
    for (const t of L.trees) this.insert(0, t.id, t.x, t.z, 0);
    for (const r of L.rocks) if (r.role !== 'marker') this.insert(1, r.id, r.x, r.z, r.r);
    for (const s of L.structures) this.insert(2, s.id, s.x, s.z, Math.hypot(s.hx, s.hz));

    // rest on the summit
    const [bx, bz] = level.boulder.position;
    let best = 0;
    let bestD = Infinity;
    for (let s = 0; s < this.seg.len; s += 0.5) {
      const p = pathPointAt(this.seg.pl, s);
      const d = Math.hypot(p.x - bx, p.z - bz);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    this.s = best;
    this.v = 0;
    this.placeBoulder();
    this.y = this.groundAt(this.s, 0) + this.radius * 0.92;
    this.pos.y = this.y;
    this.trajectory.push([this.pos.x, this.pos.y, this.pos.z]);
  }

  // ------------------------------------------------------------------ helpers

  private makeSeg(seg: Segment): SegRT {
    const pl = makePolyline(seg.path);
    const n = Math.ceil(pl.length) + 1;
    const curv = new Float32Array(n);
    const ang = (s: number) => {
      const p = pathPointAt(pl, s);
      return Math.atan2(p.tx, p.tz);
    };
    for (let i = 0; i < n; i++) {
      let d = ang(Math.min(pl.length, i + 4)) - ang(Math.max(0, i - 4));
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      curv[i] = d / 8;
    }
    return { seg, pl, len: pl.length, curv };
  }

  private key(ix: number, iz: number) {
    return (ix + 512) * 4096 + (iz + 512);
  }
  /** spatial hash: layer 0 trees, 1 rocks, 2 structures */
  private insert(layer: number, id: number, x: number, z: number, r: number) {
    const C = 6;
    for (let ix = Math.floor((x - r) / C); ix <= Math.floor((x + r) / C); ix++)
      for (let iz = Math.floor((z - r) / C); iz <= Math.floor((z + r) / C); iz++) {
        const k = this.key(ix, iz) * 4 + layer;
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(id);
      }
  }
  private query(layer: number, x: number, z: number, r: number, out: Set<number>) {
    const C = 6;
    out.clear();
    for (let ix = Math.floor((x - r) / C); ix <= Math.floor((x + r) / C); ix++)
      for (let iz = Math.floor((z - r) / C); iz <= Math.floor((z + r) / C); iz++) {
        const list = this.grid.get(this.key(ix, iz) * 4 + layer);
        if (list) for (const id of list) out.add(id);
      }
    return out;
  }
  private qTrees = new Set<number>();
  private qRocks = new Set<number>();
  private qStructs = new Set<number>();

  private pointAt(seg: SegRT, s: number, lat: number) {
    const p = pathPointAt(seg.pl, s);
    return { x: p.x + p.tz * lat, z: p.z - p.tx * lat, tx: p.tx, tz: p.tz };
  }
  private groundAt(s: number, lat: number, seg = this.seg): number {
    const p = this.pointAt(seg, Math.max(0, Math.min(seg.len, s)), lat);
    return this.data.heightAt(p.x, p.z);
  }
  /** ground height a little beyond the end of this segment continues on the path the boulder will take */
  private groundAhead(ds: number): number {
    const s = this.s + ds;
    if (s <= this.seg.len || !this.seg.seg.next.length) return this.groundAt(Math.min(s, this.seg.len), this.lat);
    const nid = this.decision ? this.seg.seg.next[this.decision.chosen ?? this.decision.fallback] : this.seg.seg.next[0];
    const nseg = this.segs.get(nid)!;
    return this.groundAt(s - this.seg.len, this.lat, nseg);
  }

  private placeBoulder() {
    const p = this.pointAt(this.seg, this.s, this.lat);
    this.pos.x = p.x;
    this.pos.z = p.z;
    this.heading.set(p.tx, 0, p.tz);
  }

  get kind(): SegmentKind {
    return this.seg.seg.kind;
  }
  get segmentName(): string {
    return this.seg.seg.name;
  }
  get speed(): number {
    return this.v;
  }
  get score(): number {
    return Math.round(this.destruction + this.chainBonus + this.stats.distance * 2 + this.speedBonus());
  }
  /** fraction of the run done, by distance down the mountain */
  get progress(): number {
    const z0 = this.level.boulder.position[1];
    const end = this.level.segments.find((s) => s.kind === 'finale')!.path;
    const z1 = end[end.length - 1][1];
    return Math.max(0, Math.min(1, (this.pos.z - z0) / (z1 - z0)));
  }

  drainEvents(): RunEvent[] {
    const e = this.pending;
    this.pending = [];
    return e;
  }
  private emit(e: RunEvent) {
    this.pending.push(e);
  }

  private newChain(): number {
    const id = this.nextChain++;
    this.chainSize.set(id, 0);
    return id;
  }

  /** credit destruction; consequences down a chain are worth more */
  private award(points: number, cat: Category, label: string, pos: Vector3 | [number, number, number], chain = -1, depth = 0) {
    const mult = (1 + 0.25 * Math.min(4, depth)) * this.comp.fury;
    const pts = Math.round(points * mult);
    this.destruction += pts;
    this.categories.add(cat);
    const p: [number, number, number] = pos instanceof Vector3 ? [pos.x, pos.y, pos.z] : pos;
    if (depth > 0 && chain > 0) {
      const n = (this.chainSize.get(chain) ?? 0) + 1;
      this.chainSize.set(chain, n);
      if (n > this.stats.longestChain) this.stats.longestChain = n;
      if (n === 3) this.stats.chains++;
      if (n === 3 || n === 5 || n === 8 || n === 12 || (n > 12 && n % 6 === 0)) {
        const bonus = 60 * n;
        this.chainBonus += bonus;
        this.emit({ type: 'chain', pos: p, intensity: Math.min(1, n / 12), points: bonus, label: `Chain ×${n}`, depth: n });
      }
    }
    if (pts >= 250) {
      this.emit({ type: 'score', pos: p, intensity: Math.min(1, pts / 4000), points: pts, label });
      this.highlights.push({ label, points: pts });
    }
  }

  private speedBonus(): number {
    let b = 0;
    for (const m of this.stats.milestones) b += m === 50 ? 500 : m === 75 ? 1000 : 2000;
    return b;
  }

  // ------------------------------------------------------------------ input

  release() {
    if (this.released) return;
    this.released = true;
    this.v = 4;
    this.emit({ type: 'release', pos: [this.pos.x, this.pos.y, this.pos.z], intensity: 1 });
  }

  /** commit to one of the options at the coming fork. First choice is final. */
  choose(index: number): boolean {
    const d = this.decision;
    if (!d || d.chosen !== null || index < 0 || index >= d.options.length) return false;
    d.chosen = index;
    this.stats.decisions++;
    const o = d.options[index];
    this.emit({ type: 'commit', pos: [this.pos.x, this.pos.y, this.pos.z], intensity: 1, label: o.name, id: index, auto: false });
    return true;
  }

  /** choose by side ('left' | 'right' | 'centre'): the nearest option on that side */
  chooseSide(side: 'left' | 'right' | 'centre'): boolean {
    const d = this.decision;
    if (!d) return false;
    let i = d.options.findIndex((o) => o.side === side);
    if (i < 0) i = side === 'left' ? 0 : side === 'right' ? d.options.length - 1 : Math.floor(d.options.length / 2);
    return this.choose(i);
  }

  // ------------------------------------------------------------------ the step

  stepOnce() {
    if (this.done) return;
    this.step++;
    this.time += DT;
    if (!this.released) {
      this.debris.step(DT);
      return;
    }
    if (!this.shattered) {
      this.moveBoulder();
      this.forks();
      this.collide();
      this.slides();
    }
    this.updateTrees();
    this.updateStructures();
    this.releaseSlideRocks();
    this.debris.step(DT, (b) => this.debrisHits(b));
    if (this.step % 6 === 0 && !this.shattered) this.trajectory.push([+this.pos.x.toFixed(2), +this.pos.y.toFixed(2), +this.pos.z.toFixed(2)]);
    this.checkEnd();
  }

  private moveBoulder() {
    const seg = this.seg;
    const kind = seg.seg.kind;
    const r = this.radius;
    // slope along the line, where the boulder actually is
    const h0 = this.groundAt(this.s - 1.5, this.lat);
    const h1 = this.groundAhead(1.5);
    const slope = (h1 - h0) / 3;
    const ground = this.groundAt(this.s, this.lat);
    if (this.grounded) {
      // a rolling ball: gravity along the slope, rolling resistance, air
      // past the finale it ploughs to a stop through the wreckage
      const mu = MU[kind] * this.comp.grip + (this.finaleHit ? 0.22 : 0);
      let a = -(5 / 7) * G * (slope / Math.sqrt(1 + slope * slope)) - mu * G - DRAG * this.v * this.v;
      if (this.v > SOFT_CAP) a -= 0.05 * (this.v - SOFT_CAP) ** 2;
      if (this.surge > 0) a += 1.7;
      this.v += a * DT;
    } else {
      this.v -= DRAG * this.v * this.v * DT;
    }
    if (this.surge > 0) this.surge -= DT;
    if (this.v < 0) this.v = 0;

    // up and down: ballistic, caught by the ground
    this.vy -= G * DT;
    this.y += this.vy * DT;
    const floor = ground + r * 0.92;
    const groundVy = this.v * slope;
    if (this.y <= floor) {
      const impact = groundVy - this.vy;
      if (!this.grounded && this.airborne > 0.25 && impact > 4) this.landing(impact);
      this.y = floor;
      this.vy = groundVy;
      this.grounded = true;
      this.airborne = 0;
    } else if (this.y > floor + 0.2) {
      this.grounded = false;
      this.airborne += DT;
      this.stats.airTime += DT;
    }

    // side to side: banks pull it to the middle, bends fling it out, walls stop it
    const ci = Math.max(0, Math.min(seg.curv.length - 1, Math.round(this.s)));
    const kappa = seg.curv[ci];
    const half = CHANNEL_HALF[kind];
    const k = kind === 'ravine' ? 0.25 : 1.1;
    let la = -this.v * this.v * kappa * 0.55 - k * this.lat - 1.6 * this.latV;
    this.latV += la * DT;
    // a broken, jolting gorge floor kicks the boulder into the walls
    this.jolt -= DT;
    if (kind === 'ravine' && this.grounded && this.jolt <= 0 && this.v > 6) {
      this.jolt = 0.45 + this.rng() * 0.7;
      this.latV += (this.rng() < 0.5 ? -1 : 1) * (1.6 + this.rng() * 2.4) * Math.min(1.4, this.v / 20);
    }
    this.lat += this.latV * DT;
    if (Math.abs(this.lat) > half) {
      const side = Math.sign(this.lat);
      const into = this.latV * side;
      this.lat = side * half;
      if (into > 0) {
        this.latV = -this.latV * 0.35;
        if (kind === 'ravine' || kind === 'loose') this.wall(side, into);
      }
    }

    this.s += this.v * DT;
    this.stats.distance += this.v * DT;
    if (this.s >= seg.len) this.nextSegment();
    this.placeBoulder();
    this.pos.y = this.y;

    // velocity and roll
    const n = { x: this.heading.z, z: -this.heading.x };
    this.vel.set(this.heading.x * this.v + n.x * this.latV, this.vy, this.heading.z * this.v + n.z * this.latV);
    _w.set(this.vel.x, 0, this.vel.z);
    const sp = _w.length();
    if (sp > 0.01) {
      _d.crossVectors(UP, _w).normalize();
      _q.setFromAxisAngle(_d, (sp / r) * DT);
      this.quat.premultiply(_q).normalize();
    }

    // speed milestones
    const kmh = this.v * 3.6;
    if (kmh > this.stats.topSpeed * 3.6) this.stats.topSpeed = this.v;
    for (const m of [50, 75, 100]) {
      if (kmh >= m && !this.stats.milestones.includes(m)) {
        this.stats.milestones.push(m);
        this.emit({ type: 'milestone', pos: [this.pos.x, this.pos.y, this.pos.z], intensity: m / 100, points: m === 50 ? 500 : m === 75 ? 1000 : 2000, label: `${m} km/h` });
      }
    }
    void ground;
  }

  private landing(impact: number) {
    this.stats.landings++;
    const p = this.pos;
    this.emit({ type: 'land', pos: [p.x, this.y - this.radius, p.z], intensity: Math.min(1, (impact - 3) / 9) });
    this.hurt((impact - 5) * 0.9, 'land');
    this.v *= 1 - Math.min(0.12, impact * 0.008);
    // the ground gives: a spray of broken rock
    const chain = this.newChain();
    const n = 2 + Math.min(4, Math.floor(impact / 3));
    for (let i = 0; i < n; i++) {
      const a = this.rng() * Math.PI * 2;
      _v.set(Math.cos(a) * (2 + this.rng() * 4) + this.vel.x * 0.4, 3 + this.rng() * 4, Math.sin(a) * (2 + this.rng() * 4) + this.vel.z * 0.4);
      this.spawnChunk(_d.set(p.x + Math.cos(a) * 1.5, this.y - this.radius + 0.3, p.z + Math.sin(a) * 1.5), 0.25 + this.rng() * 0.3, _v, chain, 1, -1);
    }
    this.award(120 + Math.round(impact * 10), 'terrain', 'Big landing', p);
  }

  private wall(side: number, into: number) {
    if (into < 1.2) return;
    this.stats.wallHits++;
    const n = { x: this.heading.z, z: -this.heading.x };
    const wx = this.pos.x + n.x * side * (this.radius + 0.6),
      wz = this.pos.z + n.z * side * (this.radius + 0.6);
    const wy = this.y + 0.5;
    this.emit({ type: 'wall', pos: [wx, wy, wz], intensity: Math.min(1, into / 6), dir: [n.x * side, n.z * side] });
    this.hurt(into * 0.9, 'wall');
    this.v *= 1 - Math.min(0.08, into * 0.012);
    // the wall spalls: rock breaks off and falls in behind
    const chain = this.newChain();
    const count = 1 + Math.min(3, Math.floor(into / 2));
    for (let i = 0; i < count; i++) {
      _v.set(-n.x * side * (1 + this.rng() * 3) + this.heading.x * this.v * 0.5, 1 + this.rng() * 3, -n.z * side * (1 + this.rng() * 3) + this.heading.z * this.v * 0.5);
      this.spawnChunk(_d.set(wx + n.x * side * 0.5, wy + 1 + this.rng() * 3, wz + n.z * side * 0.5), 0.3 + this.rng() * 0.45, _v, chain, 1, -1);
    }
    this.award(60 + Math.round(into * 15), 'terrain', 'Wall strike', [wx, wy, wz]);
  }

  /** where the integrity went, for tuning */
  readonly damage: Record<string, number> = {};
  private hurt(amount: number, why = 'other') {
    if (amount <= 0 || this.shattered) return;
    this.damage[why] = (this.damage[why] ?? 0) + amount;
    this.integrity -= amount;
    if (this.integrity <= 0) {
      this.integrity = 0;
      this.shatter();
    }
  }

  private shatter() {
    this.shattered = true;
    const p = this.pos;
    this.emit({ type: 'shatter', pos: [p.x, p.y, p.z], intensity: 1, dir: [this.heading.x, this.heading.z] });
    const chain = this.newChain();
    for (let i = 0; i < 10; i++) {
      const a = this.rng() * Math.PI * 2;
      _v.copy(this.vel).multiplyScalar(0.6 + this.rng() * 0.4).add(_w.set(Math.cos(a) * (2 + this.rng() * 5), 2 + this.rng() * 5, Math.sin(a) * (2 + this.rng() * 5)));
      this.spawnChunk(_d.set(p.x + Math.cos(a) * 0.8, p.y + (this.rng() - 0.3) * 1.2, p.z + Math.sin(a) * 0.8), this.radius * (0.3 + this.rng() * 0.22), _v, chain, 1, -2);
    }
    this.endT = this.time + 2.6;
  }

  private nextSegment() {
    const seg = this.seg;
    const next = seg.seg.next;
    if (!next.length) {
      this.s = seg.len;
      this.v *= 0.9;
      if (this.endT < 0) this.endT = this.time + 1.2;
      return;
    }
    let id = next[0];
    if (next.length > 1) {
      const d = this.decision;
      let idx = d?.fallback ?? 0;
      if (d && d.chosen !== null) idx = d.chosen;
      else {
        // the mountain chooses: the boulder follows the fall line
        this.stats.autoDecisions++;
        if (d) d.chosen = idx;
        const o = d?.options[idx];
        this.emit({ type: 'commit', pos: [this.pos.x, this.pos.y, this.pos.z], intensity: 1, label: o?.name ?? '', id: idx, auto: true });
      }
      id = next[idx];
    }
    this.decision = null;
    this.approachSent = false;
    this.s -= seg.len;
    this.seg = this.segs.get(id)!;
    this.route.push(id);
    const k = this.seg.seg;
    this.emit({ type: 'enter', pos: [this.pos.x, this.pos.y, this.pos.z], intensity: 1, label: k.name });
  }

  private forks() {
    const seg = this.seg;
    const next = seg.seg.next;
    if (next.length < 2) {
      this.forkAhead = null;
      return;
    }
    const t = (seg.len - this.s) / Math.max(7, this.v);
    const end = seg.seg.path[seg.seg.path.length - 1];
    if (t <= FORK_LOOKAHEAD) {
      if (!this.forkAhead) this.forkAhead = { t, at: new Vector3(end[0], this.data.heightAt(end[0], end[1]), end[1]), options: next };
      this.forkAhead.t = t;
      if (!this.approachSent) {
        this.approachSent = true;
        this.emit({ type: 'approach', pos: [end[0], 0, end[1]], intensity: 1 });
      }
    } else this.forkAhead = null;
    if (t <= DECISION_WINDOW && !this.decision) {
      const options: ForkOption[] = next.map((id, i) => {
        const s = this.segs.get(id)!.seg;
        const side = next.length === 2 ? (i === 0 ? 'left' : 'right') : i === 0 ? 'left' : i === next.length - 1 ? 'right' : 'centre';
        return { id, name: s.name, kind: s.kind, side };
      });
      let fallback = next.findIndex((id) => this.segs.get(id)!.seg.fallLine);
      if (fallback < 0) {
        // the straightest way down
        let best = Infinity;
        next.forEach((id, i) => {
          const p = this.segs.get(id)!.seg.path;
          const dx = Math.abs(p[p.length - 1][0] - p[0][0]);
          if (dx < best) {
            best = dx;
            fallback = i;
          }
        });
      }
      this.decision = { from: seg.seg.id, options, fallback, chosen: null, timeLeft: t, window: t };
      this.emit({ type: 'decision', pos: [end[0], 0, end[1]], intensity: 1 });
    }
    if (this.decision) this.decision.timeLeft = Math.max(0, t);
  }

  // ------------------------------------------------------------------ collisions

  private collide() {
    const r = this.radius;
    const x = this.pos.x,
      z = this.pos.z;
    const L = this.layout;
    for (const id of this.query(0, x, z, r + 3.5, this.qTrees)) {
      const t = L.trees[id];
      const st = this.treeState[id];
      if (st >= 2) continue;
      const d = Math.hypot(t.x - x, t.z - z);
      if (d < r + t.r + 0.2 && this.y - r < t.y + 3) this.boulderTree(id, d);
      else if (d < r + 3.5 && st === 0) this.nudgeSway(id, 0.6 * (1 - (d - r) / 3.5), x, z);
    }
    for (const id of this.query(1, x, z, r + 3, this.qRocks)) {
      if (this.rockGone[id]) continue;
      const k = L.rocks[id];
      if (k.role === 'marker') continue;
      const d = Math.hypot(k.x - x, k.z - z);
      const reach = k.role === 'pillar' ? r + k.r * 0.9 : r + k.r * 0.8;
      if (d < reach && this.y - r < k.y + k.r * k.tall) this.boulderRock(id);
    }
    for (const id of this.query(2, x, z, r + 14, this.qStructs)) {
      const st = this.structs[id];
      const def = st.def;
      const dx = x - def.x,
        dz = z - def.z;
      const c = Math.cos(def.yaw),
        sn = Math.sin(def.yaw);
      const lx = dx * c - dz * sn;
      const lz = dx * sn + dz * c;
      if (Math.abs(lx) > def.hx + r || Math.abs(lz) > def.hz + r) continue;
      if (this.y - r > def.y + def.height) continue;
      this.boulderStructure(st);
    }
  }

  private boulderTree(id: number, d: number) {
    const t = this.layout.trees[id];
    const mTree = 520 * t.h * Math.PI * t.r * t.r * 0.7;
    const lost = this.v * (mTree / (this.mass + mTree)) * 0.5 + 0.12;
    this.v = Math.max(0, this.v - lost);
    // knocked aside: the tree's side decides which way it goes, and which way the boulder jinks
    const n = { x: this.heading.z, z: -this.heading.x };
    const side = Math.sign((t.x - this.pos.x) * n.x + (t.z - this.pos.z) * n.z) || 1;
    this.latV -= side * (0.5 + this.rng() * 0.8) * (1 - d / (this.radius + 1));
    const E = Math.min(1, this.v / 11 + 0.3);
    const dx = this.heading.x + n.x * side * 0.55 + (this.rng() - 0.5) * 0.3;
    const dz = this.heading.z + n.z * side * 0.55 + (this.rng() - 0.5) * 0.3;
    this.fellTree(id, dx, dz, E, this.newChain(), 0);
    this.hurt(0.08, 'tree');
  }

  private nudgeSway(id: number, amount: number, fromX: number, fromZ: number) {
    if (amount <= 0.05) return;
    const t = this.layout.trees[id];
    const dx = t.x - fromX,
      dz = t.z - fromZ;
    const l = Math.hypot(dx, dz) || 1;
    this.treeSwayV[id * 2] += (dx / l) * amount * 0.25 + this.heading.x * amount * 0.25;
    this.treeSwayV[id * 2 + 1] += (dz / l) * amount * 0.25 + this.heading.z * amount * 0.25;
    this.movingTrees.add(id);
  }

  /** Snap a tree and send it down, or crack it if the blow is weak. */
  private fellTree(id: number, dx: number, dz: number, E: number, chain: number, depth: number) {
    const st = this.treeState[id];
    if (st >= 2) return;
    const t = this.layout.trees[id];
    const l = Math.hypot(dx, dz) || 1;
    const pos: [number, number, number] = [t.x, t.y + 1.5, t.z];
    if (E < 0.28 && st === 0) {
      if (E < 0.1) {
        this.treeSwayV[id * 2] += (dx / l) * 0.6;
        this.treeSwayV[id * 2 + 1] += (dz / l) * 0.6;
        this.movingTrees.add(id);
        return;
      }
      // cracked: it leans, splintered at the base, and stays up — for now
      this.treeState[id] = 1;
      this.treeAng[id] = 0.22 + E * 0.6;
      this.treeDir[id * 2] = dx / l;
      this.treeDir[id * 2 + 1] = dz / l;
      this.treeSnap[id] = 0.3;
      this.changedTrees.add(id);
      this.stats.cracked++;
      this.emit({ type: 'crack', pos, intensity: E, dir: [dx / l, dz / l], id, depth });
      this.award(50, 'timber', 'Cracked', pos, chain, depth);
      return;
    }
    this.treeState[id] = 2;
    this.treeAngV[id] = 0.5 + E * 1.5;
    if (st === 0) this.treeAng[id] = 0;
    this.treeDir[id * 2] = dx / l;
    this.treeDir[id * 2 + 1] = dz / l;
    this.treeSnap[id] = depth === 0 ? 0.5 + this.rng() * 0.7 : 0.25 + this.rng() * 0.4;
    this.treeChain[id] = chain;
    this.treeDepth[id] = depth;
    this.treeEnergy[id] = E;
    this.movingTrees.add(id);
    this.changedTrees.add(id);
    if (depth > 0) this.stats.treesChain++;
    this.stats.trees++;
    this.emit({ type: 'tree', pos, intensity: E, dir: [dx / l, dz / l], id, depth, label: depth > 0 ? 'Domino' : undefined });
    this.award(depth > 0 ? 180 : 140, 'timber', depth > 0 ? 'Timber!' : 'Felled', pos, chain, depth);
  }

  private boulderRock(id: number) {
    const k = this.layout.rocks[id];
    const r = this.radius;
    this.rockGone[id] = 1;
    this.changedRocks.add(id);
    const chain = this.newChain();
    const pos: [number, number, number] = [k.x, k.y, k.z];
    const n = { x: this.heading.z, z: -this.heading.x };
    const side = Math.sign((k.x - this.pos.x) * n.x + (k.z - this.pos.z) * n.z) || 1;
    if (k.role === 'pillar') {
      // a pillar comes down in pieces, top first, falling the way it was hit
      const pieces = Math.round(3 + k.tall * 1.5);
      for (let i = 0; i < pieces; i++) {
        const h = (i / pieces) * k.r * k.tall * 1.7;
        _v.set(this.heading.x * this.v * (0.25 + this.rng() * 0.3) + n.x * side * (1 + this.rng() * 2), 1 + this.rng() * 2, this.heading.z * this.v * (0.25 + this.rng() * 0.3) + n.z * side * (1 + this.rng() * 2));
        this.spawnChunk(_d.set(k.x + (this.rng() - 0.5), k.y - k.r * k.tall * 0.8 + h, k.z + (this.rng() - 0.5)), k.r * (0.45 + this.rng() * 0.3), _v, chain, 1, k.variant);
      }
      this.v *= 0.955;
      this.latV -= side * 1.2;
      this.hurt(3.5, 'pillar');
      this.stats.pillars++;
      this.emit({ type: 'pillar', pos, intensity: 1, dir: [this.heading.x, this.heading.z], id });
      this.award(600, 'rock', 'Pillar toppled', pos);
      return;
    }
    const mRock = (4 / 3) * Math.PI * k.r ** 3 * 2600;
    this.v = Math.max(0, this.v - this.v * (mRock / (this.mass + mRock)) * 0.35 - 0.1);
    this.latV -= side * (0.4 + this.rng() * 0.8) * Math.min(2, k.r);
    this.hurt(k.r * k.r * 0.9, 'rock');
    const count = Math.max(4, Math.min(9, Math.round(k.r * 7)));
    for (let i = 0; i < count; i++) {
      const a = this.rng() * Math.PI * 2;
      _v.set(this.vel.x * (0.45 + this.rng() * 0.5) + Math.cos(a) * (2 + this.rng() * 4), 2 + this.rng() * 4, this.vel.z * (0.45 + this.rng() * 0.5) + Math.sin(a) * (2 + this.rng() * 4));
      this.spawnChunk(_d.set(k.x + Math.cos(a) * k.r * 0.4, k.y + this.rng() * k.r * 0.5, k.z + Math.sin(a) * k.r * 0.4), k.r * (0.32 + this.rng() * 0.22), _v, chain, 1, k.variant);
    }
    this.stats.rocks++;
    this.emit({ type: 'rock', pos, intensity: Math.min(1, k.r / 1.6), dir: [this.heading.x, this.heading.z], id });
    this.award(k.r > 1.4 ? 300 : 110, 'rock', k.r > 1.4 ? 'Boulder smashed' : 'Shattered', pos);
    void r;
  }

  private boulderStructure(st: StructRT) {
    const def = st.def;
    if (!st.touched) {
      st.touched = true;
      st.chain = this.newChain();
      this.emit({ type: 'hit', pos: [this.pos.x, this.pos.y, this.pos.z], intensity: def.finale ? 1 : Math.min(1, def.points / 2000), label: def.name, id: def.id });
      if (def.finale && !this.finaleHit) {
        this.finaleHit = true;
        this.stats.finaleSpeed = this.v;
        this.emit({ type: 'finale', pos: [def.x, def.y + 3, def.z], intensity: Math.min(1, this.v / 26), label: def.name, id: def.id });
        st.collapseAt = this.time + 0.12;
        this.pendingCollapse.push(st);
      }
      this.hurt(def.finale ? 0 : 0.5, 'timber');
    }
    const reach = this.radius + 0.7 + (def.finale ? this.v * 0.12 : 0);
    const k = def.finale ? 1 + this.v / 22 : 1;
    const m = this.blast(st, this.pos, reach, _v.copy(this.vel).multiplyScalar(k), st.chain, 0);
    if (m > 0) {
      this.v = Math.max(0, this.v - this.v * (m / (this.mass + m)) * (def.finale ? 0.9 : 0.55));
      if (def.kind === 'fence' || def.kind === 'logpile') this.v = Math.max(0, this.v - 0.05);
    }
  }

  /** Blow parts out of a structure within `reach` of a point. Returns the mass knocked loose. */
  private blast(st: StructRT, atIn: Vector3, reach: number, velIn: Vector3, chain: number, depth: number): number {
    const at = atIn.clone();
    const vel = velIn.clone();
    const def = st.def;
    const parts = this.layout.parts;
    let mass = 0;
    let count = 0;
    for (const pid of def.parts) {
      if (this.partBody[pid] >= 0) continue;
      const p = parts[pid];
      if (p.role === 'base') continue;
      const ext = Math.max(p.half[0], p.half[1], p.half[2]);
      const dx = p.pos[0] - at.x,
        dy = p.pos[1] - at.y,
        dz = p.pos[2] - at.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - ext * 0.6;
      if (d > reach) continue;
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const push = 2 + this.rng() * 3;
      _w.set(vel.x * (0.5 + this.rng() * 0.5) + (dx / l) * push, Math.max(0, vel.y) * 0.3 + 1.5 + this.rng() * 3, vel.z * (0.5 + this.rng() * 0.5) + (dz / l) * push);
      this.loosen(pid, _w, 4 + this.rng() * 6, chain, depth + 1);
      mass += p.mass;
      count++;
      if (p.role === 'frame' || p.role === 'stack') st.frameBlasted++;
    }
    if (count) {
      st.blastedCount += count;
      this.stats.parts += count;
      this.award(14 * count, 'structure', def.name, at, chain, depth);
      this.checkCollapse(st, chain, depth);
    }
    return mass;
  }

  private loosen(pid: number, vel: Vector3, spin: number, chain: number, depth: number) {
    const p = this.layout.parts[pid];
    const b = this.debris.add({
      shape: p.shape,
      ref: pid,
      pos: p.pos,
      quat: p.quat,
      vel,
      spin: _d.set(this.rng() - 0.5, this.rng() - 0.5, this.rng() - 0.5).normalize().multiplyScalar(spin),
      half: p.half,
      mass: p.mass,
      chain,
      depth,
      hits: p.mass > 90,
    });
    this.partBody[pid] = b.id;
  }

  private checkCollapse(st: StructRT, chain: number, depth: number) {
    if (st.collapsed || st.collapseAt >= 0) return;
    const def = st.def;
    const n = def.parts.length;
    let go = false;
    switch (def.kind) {
      case 'tower':
      case 'watertower':
      case 'trestle':
        go = st.frameBlasted >= 2;
        break;
      case 'logpile':
        go = st.blastedCount >= 2;
        break;
      case 'fence':
        go = false;
        break;
      default:
        go = st.blastedCount >= Math.max(3, n * 0.12);
    }
    if (!go) return;
    st.collapseAt = this.time + 0.18 + this.rng() * 0.3;
    st.chain = chain;
    st.depth = depth;
    this.pendingCollapse.push(st);
  }

  private updateStructures() {
    for (let i = this.pendingCollapse.length - 1; i >= 0; i--) {
      const st = this.pendingCollapse[i];
      if (this.time < st.collapseAt) continue;
      this.pendingCollapse.splice(i, 1);
      this.collapse(st);
    }
  }

  /** What's left comes down: walls fall outward, the roof drops in. */
  private collapse(st: StructRT) {
    if (st.collapsed) return;
    st.collapsed = true;
    const def = st.def;
    const parts = this.layout.parts;
    const big = def.finale ? 1 + this.stats.finaleSpeed / 25 : 1;
    for (const pid of def.parts) {
      if (this.partBody[pid] >= 0) continue;
      const p = parts[pid];
      if (p.role === 'base') continue;
      const dx = p.pos[0] - def.x,
        dz = p.pos[2] - def.z;
      const l = Math.hypot(dx, dz) || 1;
      const out = (p.role === 'wall' ? 1.4 : p.role === 'frame' ? 1 : 0.4) * big;
      _w.set((dx / l) * out * (0.5 + this.rng()) + (this.rng() - 0.5) * 0.6, p.role === 'roof' || p.role === 'deck' ? -1.5 : -0.3, (dz / l) * out * (0.5 + this.rng()) + (this.rng() - 0.5) * 0.6);
      if (def.finale) _w.addScaledVector(this.heading, this.stats.finaleSpeed * 0.25 * this.rng());
      this.loosen(pid, _w, 1 + this.rng() * 3 * big, st.chain, st.depth + 1);
    }
    this.stats.structures++;
    const pos: [number, number, number] = [def.x, def.y + def.height * 0.4, def.z];
    this.emit({ type: 'collapse', pos, intensity: def.finale ? 1 : Math.min(1, def.points / 2500), label: def.name, id: def.id, depth: st.depth });
    if (def.finale) {
      const energy = Math.max(0.6, Math.min(1.8, this.stats.finaleSpeed / 18));
      this.stats.finaleFlattened = true;
      this.award(Math.round(def.points * energy), 'structure', `${def.name} flattened`, pos);
    } else this.award(def.points, 'structure', `${def.name} destroyed`, pos, st.chain, st.depth);
  }

  // ------------------------------------------------------------------ trees

  private updateTrees() {
    const L = this.layout;
    for (const id of this.movingTrees) {
      const st = this.treeState[id];
      const t = L.trees[id];
      if (st === 2) {
        // a rod pivoting at its base: it falls faster the further it leans
        const a = this.treeAng[id];
        this.treeAngV[id] += ((1.5 * G) / t.h) * Math.sin(Math.max(0.05, a)) * DT;
        this.treeAng[id] = a + this.treeAngV[id] * DT;
        this.changedTrees.add(id);
        const dx = this.treeDir[id * 2],
          dz = this.treeDir[id * 2 + 1];
        const ang = this.treeAng[id];
        const reach = t.h * Math.sin(Math.min(ang, Math.PI / 2));
        const tipX = t.x + dx * reach,
          tipZ = t.z + dz * reach;
        const tipY = t.y + this.treeSnap[id] + t.h * Math.cos(ang);
        if (ang > 0.45 && this.step % 2 === 0) this.treeSweep(id, reach);
        if (tipY <= this.data.heightAt(tipX, tipZ) + 0.7 || ang > 1.95) {
          this.treeState[id] = 3;
          this.treeAngV[id] = 0;
          this.emit({ type: 'treeLand', pos: [t.x + dx * t.h * 0.55, this.data.heightAt(t.x + dx * t.h * 0.55, t.z + dz * t.h * 0.55) + 0.4, t.z + dz * t.h * 0.55], intensity: Math.min(1, t.h / 16), dir: [dx, dz], id });
          this.movingTrees.delete(id);
        }
        continue;
      }
      // swaying: a damped spring
      let moving = false;
      for (let k = 0; k < 2; k++) {
        const i = id * 2 + k;
        this.treeSwayV[i] += (-28 * this.treeSway[i] - 3.2 * this.treeSwayV[i]) * DT;
        this.treeSway[i] += this.treeSwayV[i] * DT;
        if (Math.abs(this.treeSway[i]) > 0.002 || Math.abs(this.treeSwayV[i]) > 0.01) moving = true;
      }
      this.changedTrees.add(id);
      if (!moving) {
        this.treeSway[id * 2] = this.treeSway[id * 2 + 1] = 0;
        this.movingTrees.delete(id);
      }
    }
  }

  /** A falling trunk takes down what it lands on. */
  private treeSweep(id: number, reach: number) {
    const L = this.layout;
    const t = L.trees[id];
    const dx = this.treeDir[id * 2],
      dz = this.treeDir[id * 2 + 1];
    const chain = this.treeChain[id];
    const depth = this.treeDepth[id];
    const E = this.treeEnergy[id] * 0.55;
    const mx = t.x + dx * reach * 0.5,
      mz = t.z + dz * reach * 0.5;
    for (const oid of this.query(0, mx, mz, reach * 0.5 + 2, this.qTrees)) {
      if (oid === id || this.treeState[oid] >= 2) continue;
      const o = L.trees[oid];
      const ox = o.x - t.x,
        oz = o.z - t.z;
      const along = ox * dx + oz * dz;
      if (along < 1 || along > reach) continue;
      const across = Math.abs(ox * dz - oz * dx);
      if (across > 1.4 + o.r) continue;
      // it lands across the next trunk and carries on through
      const side = Math.sign(ox * dz - oz * dx) || 1;
      this.fellTree(oid, dx + dz * side * 0.35 + (this.rng() - 0.5) * 0.3, dz - dx * side * 0.35 + (this.rng() - 0.5) * 0.3, E, chain, depth + 1);
      this.treeAngV[id] *= 0.8;
    }
    // and anything built beneath it
    for (const sid of this.query(2, mx, mz, reach * 0.5 + 6, this.qStructs)) {
      const st = this.structs[sid];
      const def = st.def;
      for (let f = 0.35; f <= 1.0; f += 0.2) {
        const px = t.x + dx * reach * f,
          pz = t.z + dz * reach * f;
        const ex = px - def.x,
          ez = pz - def.z;
        const c = Math.cos(def.yaw),
          sn = Math.sin(def.yaw);
        const lx = ex * c - ez * sn,
          lz = ex * sn + ez * c;
        if (Math.abs(lx) > def.hx || Math.abs(lz) > def.hz) continue;
        const py = t.y + this.treeSnap[id] + t.h * f * Math.cos(this.treeAng[id]);
        if (py > def.y + def.height + 1) continue;
        _d.set(px, py, pz);
        _v.set(dx * 4, -4, dz * 4);
        if (this.blast(st, _d, 1.6, _v, chain, depth) > 0) this.treeAngV[id] *= 0.7;
        break;
      }
    }
  }

  // ------------------------------------------------------------------ slides

  private slides() {
    const L = this.layout;
    L.slides.forEach((sl, i) => {
      if (this.slideFired[i] || sl.seg !== this.seg.seg.id || this.s < sl.trigger) return;
      this.slideFired[i] = true;
      this.stats.slides++;
      const chain = this.newChain();
      let cx = 0,
        cz = 0;
      for (const rid of sl.rocks) {
        const k = L.rocks[rid];
        cx += k.x / sl.rocks.length;
        cz += k.z / sl.rocks.length;
        const d = Math.hypot(k.x - this.pos.x, k.z - this.pos.z);
        this.slideQueue.push({ rock: rid, at: this.time + 0.15 + d * 0.025 + this.rng() * 0.6, chain });
      }
      this.surge = 3.5;
      this.emit({ type: 'slide', pos: [cx, this.data.heightAt(cx, cz) + 2, cz], intensity: 1, label: 'ROCKSLIDE', dir: [this.heading.x, this.heading.z] });
      this.award(900, 'slide', 'Rockslide!', [cx, this.data.heightAt(cx, cz), cz]);
    });
  }

  private releaseSlideRocks() {
    for (let i = this.slideQueue.length - 1; i >= 0; i--) {
      const q = this.slideQueue[i];
      if (this.time < q.at) continue;
      this.slideQueue.splice(i, 1);
      if (this.rockGone[q.rock]) continue;
      const k = this.layout.rocks[q.rock];
      this.rockGone[q.rock] = 1;
      this.changedRocks.add(q.rock);
      // downhill from where it sits, with a shove toward the line
      const e = 1;
      const gx = this.data.heightAt(k.x + e, k.z) - this.data.heightAt(k.x - e, k.z);
      const gz = this.data.heightAt(k.x, k.z + e) - this.data.heightAt(k.x, k.z - e);
      const gl = Math.hypot(gx, gz) || 1;
      _v.set((-gx / gl) * (2.5 + this.rng() * 2), 0.5 + this.rng(), (-gz / gl) * (2.5 + this.rng() * 2) + 1.5);
      const slot = this.spawnChunk(_d.set(k.x, k.y + 0.1, k.z), k.r, _v, q.chain, 1, k.variant);
      this.chunkRock[slot] = q.rock;
      this.stats.slideRocks++;
    }
  }

  // ------------------------------------------------------------------ debris

  /** Throw a rock chunk into the world. Returns its slot. */
  private spawnChunk(posIn: Vector3, r: number, velIn: Vector3, chain: number, depth: number, variant: number): number {
    const pos = posIn.clone();
    const vel = velIn.clone();
    const slot = this.nextChunk;
    this.nextChunk = (this.nextChunk + 1) % CHUNK_SLOTS;
    const old = this.chunkBody[slot];
    if (old) this.debris.retire(old);
    const b = this.debris.add({
      shape: 'sphere',
      ref: slot,
      pos,
      quat: _q.setFromAxisAngle(_d.set(this.rng() - 0.5, this.rng() - 0.5, this.rng() - 0.5).normalize(), this.rng() * 6),
      vel,
      spin: _w.set(this.rng() - 0.5, this.rng() - 0.5, this.rng() - 0.5).multiplyScalar(10),
      half: [r, r, r],
      mass: (4 / 3) * Math.PI * r * r * r * 2600,
      chain,
      depth,
      hits: r > 0.28,
    });
    this.chunkBody[slot] = b;
    this.chunkVariant[slot] = variant < 0 ? (variant === -2 ? 255 : Math.floor(this.rng() * 4)) : variant;
    this.chunkRadius[slot] = r;
    this.chunkRock[slot] = -1;
    return slot;
  }

  /** Flying debris knocks things over: this is where chain reactions come from. */
  private debrisHits(b: Body) {
    if (!b.hits || b.cool > 0 || !b.active) return;
    const sp2 = b.v.lengthSq();
    if (sp2 < 16) return;
    if ((this.step + b.id) % 2) return;
    const sp = Math.sqrt(sp2);
    const reach = b.shape === 'sphere' ? b.half[0] : Math.max(b.half[0], b.half[1], b.half[2]) * 0.7;
    const L = this.layout;
    const chain = b.chain > 0 ? b.chain : (b.chain = this.newChain());
    for (const id of this.query(0, b.p.x, b.p.z, reach + 1, this.qTrees)) {
      if (this.treeState[id] >= 2) continue;
      const t = L.trees[id];
      if (Math.hypot(t.x - b.p.x, t.z - b.p.z) > reach + t.r + 0.1) continue;
      if (b.p.y > t.y + t.h * 0.8) continue;
      const E = Math.min(1, (b.mass * sp) / 26000);
      this.fellTree(id, b.v.x, b.v.z, E, chain, b.depth);
      b.v.multiplyScalar(0.55);
      b.cool = 18;
      return;
    }
    for (const sid of this.query(2, b.p.x, b.p.z, reach + 8, this.qStructs)) {
      const st = this.structs[sid];
      const def = st.def;
      const ex = b.p.x - def.x,
        ez = b.p.z - def.z;
      const c = Math.cos(def.yaw),
        sn = Math.sin(def.yaw);
      const lx = ex * c - ez * sn,
        lz = ex * sn + ez * c;
      if (Math.abs(lx) > def.hx + reach || Math.abs(lz) > def.hz + reach) continue;
      if (b.p.y > def.y + def.height + reach) continue;
      if (st.def.parts.includes(b.ref) && b.shape !== 'sphere') continue;
      const m = this.blast(st, b.p, reach + 0.7, _v.copy(b.v).multiplyScalar(0.7), chain, b.depth);
      if (m > 0) {
        b.v.multiplyScalar(0.5);
        b.cool = 12;
        if (b.mass > 300) this.emit({ type: 'hit', pos: [b.p.x, b.p.y, b.p.z], intensity: Math.min(1, (b.mass * sp) / 20000), label: def.name, id: def.id, depth: b.depth });
        return;
      }
    }
  }

  // ------------------------------------------------------------------ the end

  /** after the run: let the wreckage finish falling */
  settle() {
    this.step++;
    this.time += DT;
    this.updateTrees();
    this.updateStructures();
    this.debris.step(DT);
    this.drainEvents();
  }

  private checkEnd() {
    if (this.endT >= 0 && this.time >= this.endT) {
      this.finish(this.shattered ? 'shattered' : 'finished');
      return;
    }
    if (this.endT >= 0) return;
    if (this.kind === 'finale' && this.finaleHit && this.v < 1.5) {
      this.endT = this.time + 2.2;
      return;
    }
    if (this.released && this.v < 1.2 && this.grounded) {
      this.stallT += DT;
      if (this.stallT > 1.6) {
        if (this.kind === 'finale') this.endT = this.time + 1.5;
        else this.finish('stalled');
      }
    } else this.stallT = 0;
    if (this.time > MAX_TIME) this.finish('time');
  }

  finish(reason: RunResult['reason']) {
    if (this.done) return;
    this.done = true;
    const finished = reason === 'finished';
    const variety = this.categories.size > 1 ? 750 * (this.categories.size - 1) + (this.categories.size >= 5 ? 1500 : 0) : 0;
    const completion = finished ? 5000 : 0;
    const distance = Math.round(this.stats.distance * 2);
    const speed = this.speedBonus();
    const destruction = Math.round(this.destruction);
    const chain = Math.round(this.chainBonus);
    const total = destruction + chain + variety + distance + speed + completion;
    const cause = finished
      ? this.stats.finaleFlattened
        ? `${cap(this.level.finale.name)} flattened at ${Math.round(this.stats.finaleSpeed * 3.6)} km/h`
        : `Reached ${this.level.finale.name}`
      : reason === 'shattered'
        ? `Shattered in ${this.seg.seg.name}`
        : reason === 'stalled'
          ? `Ran out of momentum in ${this.seg.seg.name}`
          : 'Out of time';
    this.trajectory.push([this.pos.x, this.pos.y, this.pos.z]);
    const top = [...this.highlights].sort((a, b) => b.points - a.points).slice(0, 4);
    this.result = {
      finished,
      reason,
      cause,
      composition: this.comp.id,
      score: { destruction, chain, variety, distance, speed, completion, total },
      stats: { ...this.stats },
      route: [...this.route],
      categories: [...this.categories],
      highlights: top,
      duration: this.time,
      integrity: this.integrity / this.maxIntegrity,
      trajectory: this.trajectory,
    };
    this.emit({ type: 'end', pos: [this.pos.x, this.pos.y, this.pos.z], intensity: 1, label: reason });
  }

  runToEnd(choices?: (d: Decision, sim: RunSim) => number | null, maxSteps = Math.ceil(MAX_TIME / DT) + 600): RunResult {
    this.release();
    while (!this.done && this.step < maxSteps) {
      if (choices && this.decision && this.decision.chosen === null) {
        const c = choices(this.decision, this);
        if (c !== null) this.choose(c);
      }
      this.stepOnce();
      this.drainEvents();
    }
    if (!this.done) this.finish('time');
    return this.result!;
  }
}
