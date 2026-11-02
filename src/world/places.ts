import type { Vec2 } from '../sim/geom';

/**
 * The Kessel Valley: one alpine region, laid out by hand.
 * x runs east, z runs south, y is up (metres). North (-z) climbs into the high peaks;
 * the valley floor and the village are to the south.
 */

export const WORLD_HALF = 1000;

export interface Pad {
  id: string;
  name: string;
  x: number;
  z: number;
  /** flat radius */
  r: number;
  /** blend distance beyond r */
  blend: number;
  /** height of the flat (m) */
  h: number;
}

export const PADS: Pad[] = [
  { id: 'hq', name: 'Kessel Patrol Station', x: 0, z: 250, r: 62, blend: 45, h: 140 },
  { id: 'village', name: 'Hollin', x: 330, z: 470, r: 105, blend: 60, h: 96 },
  { id: 'resort', name: 'Tannberg Base', x: 540, z: 170, r: 55, blend: 45, h: 168 },
  { id: 'lifttop', name: 'Tannberg Top Station', x: 590, z: -330, r: 26, blend: 30, h: 455 },
  { id: 'station', name: 'Grauhorn Weather Station', x: -640, z: -300, r: 20, blend: 30, h: 312 },
  { id: 'cabin', name: 'Fernhut Cabin', x: 760, z: -60, r: 18, blend: 26, h: 268 },
  { id: 'ridge', name: 'Kessel Ridge', x: -215, z: -470, r: 26, blend: 30, h: 402 },
];

export const pad = (id: string): Pad => PADS.find((p) => p.id === id)!;

export const LAKE = { x: -430, z: 470, r: 125, h: 86, name: 'Mirror Lake' };

/** Roads and tracks the sled runs on; heights are derived from the ground. */
export interface Route {
  id: string;
  name: string;
  pts: Vec2[];
  /** half width of the flattened, packed surface */
  width: number;
  kind: 'road' | 'track' | 'piste';
}

export const ROUTES: Route[] = [
  {
    id: 'pass',
    name: 'Grauhorn Pass Road',
    kind: 'road',
    width: 5,
    pts: [
      [330, 470], [240, 400], [120, 330], [0, 250], [-60, 160], [-110, 40], [-150, -60], [-170, -120],
      [-260, -150], [-380, -160], [-480, -190], [-560, -240], [-640, -300],
    ],
  },
  {
    id: 'resort',
    name: 'Tannberg Road',
    kind: 'road',
    width: 4.5,
    pts: [[0, 250], [130, 245], [260, 225], [400, 195], [540, 170]],
  },
  {
    id: 'bowltrack',
    name: 'Kessel Ridge Track',
    kind: 'track',
    width: 3.5,
    pts: [[-300, -158], [-360, -215], [-300, -265], [-372, -310], [-312, -355], [-372, -400], [-300, -440], [-215, -470]],
  },
  {
    id: 'cabintrack',
    name: 'Fernhut Track',
    kind: 'track',
    width: 3,
    pts: [[540, 170], [620, 120], [690, 60], [740, -10], [760, -60]],
  },
  {
    id: 'piste',
    name: 'Tannberg Run',
    kind: 'piste',
    width: 16,
    pts: [[590, -330], [560, -250], [600, -170], [560, -80], [520, 10], [560, 90], [540, 170]],
  },
  {
    id: 'backside',
    name: 'Tannberg Back Track',
    kind: 'track',
    width: 3,
    pts: [[598, -330], [622, -326], [642, -316], [656, -300], [662, -280]],
  },
  {
    id: 'lake',
    name: 'Lake Trail',
    kind: 'track',
    width: 3,
    pts: [[120, 330], [20, 380], [-120, 420], [-260, 450], [-330, 460]],
  },
];

export const route = (id: string): Route => ROUTES.find((r) => r.id === id)!;

/** The Tannberg chairlift: base to top station. */
export const LIFT = { from: [548, 150] as Vec2, to: [588, -310] as Vec2 };

/**
 * Kessel Bowl: a classic avalanche path above the pass road.
 * The start zone is a steep slab under the ridge; the track runs south; a deflection berm
 * (built long before you) sits in the runout between it and the road.
 */
export const BOWL = {
  cx: -120,
  /** north edge (ridge) and south edge (runout) of the designed slope */
  zTop: -480,
  zBottom: -150,
  halfWidth: 150,
  /** start zone, where the slab sits */
  slab: { x0: -205, x1: -35, z0: -430, z1: -355 },
  /** profile down the bowl: [z, height] */
  profile: [
    [-500, 420],
    [-470, 404],
    [-430, 378],
    [-355, 318],
    [-290, 268],
    [-235, 236],
    [-200, 222],
    [-160, 214],
    [-130, 205],
  ] as [number, number][],
  /** the berm: a low earth wall across the runout, protecting the road */
  berm: { z: -172, x0: -225, x1: -15, height: 9, thick: 10 },
  /** stand back this far south of the start zone before firing */
  safeZ: -300,
};

/** Spots where charges can go: the two weak zones and two that are fine. */
export const CHARGE_SPOTS: { id: string; x: number; z: number; weak: boolean; label: string }[] = [
  { id: 'A', x: -175, z: -405, weak: true, label: 'Slope A' },
  { id: 'B', x: -125, z: -425, weak: false, label: 'Slope B' },
  { id: 'C', x: -80, z: -395, weak: true, label: 'Slope C' },
  { id: 'D', x: -45, z: -420, weak: false, label: 'Slope D' },
];

/**
 * Gentle tilted shelves shaped into steeper ground, where something has to be reachable:
 * the forested back side of the Tannberg, where skiers go when they should not.
 */
export const SHELVES: { x: number; z: number; r: number; blend: number; h: number; gx: number; gz: number }[] = [
  { x: 648, z: -238, r: 62, blend: 46, h: 404, gx: -0.04, gz: -0.17 },
];

/** Stands of trees planted on purpose, with clearings kept open (where Nils sits). */
export const GROVES: { x: number; z: number; r: number; step: number; clear: { x: number; z: number; r: number }[] }[] = [
  { x: 648, z: -232, r: 58, step: 7.5, clear: [{ x: 640, z: -220, r: 6 }] },
];

/** Named mountains for the map. */
export const PEAKS: { name: string; x: number; z: number; h: number; r: number }[] = [
  { name: 'Grauhorn', x: -430, z: -700, h: 360, r: 260 },
  { name: 'Weisskopf', x: 310, z: -760, h: 420, r: 280 },
  { name: 'Hornli', x: 860, z: -320, h: 240, r: 200 },
  { name: 'Westwand', x: -860, z: -40, h: 210, r: 220 },
  { name: 'Kessel Spitz', x: -120, z: -640, h: 210, r: 150 },
];

/** Village buildings: [x, z, rot, kind]. */
export const VILLAGE: { x: number; z: number; rot: number; kind: 'lodge' | 'house' | 'clinic' | 'shop' | 'chapel' }[] = [
  { x: 330, z: 455, rot: 0.2, kind: 'lodge' },
  { x: 380, z: 500, rot: -0.4, kind: 'clinic' },
  { x: 285, z: 505, rot: 0.6, kind: 'shop' },
  { x: 400, z: 430, rot: 1.1, kind: 'house' },
  { x: 250, z: 450, rot: -0.2, kind: 'house' },
  { x: 345, z: 540, rot: 0.1, kind: 'house' },
  { x: 420, z: 545, rot: -0.9, kind: 'chapel' },
  { x: 240, z: 545, rot: 0.4, kind: 'house' },
  { x: 300, z: 410, rot: 1.6, kind: 'house' },
];

/** Height above sea level shown on maps and instruments (the valley floor sits at about 1,400 m). */
export const elevation = (y: number) => Math.round(1180 + y * 2.6);
