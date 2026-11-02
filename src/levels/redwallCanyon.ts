import type { LevelDef, Plan } from './types';

const deg = Math.PI / 180;

// x = across, y = up, z = downhill.
// A red sandstone canyon. Off the rim the slickrock splits round a rib: the River Channel
// (right, x > 0) carries the stream — fast and smooth but hard to steer, with a loose rock in
// the rapids — and the Dry Bench (left) is a ledge above it, crossed by mud flats and barred
// at its foot by an old ore trestle. A sluice at the fork can send the water down the bench's
// old flume instead (drying the river). Both meet above the Pour-off, a sandstone step into the
// lower wash, where the water has worn a chute — with a chockstone jammed at its head.
const COURSE: [number, number][] = [
  [0, -30],
  [0, 0],
  [0, 60],
  [0, 120],
  [0, 180],
  [0, 215],
  [2, 260],
  [0, 320],
  [0, 380],
];

const RIVER: [number, number][] = [
  [0, -6],
  [2, 40],
  [10, 70],
  [12, 110],
  [11, 150],
  [9, 180],
  [3, 205],
  [1.5, 228],
  [2, 245],
  [2, 270],
  [0, 330],
];
const BENCH: [number, number][] = [
  [0, -6],
  [-2, 40],
  [-10, 70],
  [-12, 110],
  [-11, 150],
  [-9, 180],
  [-4, 205],
  [1, 226],
  [2, 245],
  [2, 270],
  [0, 330],
];

// the water courses
const RIVER_BED: [number, number][] = [
  [1, 34],
  [4, 52],
  [10, 70],
  [12, 110],
  [11, 150],
  [9, 180],
  [3, 205],
  [1, 218],
];
const FLUME_BED: [number, number][] = [
  [-4, 52],
  [-10, 70],
  [-12, 110],
  [-11, 150],
  [-9, 180],
  [-3, 205],
  [-1, 218],
];
const WASH_BED: [number, number][] = [
  [0, 196],
  [1, 235],
  [2, 270],
  [0, 340],
];

export const REDWALL_CANYON: LevelDef = {
  id: 'redwall-canyon',
  stage: 'IV',
  environment: 'Canyon Descent',
  name: 'Redwall Canyon',
  tagline: 'Red rock, fast water. The river carries you — whether you like it or not.',
  objectiveText: 'Ride the canyon down to the wash. Choose where the water runs.',
  medals: { silver: 0.68, gold: 0.82, platinum: 0.91 },
  budget: 3,
  finish: { z: 320, name: 'the wash' },
  objectives: [
    { id: 'route-river', type: 'route', route: 'river', label: 'Run the River Channel' },
    { id: 'route-bench', type: 'route', route: 'bench', label: 'Take the Dry Bench' },
    { id: 'smash-trestle', type: 'smash', object: 'trestle', label: 'Smash through the ore trestle' },
    { id: 'time', type: 'time', seconds: 44, label: 'Reach the wash in 44 seconds' },
    { id: 'no-major', type: 'noMajor', label: 'No major hits' },
  ],
  routes: [
    {
      id: 'river',
      name: 'River Channel',
      hint: 'The current carries you fast and smooth — but it steers for you, wears you down, and drives you at the rapids rock.',
      gates: [
        { x: [4, 30], z: [95, 125] },
        { x: [3, 30], z: [150, 175] },
      ],
      path: RIVER,
    },
    {
      id: 'bench',
      name: 'Dry Bench',
      hint: 'A dry ledge above the water: full control, but mud flats that swallow momentum and an old trestle across the end.',
      gates: [
        { x: [-30, -4], z: [95, 125] },
        { x: [-30, -3], z: [150, 175] },
      ],
      path: BENCH,
    },
  ],
  zones: [
    { id: 'rim', name: 'The Rim', z: [-30, 60] },
    { id: 'narrows', name: 'The Narrows', z: [60, 200] },
    { id: 'pouroff', name: 'The Pour-off', z: [200, 260] },
    { id: 'wash', name: 'The Wash', z: [260, 380] },
  ],
  props: { trees: [], rocks: 0 },
  palette: {
    meadow: [0.72, 0.46, 0.3],
    soil: [0.6, 0.36, 0.24],
    scree: [0.7, 0.42, 0.28],
    bedrock: [0.66, 0.3, 0.2],
    streambed: [0.5, 0.36, 0.27],
    sand: [0.88, 0.68, 0.46],
    mud: [0.44, 0.29, 0.21],
    rock: [0.7, 0.33, 0.21],
    strata: [0.82, 0.5, 0.32],
    valley: [0.64, 0.38, 0.24],
    forest: [0.38, 0.4, 0.24],
  },
  terrain: {
    bounds: { x: [-46, 46], z: [-44, 372] },
    cell: 1.0,
    course: COURSE,
    valley: {
      cap: 40,
      k: [
        [-60, 0.012],
        [0, 0.012],
        [60, 0.02],
        [200, 0.02],
        [260, 0.014],
        [380, 0.008],
      ],
    },
    profile: [
      [-160, 215],
      [-40, 160],
      [-14, 150],
      [0, 146],
      [30, 137],
      [60, 127],
      [90, 119],
      [105, 115.5],
      [150, 106.5],
      [175, 100.5],
      [210, 92.5],
      [236, 86],
      [280, 77],
      [330, 68],
      [372, 63],
      [500, 53],
    ],
    bowl: { k: 0, fade: [0, 1] },
    tilt: { amount: 0, z: [0, 1] },
    noise: [
      { amp: 0.5, scale: 24 },
      { amp: 0.25, scale: 6 },
    ],
    zoneSurfaces: [
      { z: [-60, 236], surface: 'bedrock' },
      { z: [236, 400], surface: 'sand' },
    ],
    features: [
      // the rim shelf the boulder rests on
      { type: 'mound', center: [0, -14], radius: 7, height: -0.6, surface: 'bedrock' },
      // the sandstone rib between river and bench
      { type: 'ridge', path: [[0, 56], [0, 90], [0, 140], [0, 196]], width: 8, depth: 5, taper: [14, 12], surface: 'bedrock' },
      // the river channel: a deep, water-polished slot on the right
      { type: 'carve', path: RIVER_BED, width: 8, depth: 2.6, taper: [26, 24], surface: 'streambed' },
      // the bench: a shallow ledge on the left (the old flume ditch runs along it)
      { type: 'carve', path: FLUME_BED, width: 9, depth: 1.0, taper: [10, 16], surface: 'bedrock' },
      // the mud flats: a soft hollow on the bench, and the lip at its foot
      { type: 'mound', center: [-12, 120], radius: 11, height: -0.5, scale: [0.75, 0.7], surface: 'mud' },
      { type: 'mound', center: [-11.5, 131], radius: 5, height: 0.4, scale: [1.3, 0.8], surface: 'mud' },
      // the wash channel below the confluence
      { type: 'carve', path: WASH_BED, width: 9, depth: 1.6, taper: [6, 0], surface: 'streambed' },
      // the Pour-off: a sandstone step across the canyon
      { type: 'drop', path: [[0, 200], [1, 235], [2, 270]], halfWidth: 30, lipZ: 236, drop: 2.0, rampLength: 12, rejoin: 6, surface: 'bedrock' },
      // the river has worn the pour-off into a chute on the right
      { type: 'mound', center: [2, 240], radius: 5, height: 0.9, scale: [1.2, 1.3], surface: 'streambed' },
    ],
    peaks: [
      { x: 0, z: -150, radius: 80, height: 60 },
      { x: -120, z: 60, radius: 70, height: 70 },
      { x: 120, z: 150, radius: 80, height: 65 },
      { x: -130, z: 300, radius: 90, height: 50 },
    ],
    snowLine: 999,
  },
  boulder: { position: [0, -14], radius: 1.0, seed: 4417, push: [0, 0, 3.5] },
  water: [
    {
      id: 'river',
      name: 'the river',
      kind: 'stream',
      path: RIVER_BED,
      width: 7,
      depth: 1.3,
      flowSpeed: 9.5,
      activeWhen: { object: 'sluice', state: 'river' },
    },
    {
      id: 'flume',
      name: 'the flume',
      kind: 'stream',
      path: FLUME_BED,
      width: 7,
      depth: 0.9,
      flowSpeed: 8,
      activeWhen: { object: 'sluice', state: 'flume' },
    },
    { id: 'wash', name: 'the wash stream', kind: 'stream', path: WASH_BED, width: 8, depth: 0.8, flowSpeed: 7 },
  ],
  objects: [
    {
      id: 'chockstone',
      type: 'outcrop',
      name: 'Chockstone',
      hint: 'A block jammed in the head of the water chute. Hit it and it hurts — lever it off the lip and the chute is a smooth ride down the Pour-off.',
      actionLabel: 'Lever it off the lip',
      hardness: 1.0,
      position: [3.4, 232],
      size: [2.4, 2.2, 2.4],
      yaw: 30 * deg,
      splitTo: [-8, 233],
      seed: 92,
    },
    {
      id: 'sluice',
      type: 'gate',
      name: 'Sluice gate',
      hint: 'An old miners’ sluice at the fork. Leave the water in the river, or send it down the bench flume: the river runs dry and slow, and the mud flats run wet and fast.',
      position: [0, 54],
      options: [
        { id: 'river', label: 'Water down the river' },
        { id: 'flume', label: 'Water down the flume' },
      ],
      initial: 'river',
    },
    {
      id: 'rapids-rock',
      type: 'outcrop',
      name: 'Rapids rock',
      hint: 'A sandstone block in the rapids. The current drives you straight onto it — lever it over onto the bank.',
      actionLabel: 'Lever it onto the bank',
      hardness: 1.0,
      position: [10.5, 106],
      size: [2.6, 2.4, 2.6],
      yaw: 15 * deg,
      splitTo: [18.5, 114],
      seed: 91,
    },
    {
      id: 'trestle',
      type: 'branches',
      style: 'trestle',
      name: 'Ore trestle',
      hint: 'A collapsed ore trestle across the foot of the bench. Clear it — or hit it hard enough to smash through: a heavy stone riding the flume can.',
      position: [-8.5, 182],
      yaw: -10 * deg,
      span: 12,
      height: 3,
      seed: 733,
      breakMomentum: 94000,
    },
  ],
  formations: [
    { id: 'rim-crag', name: 'the rim crag', position: [-7, -22], size: [6, 9, 5], yaw: 8 * deg, seed: 801, hardness: 1.2, sink: 1.2, rock: 'sandstone' },
    { id: 'rim-block', name: 'a sandstone block', position: [-4.5, 30], size: [2.6, 2.2, 2.4], yaw: 25 * deg, seed: 802, hardness: 1.2, sink: 0.7, rock: 'sandstone' },
    { id: 'rapids-block', name: 'a sandstone block in the rapids', position: [9, 150], size: [2.4, 2.2, 2.4], yaw: -20 * deg, seed: 803, hardness: 1.2, sink: 0.9, rock: 'sandstone' },
    { id: 'bench-hoodoo', name: 'a hoodoo', position: [-6.5, 92], size: [2.2, 4.5, 2.2], yaw: 10 * deg, seed: 804, hardness: 1.2, sink: 0.6, rock: 'sandstone' },
    { id: 'eye-l', name: 'the Needle’s Eye', position: [-14.2, 160], size: [2.6, 5, 2.6], yaw: 20 * deg, seed: 807, hardness: 1.2, sink: 0.6, rock: 'sandstone', gap: true },
    { id: 'eye-r', name: 'the Needle’s Eye', position: [-6.8, 162], size: [2.6, 5.5, 2.6], yaw: -10 * deg, seed: 808, hardness: 1.2, sink: 0.6, rock: 'sandstone', gap: true },
    { id: 'fin', name: 'the Fin', position: [9, 216], size: [3, 4.5, 6], yaw: 5 * deg, seed: 805, hardness: 1.2, sink: 0.8, rock: 'sandstone' },
    { id: 'wash-slab', name: 'a fallen slab', position: [6, 278], size: [3, 2, 2.8], yaw: -15 * deg, seed: 806, hardness: 1.2, sink: 0.7, rock: 'sandstone' },
  ],
  regions: [
    { name: 'the rim', x: [-60, 60], z: [-60, 56] },
    { name: 'the river channel', x: [2, 60], z: [56, 200] },
    { name: 'the dry bench', x: [-60, 2], z: [56, 200] },
    { name: 'the pour-off', x: [-60, 60], z: [200, 260] },
    { name: 'the wash', x: [-60, 60], z: [260, 400] },
  ],
  forest: {
    count: 260,
    seed: 417,
    keepOut: [{ path: COURSE, width: 30 }],
  },
  camera: { target: [0, 110, 90], yaw: 0, pitch: 50 * deg, distance: 95 },
  look: { sunAzimuth: 115 * deg, sunElevation: 40 * deg },
  atmos: [
    { z: -40, fog: [0.96, 0.84, 0.7], density: 0.0013, sky: [0.98, 0.88, 0.74], zenith: [0.24, 0.48, 0.86], ground: [0.6, 0.38, 0.24], sun: [1.0, 0.92, 0.8], sunI: 3.0, hemiI: 0.95, exposure: 0.92 },
    { z: 130, fog: [0.9, 0.7, 0.54], density: 0.0021, sky: [0.96, 0.8, 0.64], zenith: [0.3, 0.5, 0.82], ground: [0.56, 0.32, 0.2], sun: [1.0, 0.86, 0.68], sunI: 2.7, hemiI: 1.0, exposure: 0.96 },
    { z: 330, fog: [0.94, 0.78, 0.6], density: 0.0017, sky: [0.98, 0.84, 0.66], zenith: [0.28, 0.48, 0.84], ground: [0.62, 0.42, 0.28], sun: [1.0, 0.84, 0.62], sunI: 2.9, hemiI: 0.95, exposure: 0.97 },
  ],
};

const ROCK_OUT = { type: 'outcrop', split: true } as const;
const FLUME = { type: 'gate', option: 'flume' } as const;
const TRESTLE_CLEARED = { type: 'branches', removed: true } as const;
const CHOCK_OUT = { type: 'outcrop', split: true } as const;

/** Candidate plans for balancing (scripts/balance.ts). */
export const REDWALL_CANYON_TESTS: { name: string; route: string; plan: Plan }[] = [
  { name: 'river as found', route: 'river', plan: {} },
  { name: 'bench as found', route: 'bench', plan: {} },
  { name: 'river, rock out', route: 'river', plan: { 'rapids-rock': ROCK_OUT } },
  { name: 'river, rock out, chock out', route: 'river', plan: { 'rapids-rock': ROCK_OUT, chockstone: CHOCK_OUT } },
  { name: 'river dry, rock out, chock out', route: 'river', plan: { sluice: FLUME, 'rapids-rock': ROCK_OUT, chockstone: CHOCK_OUT } },
  { name: 'bench, trestle cleared', route: 'bench', plan: { trestle: TRESTLE_CLEARED } },
  { name: 'bench, flume, chock out', route: 'bench', plan: { sluice: FLUME, chockstone: CHOCK_OUT } },
  { name: 'bench, flume, trestle cleared, chock out', route: 'bench', plan: { sluice: FLUME, trestle: TRESTLE_CLEARED, chockstone: CHOCK_OUT } },
];
