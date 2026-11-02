import type { LevelDef, Plan } from './types';

const deg = Math.PI / 180;

// x = across, y = up, z = downhill.
// The meadow at the top splits around a rocky rib: the Forest Track (left, x < 0) is soft but
// crowded with pines and blocked by a log jam; the Scree Gully (right) is open and fast but
// littered with granite. They meet above the Ledge — a bedrock step — and run out to the hollow.
const COURSE: [number, number][] = [
  [0, -30],
  [0, 0],
  [0, 50],
  [0, 120],
  [0, 180],
  [-2, 240],
  [0, 300],
  [0, 360],
];

const FOREST: [number, number][] = [
  [0, -6],
  [-3, 40],
  [-11, 70],
  [-12, 110],
  [-10, 150],
  [-4, 180],
  [-7, 214],
  [-7, 240],
  [0, 300],
  [0, 340],
];
const GULLY: [number, number][] = [
  [0, -6],
  [3, 40],
  [11, 70],
  [12, 110],
  [10, 150],
  [4, 180],
  [-7, 214],
  [-7, 240],
  [0, 300],
  [0, 340],
];

export const PINE_HOLLOW: LevelDef = {
  id: 'pine-hollow',
  stage: 'I',
  environment: 'Alpine Forest',
  name: 'Pine Hollow',
  tagline: 'A gentle forest descent. Learn what the mountain takes — and what it gives back.',
  objectiveText: 'Reach the hollow with as much of yourself as you can.',
  medals: { silver: 0.85, gold: 0.92, platinum: 0.96 },
  budget: 3,
  finish: { z: 300, name: 'the hollow' },
  objectives: [
    { id: 'route-gully', type: 'route', route: 'gully', label: 'Take the Scree Gully' },
    { id: 'route-forest', type: 'route', route: 'forest', label: 'Take the Forest Track' },
    { id: 'smash-jam', type: 'smash', object: 'logjam', label: 'Burst through the log jam' },
    { id: 'no-trees', type: 'noTrees', label: 'Finish without touching a tree' },
    { id: 'retain', type: 'retain', fraction: 0.94, label: 'Keep 94% of your mass' },
  ],
  routes: [
    {
      id: 'forest',
      name: 'Forest Track',
      hint: 'Soft ground under the pines — but a log jam bars the way.',
      gates: [
        { x: [-30, -4], z: [95, 125] },
        { x: [-30, -2], z: [140, 160] },
      ],
      path: FOREST,
    },
    {
      id: 'gully',
      name: 'Scree Gully',
      hint: 'Open and quick, and strewn with granite.',
      gates: [
        { x: [4, 30], z: [95, 125] },
        { x: [2, 30], z: [140, 160] },
      ],
      path: GULLY,
    },
  ],
  zones: [
    { id: 'meadow', name: 'High Meadow', z: [-30, 60] },
    { id: 'fork', name: 'The Fork', z: [60, 175] },
    { id: 'ledge', name: 'The Ledge', z: [175, 250] },
    { id: 'hollow', name: 'The Hollow', z: [250, 360] },
  ],
  props: {
    trees: [
      { z: [60, 165], density: 0.6 },
      { z: [250, 310], density: 0.25 },
    ],
    rocks: 0,
    spread: 18,
  },
  terrain: {
    bounds: { x: [-44, 44], z: [-44, 372] },
    cell: 1.0,
    course: COURSE,
    valley: {
      cap: 40,
      k: [
        [-60, 0.01],
        [0, 0.008],
        [60, 0.006],
        [170, 0.006],
        [260, 0.006],
        [380, 0.004],
      ],
    },
    profile: [
      [-160, 200],
      [-40, 140],
      [-14, 131],
      [0, 127],
      [40, 113],
      [100, 94],
      [160, 76],
      [204, 63],
      [207, 59.5],
      [215, 57.5],
      [260, 45],
      [300, 36],
      [330, 31],
      [372, 28],
      [500, 22],
    ],
    bowl: { k: 0, fade: [0, 1] },
    tilt: { amount: 0, z: [0, 1] },
    noise: [
      { amp: 0.9, scale: 24 },
      { amp: 0.25, scale: 6 },
    ],
    zoneSurfaces: [
      { z: [60, 170], surface: 'soil' },
      { z: [306, 400], surface: 'mud' },
    ],
    features: [
      // the summit shelf the boulder rests on
      { type: 'mound', center: [0, -14], radius: 7, height: -0.6, surface: 'bedrock' },
      // the rocky rib that splits the fork
      { type: 'ridge', path: [[0, 52], [0, 90], [0, 140], [-1, 168]], width: 8, depth: 4.5, taper: [14, 10], surface: 'bedrock' },
      // the gully: a scree trough on the right
      { type: 'carve', path: [[4, 40], [11, 70], [12, 110], [10, 150], [4, 182], [1, 200]], width: 7, depth: 1.4, taper: [10, 24], surface: 'scree' },
      // the forest track: a soft hollow on the left
      { type: 'carve', path: [[-3, 40], [-11, 70], [-12, 110], [-10, 150], [-5, 182], [-6, 200]], width: 8, depth: 1.0, taper: [10, 24], surface: 'soil' },
      // the ledge: a bedrock step across the run; softer earth on its left shoulder
      { type: 'mound', center: [5, 208], radius: 10, height: 0.5, scale: [1.6, 0.6], surface: 'bedrock' },
      { type: 'mound', center: [-10, 214], radius: 9, height: -0.3, scale: [1, 1.3], surface: 'soil' },
    ],
    peaks: [
      { x: 0, z: -150, radius: 80, height: 70 },
      { x: -120, z: 40, radius: 70, height: 60 },
      { x: 130, z: 120, radius: 80, height: 55 },
      { x: -140, z: 300, radius: 90, height: 45 },
    ],
    snowLine: 165,
  },
  boulder: { position: [0, -14], radius: 0.98, seed: 1311, push: [0, 0, 3.5] },
  water: [],
  objects: [
    {
      id: 'loose-gully',
      type: 'rock',
      name: 'Loose boulder',
      hint: 'A granite boulder sitting square in the gully line. Drag it aside — or lever it off the mountain.',
      position: [11.5, 96],
      radius: 1.1,
      seed: 77,
      moveRadius: 7,
    },
    {
      id: 'logjam',
      type: 'branches',
      style: 'logjam',
      name: 'Log jam',
      hint: 'Storm-felled trunks across the forest track. Clear it — or hit it hard enough to burst through.',
      position: [-11.5, 124],
      yaw: 0,
      span: 14,
      height: 2.6,
      seed: 501,
      breakMomentum: 72000,
    },
    {
      id: 'old-pine',
      type: 'tree',
      name: 'The old pine',
      hint: 'A huge pine at the head of the fork. Fell it into one entrance to shut that way — and steer the boulder into the other.',
      position: [0, 56],
      height: 16,
      radius: 0.55,
      seed: 41,
      fellOptions: [
        { id: 'gully', label: 'Across the gully', yaw: 20 * deg },
        { id: 'forest', label: 'Across the forest', yaw: 160 * deg },
      ],
    },
    {
      id: 'ledge-log',
      type: 'log',
      name: 'Fallen trunk',
      hint: 'A trunk on the brink of the Ledge. Angle it to guide the boulder onto the soft shoulder instead of the bare rock.',
      position: [8, 194],
      yaw: 95 * deg,
      length: 9,
      radius: 0.45,
      moveRadius: 8,
      seed: 12,
    },
  ],
  formations: [
    { id: 'gully-1', name: 'a granite block', position: [8, 132], size: [2.6, 2.2, 2.4], yaw: 20 * deg, seed: 601, hardness: 1.8, sink: 0.7 },
    { id: 'gully-2', name: 'a granite block', position: [14, 150], size: [2.4, 2.0, 2.4], yaw: -15 * deg, seed: 602, hardness: 1.8, sink: 0.7 },
    { id: 'gully-3', name: 'a granite block', position: [13.5, 78], size: [2.2, 1.8, 2.2], yaw: 40 * deg, seed: 603, hardness: 1.8, sink: 0.7 },
    { id: 'hollow-1', name: 'a mossy boulder', position: [6, 270], size: [2.6, 2.2, 2.4], yaw: 10 * deg, seed: 604, hardness: 1.5, sink: 0.6 },
    { id: 'summit', name: 'the summit crag', position: [-7, -22], size: [6, 9, 5], yaw: 8 * deg, seed: 605, hardness: 1.2, sink: 1.2 },
  ],
  regions: [
    { name: 'the high meadow', x: [-60, 60], z: [-60, 60] },
    { name: 'the forest track', x: [-60, -2], z: [60, 175] },
    { name: 'the scree gully', x: [-2, 60], z: [60, 175] },
    { name: 'the ledge', x: [-60, 60], z: [175, 250] },
    { name: 'the hollow', x: [-60, 60], z: [250, 400] },
  ],
  forest: {
    count: 900,
    seed: 311,
    keepOut: [{ path: COURSE, width: 26 }],
  },
  camera: { target: [0, 95, 80], yaw: 0, pitch: 50 * deg, distance: 95 },
  look: { sunAzimuth: 130 * deg, sunElevation: 34 * deg },
  atmos: [
    { z: -40, fog: [0.8, 0.88, 0.97], density: 0.0016, sky: [0.8, 0.9, 1.0], zenith: [0.16, 0.44, 0.95], ground: [0.45, 0.48, 0.4], sun: [1.0, 0.96, 0.9], sunI: 2.8, hemiI: 1.0, exposure: 0.93 },
    { z: 120, fog: [0.62, 0.74, 0.64], density: 0.0026, sky: [0.74, 0.86, 0.82], zenith: [0.24, 0.5, 0.82], ground: [0.32, 0.38, 0.22], sun: [1.0, 0.92, 0.76], sunI: 2.5, hemiI: 1.05, exposure: 0.97 },
    { z: 330, fog: [0.86, 0.84, 0.72], density: 0.0019, sky: [0.92, 0.88, 0.78], zenith: [0.26, 0.5, 0.86], ground: [0.46, 0.42, 0.28], sun: [1.0, 0.88, 0.68], sunI: 2.7, hemiI: 0.95, exposure: 0.99 },
  ],
};

/** Candidate plans for balancing (scripts/balance.ts). */
export const PINE_HOLLOW_TESTS: { name: string; route: string; plan: Plan }[] = [
  { name: 'gully as found', route: 'gully', plan: {} },
  { name: 'forest as found', route: 'forest', plan: {} },
  { name: 'gully, rock moved', route: 'gully', plan: { 'loose-gully': { type: 'rock', removed: true, x: 11.5, z: 96 } } },
  { name: 'forest, jam cleared', route: 'forest', plan: { logjam: { type: 'branches', removed: true } } },
  { name: 'gully, rock moved, log guide', route: 'gully', plan: { 'loose-gully': { type: 'rock', removed: true, x: 11.5, z: 96 }, 'ledge-log': { type: 'log', yaw: 2.36, x: 2, z: 197 } } },
  { name: 'forest, jam cleared, log guide', route: 'forest', plan: { logjam: { type: 'branches', removed: true }, 'ledge-log': { type: 'log', yaw: 2.36, x: 2, z: 197 } } },
  { name: 'forest, pine across gully', route: 'forest', plan: { 'old-pine': { type: 'tree', felled: 'gully' } } },
];
