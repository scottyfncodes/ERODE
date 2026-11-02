import type { LevelDef, Plan } from './types';

const deg = Math.PI / 180;

// x = across, y = up, z = downhill.
// A bare granite ridge. Below the Crest Slabs the line splits three ways around two granite ribs:
//  · the Scree Switchback (left) swings wide across loose talus — safe, long, and it grinds;
//  · the Slab Run (right) is bare, fast bedrock that ends at the Step, a ledge onto rock;
//  · the Needle (centre) is a slot between two granite towers — too tight for a full-size stone.
//    Shed a little mass first (lever the Sentinel into the couloir and take the knock) and it
//    threads through onto smooth slab that skips everything the other two lines charge for.
// All three meet on the Saddle and run out across the apron to the tarn.

/** The Needle: two granite towers leaning in to a V, pinching to a slot at NEEDLE_Z. */
const NEEDLE_Z = 128;
/** nominal half-width of the slot (the rounded towers leave a little more in practice) */
const NEEDLE_HALF = 1.3;
const TOWER_W = 7;
const TOWER_L = 9;
const TOWER_YAW = 0 * deg;
/** tower centre offset so its inner face reaches ±NEEDLE_HALF at the downstream end */
const TOWER_X = NEEDLE_HALF + (TOWER_W / 2) * Math.cos(TOWER_YAW) + (TOWER_L / 2) * Math.sin(TOWER_YAW);
const COURSE: [number, number][] = [
  [0, -30],
  [0, 0],
  [0, 60],
  [0, 130],
  [0, 200],
  [-2, 250],
  [0, 300],
  [0, 360],
];

const NEEDLE: [number, number][] = [
  [0, -6],
  [0, 40],
  [0, 80],
  [0, NEEDLE_Z],
  [0, 170],
  [-1, 215],
  [-2, 250],
  [0, 330],
];
const SWITCHBACK: [number, number][] = [
  [0, -6],
  [-1, 40],
  [-6, 62],
  [-15, 82],
  [-21, 104],
  [-22, 130],
  [-19, 155],
  [-12, 180],
  [-5, 205],
  [-2, 250],
  [0, 330],
];
const SLABS: [number, number][] = [
  [0, -6],
  [1, 40],
  [6, 62],
  [14, 84],
  [17, 110],
  [16, 140],
  [12, 168],
  [7, 192],
  [1, 215],
  [-2, 250],
  [0, 330],
];

export const GRANITE_RIDGE: LevelDef = {
  id: 'granite-ridge',
  stage: 'II',
  environment: 'Rocky Mountain Ridge',
  name: 'Granite Ridge',
  tagline: 'Bare rock, thin air, and one gap too tight for you — as you are now.',
  objectiveText: 'Get off the ridge to the tarn. The rock here is hard: choose what it takes.',
  medals: { silver: 0.72, gold: 0.8, platinum: 0.85 },
  budget: 3,
  finish: { z: 320, name: 'the tarn' },
  objectives: [
    { id: 'route-needle', type: 'route', route: 'needle', label: 'Thread the Needle' },
    { id: 'route-slabs', type: 'route', route: 'slabs', label: 'Run the Slabs' },
    { id: 'no-major', type: 'noMajor', label: 'No major hits' },
    { id: 'moves', type: 'moves', max: 1, label: 'Use a single move' },
    { id: 'retain', type: 'retain', fraction: 0.82, label: 'Keep 82% of your mass' },
  ],
  routes: [
    {
      id: 'needle',
      name: 'The Needle',
      hint: 'A slot between two granite towers. The quickest way off — if you are small enough to fit.',
      gates: [
        { x: [-3, 3], z: [NEEDLE_Z - 3, NEEDLE_Z + 3] },
        { x: [-6, 6], z: [150, 175] },
      ],
      path: NEEDLE,
    },
    {
      id: 'switchback',
      name: 'Scree Switchback',
      hint: 'The long way round over loose talus. Nothing to wedge on — but it grinds.',
      gates: [
        { x: [-34, -12], z: [100, 140] },
        { x: [-30, -6], z: [150, 175] },
      ],
      path: SWITCHBACK,
    },
    {
      id: 'slabs',
      name: 'Slab Run',
      hint: 'Bare, fast bedrock — and it ends at the Step, a ledge straight onto rock.',
      gates: [
        { x: [9, 30], z: [100, 140] },
        { x: [5, 30], z: [150, 172] },
      ],
      path: SLABS,
    },
  ],
  zones: [
    { id: 'crest', name: 'Crest Slabs', z: [-30, 60] },
    { id: 'ribs', name: 'The Ribs', z: [60, 200] },
    { id: 'saddle', name: 'The Saddle', z: [200, 260] },
    { id: 'tarn', name: 'Tarn Apron', z: [260, 360] },
  ],
  props: { trees: [], rocks: 0, spread: 18 },
  terrain: {
    bounds: { x: [-46, 46], z: [-44, 352] },
    cell: 1.0,
    course: COURSE,
    valley: {
      cap: 40,
      k: [
        [-60, 0.012],
        [0, 0.008],
        [50, 0.003],
        [190, 0.003],
        [230, 0.006],
        [380, 0.005],
      ],
    },
    profile: [
      [-160, 236],
      [-40, 170],
      [-14, 160],
      [0, 156],
      [50, 140],
      [86, 129],
      // the Sentinel's bench: a breather above the Needle
      [104, 126],
      [118, 121],
      [140, 112],
      [200, 92],
      [250, 78],
      [300, 65],
      [330, 58],
      [352, 52],
      [500, 40],
    ],
    bowl: { k: 0, fade: [0, 1] },
    tilt: { amount: 0, z: [0, 1] },
    noise: [
      { amp: 0.4, scale: 22 },
      { amp: 0.08, scale: 5 },
    ],
    zoneSurfaces: [
      // decomposed granite (grus) on the open slopes; thin alpine turf below the ribs
      { z: [-60, 195], surface: 'scree' },
    ],
    features: [
      // the summit shelf
      { type: 'mound', center: [0, -14], radius: 7, height: -0.6, surface: 'bedrock' },
      // the two granite ribs that split the line three ways
      { type: 'ridge', path: [[-5, 72], [-8, 95], [-9, 125], [-8, 160], [-5, 186]], width: 5.5, depth: 6, taper: [12, 10], surface: 'bedrock' },
      { type: 'ridge', path: [[5, 72], [8, 95], [9, 125], [8, 160], [5, 186]], width: 5.5, depth: 6, taper: [12, 10], surface: 'bedrock' },
      // the Needle couloir: a smooth slot of bedrock down the middle
      { type: 'carve', path: [[0, 30], [0, 90], [0, NEEDLE_Z], [0, 170], [-1, 205]], width: 5, depth: 1.6, taper: [18, 12], surface: 'meadow' },
      // the groove into the Needle: bare rock that funnels the stone to the slot
      { type: 'carve', path: [[0, 104], [0, NEEDLE_Z], [0, 142]], width: 3.2, depth: 1.2, taper: [12, 8], surface: 'bedrock' },
      // the Saddle: every line drains into one broad trough down to the tarn
      { type: 'carve', path: [[0, 180], [-1, 215], [-2, 250], [0, 300], [0, 352]], width: 11, depth: 2.4, taper: [22, 0] },
      // the Scree Switchback: a talus trough swinging wide to the left
      { type: 'carve', path: [[-4, 56], [-6, 62], [-15, 82], [-21, 104], [-22, 130], [-19, 155], [-12, 180], [-5, 205]], width: 7, depth: 2.2, taper: [10, 10], surface: 'scree' },
      // the Slab Run: bare bedrock on the right
      { type: 'carve', path: [[4, 56], [6, 62], [14, 84], [17, 110], [16, 140], [12, 168], [7, 192], [1, 215]], width: 7, depth: 2.0, taper: [10, 10], surface: 'bedrock' },
      // granite whalebacks studding the switchback
      { type: 'mound', center: [-11, 74], radius: 2.2, height: 1.0, surface: 'bedrock' },
      { type: 'mound', center: [-19.5, 99], radius: 2.2, height: 1.0, surface: 'bedrock' },
      { type: 'mound', center: [-21.8, 118], radius: 2.2, height: 1.0, surface: 'bedrock' },
      { type: 'mound', center: [-21.5, 129], radius: 2.2, height: 1.0, surface: 'bedrock' },
      { type: 'mound', center: [-12.5, 176], radius: 2.2, height: 0.9, surface: 'bedrock' },
      { type: 'mound', center: [-17, 90], radius: 2.4, height: 1.2, surface: 'bedrock' },
      { type: 'mound', center: [-21, 108], radius: 2.4, height: 1.3, surface: 'bedrock' },
      { type: 'mound', center: [-22, 138], radius: 2.4, height: 1.3, surface: 'bedrock' },
      { type: 'mound', center: [-20.5, 151], radius: 2.4, height: 1.2, surface: 'bedrock' },
      { type: 'mound', center: [-16, 166], radius: 2.4, height: 1.0, surface: 'bedrock' },
      // the Step: a ledge across the Slab Run
      { type: 'drop', path: [[16, 150], [12, 168], [8, 188]], halfWidth: 5, lipZ: 172, drop: 3.0, rampLength: 8, rejoin: 10, surface: 'bedrock' },
    ],
    peaks: [
      { x: 0, z: -150, radius: 80, height: 80 },
      { x: -120, z: 40, radius: 70, height: 70 },
      { x: 130, z: 110, radius: 80, height: 66 },
      { x: -140, z: 290, radius: 90, height: 50 },
    ],
    snowLine: 230,
  },
  boulder: { position: [0, -14], radius: 1.0, seed: 777, push: [0, 0, 3.5] },
  // the full stone is 1.96 m across: it must lose about 12% of its mass to fit
  passages: [{ name: 'the Needle', x: 0, z: NEEDLE_Z - TOWER_L + 1, width: 1.88 }],
  water: [],
  objects: [
    {
      id: 'sentinel',
      type: 'outcrop',
      name: 'Sentinel',
      hint: 'A cracked granite tooth above the Needle. Lever it into the couloir and take the knock on purpose — it sheds just enough of you to fit the slot.',
      actionLabel: 'Lever it into the couloir',
      hardness: 2.3,
      rock: 'granite',
      position: [-4.6, 98],
      size: [1.8, 2.6, 1.8],
      yaw: 20 * deg,
      splitTo: [-1.3, 102],
      seed: 711,
    },
    {
      id: 'slab-boulder',
      type: 'rock',
      name: 'Loose granite',
      hint: 'A loose granite boulder squatting on the Slab Run. At full speed it is a wall. Drag it aside.',
      position: [16.6, 118],
      radius: 1.2,
      seed: 91,
      moveRadius: 7,
    },
    {
      id: 'talus-boulder',
      type: 'rock',
      name: 'Talus block',
      hint: 'A talus block in the switchback trough. Drag it clear of the line.',
      position: [-19.6, 124],
      radius: 1.0,
      seed: 37,
      moveRadius: 6,
    },
    {
      id: 'erratic',
      type: 'rock',
      name: 'Erratic',
      hint: 'A big glacial erratic sitting on the Saddle, where every line comes back together. Drag it off the fall line.',
      position: [-2.5, 236],
      radius: 1.05,
      seed: 223,
      moveRadius: 8,
    },
  ],
  formations: [
    // the Needle: two granite towers with a slot between them
    { id: 'needle-w', name: 'the Needle', position: [-TOWER_X, NEEDLE_Z - TOWER_L / 2], size: [TOWER_W, 19, TOWER_L], yaw: -TOWER_YAW, seed: 801, hardness: 1.8, sink: 8, rock: 'granite', gap: true },
    { id: 'needle-e', name: 'the Needle', position: [TOWER_X, NEEDLE_Z - TOWER_L / 2], size: [TOWER_W, 21, TOWER_L], yaw: TOWER_YAW, seed: 802, hardness: 1.8, sink: 8, rock: 'granite', gap: true },
    // tors along the ribs and the crest
    { id: 'tor-1', name: 'a granite tor', position: [-10, 112], size: [4, 5, 4], yaw: 25 * deg, seed: 811, hardness: 1.8, sink: 0.8, rock: 'granite' },
    { id: 'tor-2', name: 'a granite tor', position: [10.5, 100], size: [4.5, 6, 4], yaw: -10 * deg, seed: 812, hardness: 1.8, sink: 0.8, rock: 'granite' },
    { id: 'tor-3', name: 'a granite tor', position: [-9, 158], size: [3.5, 4.5, 3.5], yaw: 50 * deg, seed: 813, hardness: 1.8, sink: 0.8, rock: 'granite' },
    { id: 'tor-4', name: 'a granite tor', position: [9.5, 150], size: [3.5, 5, 3.5], yaw: 5 * deg, seed: 814, hardness: 1.8, sink: 0.8, rock: 'granite' },
    { id: 'summit', name: 'the summit tor', position: [-7, -22], size: [6, 9, 5], yaw: 8 * deg, seed: 805, hardness: 1.8, sink: 1.2, rock: 'granite' },
    { id: 'apron-1', name: 'a granite block', position: [8, 278], size: [2.6, 2.2, 2.4], yaw: 15 * deg, seed: 821, hardness: 1.8, sink: 0.6, rock: 'granite' },
  ],
  regions: [
    { name: 'the crest slabs', x: [-60, 60], z: [-60, 60] },
    { name: 'the scree switchback', x: [-60, -6], z: [60, 200] },
    { name: 'the Needle couloir', x: [-6, 6], z: [60, 200] },
    { name: 'the slab run', x: [6, 60], z: [60, 200] },
    { name: 'the saddle', x: [-60, 60], z: [200, 262] },
    { name: 'the tarn apron', x: [-60, 60], z: [262, 400] },
  ],
  forest: {
    count: 140,
    seed: 517,
    keepOut: [{ path: COURSE, width: 60 }],
  },
  camera: { target: [0, 110, 110], yaw: 0, pitch: 50 * deg, distance: 115 },
  look: { sunAzimuth: 150 * deg, sunElevation: 48 * deg },
  palette: {
    bedrock: [0.66, 0.64, 0.62],
    rock: [0.6, 0.59, 0.58],
    strata: [0.5, 0.49, 0.5],
    scree: [0.56, 0.54, 0.52],
    meadow: [0.5, 0.52, 0.38],
    soil: [0.42, 0.38, 0.32],
    forest: [0.2, 0.27, 0.22],
    valley: [0.44, 0.47, 0.4],
  },
  atmos: [
    { z: -40, fog: [0.78, 0.87, 1.0], density: 0.0009, sky: [0.74, 0.86, 1.0], zenith: [0.07, 0.28, 0.86], ground: [0.5, 0.5, 0.48], sun: [1.0, 0.98, 0.94], sunI: 3.1, hemiI: 0.95, exposure: 0.9 },
    { z: 130, fog: [0.76, 0.85, 0.98], density: 0.0011, sky: [0.72, 0.85, 1.0], zenith: [0.09, 0.32, 0.88], ground: [0.48, 0.48, 0.46], sun: [1.0, 0.97, 0.92], sunI: 3.0, hemiI: 1.0, exposure: 0.92 },
    { z: 320, fog: [0.74, 0.84, 0.95], density: 0.0014, sky: [0.76, 0.86, 0.98], zenith: [0.12, 0.36, 0.86], ground: [0.44, 0.46, 0.38], sun: [1.0, 0.95, 0.86], sunI: 2.9, hemiI: 1.0, exposure: 0.94 },
  ],
};

const lever = { type: 'outcrop', split: true } as const;
const moved = (x: number, z: number) => ({ type: 'rock', removed: false, x, z }) as const;

/** Candidate plans for balancing (scripts/balance.ts). */
export const GRANITE_RIDGE_TESTS: { name: string; route: string; plan: Plan }[] = [
  { name: 'switchback as found', route: 'switchback', plan: {} },
  { name: 'slabs as found', route: 'slabs', plan: {} },
  { name: 'needle as found', route: 'needle', plan: {} },
  { name: 'switchback, talus cleared', route: 'switchback', plan: { 'talus-boulder': { type: 'rock', removed: true, x: -19.6, z: 124 } } },
  { name: 'slabs, boulder cleared', route: 'slabs', plan: { 'slab-boulder': { type: 'rock', removed: true, x: 16.6, z: 118 } } },
  { name: 'needle, sentinel', route: 'needle', plan: { sentinel: lever } },
  { name: 'needle, sentinel, erratic', route: 'needle', plan: { sentinel: lever, erratic: moved(4.5, 240) } },
  { name: 'slabs, boulder + erratic', route: 'slabs', plan: { 'slab-boulder': { type: 'rock', removed: true, x: 16.6, z: 118 }, erratic: { type: 'rock', removed: true, x: -2.5, z: 236 } } },
];
