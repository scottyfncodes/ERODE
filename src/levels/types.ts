import type { Vec2 } from '../sim/geom';

/** Surface materials. They set rolling resistance, dust colour and how the ground reads. */
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
  /** play area (detailed mesh) */
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
  /** lateral tilt: y += tilt * x, active between z range */
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
}

export type RockKind = 'granite' | 'sandstone' | 'basalt' | 'obsidian' | 'limestone' | 'ice';

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

/**
 * What a stretch of mountain is made of. Each kind plays differently:
 * - forest: dense timber; huge destruction, heavy resistance
 * - scree: open rock slope; fast, rocks to shatter, ledges to jump
 * - ravine: a narrow gorge; walls that bite, pillars and trestles that come down in chains
 * - camp: timber buildings to flatten
 * - loose: unstable ground; your passing sets off slides that keep destroying after you
 */
export type SegmentKind = 'summit' | 'forest' | 'scree' | 'ravine' | 'camp' | 'loose' | 'finale';

/** One stretch of the route graph, from one junction to the next. */
export interface Segment {
  id: string;
  kind: SegmentKind;
  name: string;
  /** centreline, downhill */
  path: Vec2[];
  /** the segments this one can lead into, ordered as the player sees them: left → right */
  next: string[];
  /** which side unstable ground rises on (loose segments): +1 = left (+x), -1 = right */
  slope?: 1 | -1;
  /** taken when the player makes no choice at the fork this segment starts from */
  fallLine?: boolean;
}

export type FinaleStyle = 'sawmill' | 'quarry' | 'lodge' | 'mine';

export interface Theme {
  /** trees along the routes */
  trees: 'conifer' | 'snowpine' | 'juniper';
  /** timber colour of buildings, in linear RGB */
  wood: [number, number, number];
  /** roof colour */
  roof: [number, number, number];
  /** what loose rock and rock pillars are made of */
  rock: RockKind;
  /** colour of dust thrown up by impacts */
  dust: [number, number, number];
}

export interface LevelDef {
  id: string;
  stage: string;
  name: string;
  environment: string;
  tagline: string;
  theme: Theme;
  terrain: TerrainSpec;
  water: WaterSpec[];
  atmos: AtmosKey[];
  palette?: TerrainPalette;
  look: { sunAzimuth: number; sunElevation: number };
  /** decorative tree scatter (the routes are kept clear of it) */
  forest: { count: number; seed: number; keepOut: { path: Vec2[]; width: number }[] };
  sea?: { level: number; shoreZ: number };
  /** where the boulder sits at the summit */
  boulder: { position: Vec2; radius: number; seed: number };
  /** the route graph */
  segments: Segment[];
  start: string;
  /** the set piece at the bottom */
  finale: { name: string; style: FinaleStyle };
  /** destruction score needed for each medal; reaching the bottom earns bronze */
  medals: { silver: number; gold: number; platinum: number };
}
