import type { Vec2 } from '../sim/geom';

/** Surface materials. Hardness scales how violently an impact loads the rock. */
export type SurfaceKind = 'meadow' | 'soil' | 'scree' | 'bedrock' | 'streambed' | 'snow' | 'sand' | 'mud' | 'ash' | 'ice';

export interface CarveFeature {
  type: 'carve' | 'ridge';
  path: Vec2[];
  width: number;
  depth: number;
  /** metres over which the feature fades in at the start / out at the end */
  taper?: [number, number];
  surface?: SurfaceKind;
}

export interface MoundFeature {
  type: 'mound';
  center: Vec2;
  radius: number;
  /** negative for a hollow */
  height: number;
  /** stretch of the ellipse along x / z */
  scale?: Vec2;
  surface?: SurfaceKind;
}

/** A ledge across a route: half the height is built up above the lip, half cut away below it. */
export interface DropFeature {
  type: 'drop';
  path: Vec2[];
  halfWidth: number;
  /** z where the ledge lip is */
  lipZ: number;
  drop: number;
  /** length (in z) of the ramp up to the plateau above the lip */
  rampLength: number;
  /** length (in z) over which the ground below the cliff rejoins the slope */
  rejoin: number;
  surface?: SurfaceKind;
}

export type TerrainFeature = CarveFeature | MoundFeature | DropFeature;

export interface Peak {
  x: number;
  z: number;
  radius: number;
  height: number;
}

export interface TerrainSpec {
  /** play area (physics + detailed mesh) */
  bounds: { x: [number, number]; z: [number, number] };
  cell: number;
  /** (z, y) base elevation profile, z increasing downhill */
  profile: [number, number][];
  /** lateral bowl: y += k * x^2, faded out between fade[0]..fade[1] in z */
  bowl: { k: number; fade: [number, number] };
  /** the run's centreline; when present the bowl is shaped around it instead of x = 0 */
  course?: Vec2[];
  /** (z, k) valley steepness along the course: y += k * min(d, cap)^2 */
  valley?: { k: [number, number][]; cap: number };
  /** default ground per stretch of the course */
  zoneSurfaces?: { z: [number, number]; surface: SurfaceKind }[];
  /** lateral tilt near the stream so it flows: y += tilt * x, active between z range */
  tilt: { amount: number; z: [number, number] };
  noise: { amp: number; scale: number }[];
  features: TerrainFeature[];
  peaks: Peak[];
  snowLine: number;
}

export interface WaterSpec {
  id: string;
  name: string;
  kind: 'stream' | 'rill';
  path: Vec2[];
  width: number;
  /** water depth above the bed centre line */
  depth: number;
  flowSpeed: number;
  /** objective target */
  goal?: boolean;
  /** this water only runs when a gate object is in the given state */
  activeWhen?: { object: string; state: string };
}

export type ObjectType = 'rock' | 'log' | 'branches' | 'tree' | 'soil' | 'outcrop' | 'ice' | 'gate';

interface BaseObject {
  id: string;
  type: ObjectType;
  name: string;
  /** one-line description of what it is / does */
  hint: string;
}

export interface RockObject extends BaseObject {
  type: 'rock';
  position: Vec2;
  radius: number;
  seed: number;
  /** how far from its start it may be dragged */
  moveRadius: number;
}

export interface LogObject extends BaseObject {
  type: 'log';
  position: Vec2;
  yaw: number; // radians, 0 = lying along +x
  length: number;
  radius: number;
  moveRadius: number;
  seed: number;
}

export interface BranchesObject extends BaseObject {
  type: 'branches';
  position: Vec2;
  yaw: number;
  span: number;
  seed: number;
  /** how it looks: a tangle of branches, a stack of trunks, or a beaver dam */
  style?: 'deadfall' | 'logjam' | 'beaver' | 'debris' | 'fence' | 'trestle';
  /** barrier height (m) */
  height?: number;
  /**
   * Momentum (kg·m/s) needed to smash straight through it during the descent.
   * Absent: it only gives way to a planned clear.
   */
  breakMomentum?: number;
}

export interface TreeObject extends BaseObject {
  type: 'tree';
  position: Vec2;
  height: number;
  radius: number;
  /** fell directions offered to the player (name → yaw of the fallen trunk direction) */
  fellOptions: { id: string; label: string; yaw: number }[];
  seed: number;
}

export interface SoilObject extends BaseObject {
  type: 'soil';
  position: Vec2;
  radius: [number, number];
  height: number;
  yaw: number;
  /** what the bank is: earth (default), a snowbank or an ash drift — all cushion an impact */
  material?: 'soil' | 'snow' | 'ash';
  /** if this water is running, the bank is saturated and slumps when struck */
  saturatedBy?: string;
  seed: number;
}

export interface OutcropObject extends BaseObject {
  /** a breaker: harder granite that smashes stone */
  hardness?: number;
  /** label used for the action button */
  actionLabel?: string;
  /** what it's made of (look) */
  rock?: RockKind;
  type: 'outcrop';
  position: Vec2;
  size: [number, number, number];
  yaw: number;
  /** where the split-off block comes to rest */
  splitTo: Vec2;
  seed: number;
}

export interface IceObject extends BaseObject {
  type: 'ice';
  center: Vec2;
  size: Vec2;
  yaw: number;
  seed: number;
}

export interface GateObject extends BaseObject {
  type: 'gate';
  position: Vec2;
  options: { id: string; label: string }[];
  initial: string;
}

export type LevelObject =
  | RockObject
  | LogObject
  | BranchesObject
  | TreeObject
  | SoilObject
  | OutcropObject
  | IceObject
  | GateObject;

/** Fixed, non-interactive rock formations. */
export interface Formation {
  id: string;
  name: string;
  position: Vec2;
  size: [number, number, number];
  yaw: number;
  seed: number;
  hardness: number;
  /** sink into the ground by this many metres */
  sink?: number;
  /** a level table of rock: sits on the highest ground beneath it instead of its centre */
  flat?: boolean;
  /** what it is made of (look + material behaviour) */
  rock?: RockKind;
  /** one side of a narrow passage (named in the cause when a stone wedges there) */
  gap?: boolean;
}

export type RockKind = 'granite' | 'sandstone' | 'basalt' | 'obsidian' | 'limestone' | 'ice';

/** A named way down. The run is credited with a route once it passes every gate in order. */
export interface RouteDef {
  id: string;
  name: string;
  /** one line for the planning card */
  hint: string;
  /** boxes in x/z the boulder must pass through */
  gates: { x: [number, number]; z: [number, number] }[];
  /** waypoints for the demo pilot and the survey flyover */
  path: Vec2[];
}

export type ObjectiveDef =
  | { id: string; type: 'noTrees'; label: string }
  | { id: string; type: 'route'; route: string; label: string }
  | { id: string; type: 'smash'; object: string; label: string }
  | { id: string; type: 'speed'; kmh: number; label: string }
  | { id: string; type: 'retain'; fraction: number; label: string }
  | { id: string; type: 'moves'; max: number; label: string }
  | { id: string; type: 'noMajor'; label: string }
  | { id: string; type: 'time'; seconds: number; label: string };

/** Light and air for a stretch of a level, keyed by z. */
export interface AtmosKey {
  z: number;
  fog: [number, number, number];
  density: number;
  sky: [number, number, number];
  zenith: [number, number, number];
  ground: [number, number, number];
  sun: [number, number, number];
  sunI: number;
  hemiI: number;
  exposure: number;
}

/** Terrain colour overrides for an environment. */
export type TerrainPalette = Partial<Record<SurfaceKind | 'forest' | 'rock' | 'strata' | 'valley', [number, number, number]>>;

export interface Region {
  name: string;
  /** axis aligned box in x/z */
  x: [number, number];
  z: [number, number];
}

export interface Zone {
  id: string;
  name: string;
  z: [number, number];
}

export interface LevelDef {
  /** environment name shown on the level card */
  environment: string;
  /** medal thresholds: fraction of starting mass retained */
  medals: { silver: number; gold: number; platinum: number };
  objectives: ObjectiveDef[];
  routes: RouteDef[];
  /** crossing this z (inside x, if given) finishes the descent */
  finish: { z: number; x?: [number, number]; name: string };
  atmos: AtmosKey[];
  palette?: TerrainPalette;
  /**
   * Narrow passages. A stone fits when its diameter (2 × radius) is no wider than `width`;
   * otherwise it wedges there and the run ends. Build the walls a little wider apart than the
   * widest a tumbling stone could be, and let this rule decide.
   */
  passages?: { name: string; x: number; z: number; width: number }[];
  /** named sections of the descent (survey chips, HUD) */
  zones?: Zone[];
  /** smashable pines and loose stones along the run */
  props?: { trees: { z: [number, number]; density: number }[]; rocks: number; spread?: number };
  sea?: { level: number; shoreZ: number };
  /** the beach: landing here finishes the run */
  beach?: { z: [number, number] };
  /** live nudges available during a run */
  nudges?: number;
  id: string;
  stage: string;
  name: string;
  tagline: string;
  objectiveText: string;
  terrain: TerrainSpec;
  boulder: { position: Vec2; radius: number; seed: number; push: [number, number, number] };
  water: WaterSpec[];
  objects: LevelObject[];
  formations: Formation[];
  regions: Region[];
  /** planning moves available */
  budget: number;
  /** decorative tree scatter */
  forest: { count: number; seed: number; keepOut: { path: Vec2[]; width: number }[] };
  camera: { target: [number, number, number]; yaw: number; pitch: number; distance: number };
  /** time-of-day look */
  look: { sunAzimuth: number; sunElevation: number };
}

/** Per-object player state. Absent means default. */
export type ObjectState =
  | { type: 'rock'; removed: boolean; x: number; z: number }
  | { type: 'log'; yaw: number; x: number; z: number }
  | { type: 'branches'; removed: boolean }
  | { type: 'tree'; felled: string | null }
  | { type: 'soil'; dug: boolean }
  | { type: 'outcrop'; split: boolean }
  | { type: 'ice'; broken: boolean }
  | { type: 'gate'; option: string };

export type Plan = Record<string, ObjectState>;
