import type { Formation, LevelDef, Plan } from './types';

const deg = Math.PI / 180;

// x = across, y = up, z = downhill. The black flank of a young cone.
// An ash slope drops off the crater shelf to the Fork, where a basalt spine splits the flank:
// the Glass Chute (left, x < 0) is the steep direct line through a field of obsidian shards;
// the Ash Traverse (right) swings wide over deep, slow ash. A gap in the spine (plugged by a
// leaning column) links the traverse to the foot of the chute. All three meet in the Cinder Chute —
// a steep throat with a basalt step across it (a cinder bank cushions the landing) — and run out
// onto the ash fan.
const COURSE: [number, number][] = [
  [0, -30],
  [0, 0],
  [0, 60],
  [0, 120],
  [0, 190],
  [0, 240],
  [0, 300],
  [0, 360],
];

const GLASS: [number, number][] = [
  [0, -6],
  [-2, 40],
  [-9, 72],
  [-11, 105],
  [-10, 140],
  [-7, 175],
  [-3, 200],
  [0, 230],
  [0, 300],
  [0, 340],
];
const TRAVERSE: [number, number][] = [
  [0, -6],
  [3, 40],
  [13, 72],
  [19, 105],
  [20, 140],
  [17, 170],
  [10, 188],
  [2, 202],
  [0, 220],
  [0, 300],
  [0, 340],
];
const GAP: [number, number][] = [
  [0, -6],
  [3, 40],
  [13, 72],
  [19, 105],
  [18, 140],
  [12, 156],
  [4, 164],
  [-4, 170],
  [-6, 180],
  [-4, 192],
  [-2, 205],
  [0, 230],
  [0, 300],
  [0, 340],
];

const shard = (id: string, x: number, z: number, s: number, yaw: number, seed: number): Formation => ({
  id,
  name: 'an obsidian shard',
  position: [x, z],
  size: [1.5 * s, 1.3 * s, 1.2 * s],
  yaw: yaw * deg,
  seed,
  hardness: 2.3,
  sink: 0.35,
  rock: 'obsidian',
});

const column = (id: string, x: number, z: number, s: number, yaw: number, seed: number, name = 'a basalt column'): Formation => ({
  id,
  name,
  position: [x, z],
  size: [2.0 * s, 4.2 * s, 2.0 * s],
  yaw: yaw * deg,
  seed,
  hardness: 2.0,
  sink: 0.6,
  rock: 'basalt',
});

export const CINDER_CONE: LevelDef = {
  id: 'cinder-cone',
  stage: 'V',
  environment: 'Volcanic Mountainside',
  name: 'Cinder Cone',
  tagline: 'Black ash, basalt and glass. Too fast and the mountain shreds you; too slow and it buries you.',
  objectiveText: 'Get down the cone in one piece — manage your speed.',
  medals: { silver: 0.6, gold: 0.78, platinum: 0.9 },
  budget: 3,
  finish: { z: 300, name: 'the ash fan' },
  objectives: [
    { id: 'route-glass', type: 'route', route: 'glass', label: 'Run the Glass Chute' },
    { id: 'route-gap', type: 'route', route: 'gap', label: 'Thread the Column Gap' },
    { id: 'no-major', type: 'noMajor', label: 'No major fractures' },
    { id: 'retain', type: 'retain', fraction: 0.85, label: 'Keep 85% of your mass' },
    { id: 'time', type: 'time', seconds: 40, label: 'Reach the fan inside 40 s' },
  ],
  routes: [
    {
      id: 'glass',
      name: 'Glass Chute',
      hint: 'Short and steep, through a field of obsidian. Hit it slow — or not at all.',
      gates: [
        { x: [-30, -3], z: [100, 130] },
        { x: [-30, -2], z: [140, 160] },
      ],
      path: GLASS,
    },
    {
      id: 'traverse',
      name: 'Ash Traverse',
      hint: 'A long swing through deep ash. Safe — if you keep moving.',
      gates: [
        { x: [6, 34], z: [100, 130] },
        { x: [6, 34], z: [172, 186] },
      ],
      path: TRAVERSE,
    },
    {
      id: 'gap',
      name: 'Column Gap',
      hint: 'Off the traverse and through the spine — once the leaning column is levered out.',
      gates: [
        { x: [6, 34], z: [100, 130] },
        { x: [-4, 8], z: [160, 172] },
      ],
      path: GAP,
    },
  ],
  zones: [
    { id: 'slope', name: 'Ash Slope', z: [-30, 62] },
    { id: 'fork', name: 'The Spine', z: [62, 195] },
    { id: 'throat', name: 'Cinder Chute', z: [195, 260] },
    { id: 'fan', name: 'Ash Fan', z: [260, 360] },
  ],
  props: {
    trees: [
      { z: [70, 190], density: 0.18 },
      { z: [280, 300], density: 0.1 },
    ],
    rocks: 0,
    spread: 26,
  },
  terrain: {
    bounds: { x: [-46, 46], z: [-44, 372] },
    cell: 1.0,
    course: COURSE,
    valley: {
      cap: 40,
      k: [
        [-60, 0.01],
        [0, 0.008],
        [60, 0.006],
        [190, 0.006],
        [260, 0.007],
        [380, 0.004],
      ],
    },
    profile: [
      [-160, 240],
      [-40, 170],
      [-14, 160],
      [0, 155],
      [60, 131],
      [100, 113],
      [170, 90.5],
      [200, 80],
      [255, 60],
      [300, 46.5],
      [340, 39],
      [372, 35],
      [500, 24],
    ],
    bowl: { k: 0, fade: [0, 1] },
    tilt: { amount: 0, z: [0, 1] },
    noise: [
      { amp: 0.8, scale: 22 },
      { amp: 0.25, scale: 6 },
    ],
    zoneSurfaces: [
      { z: [-40, 62], surface: 'ash' },
      { z: [62, 200], surface: 'ash' },
      { z: [200, 255], surface: 'scree' },
      { z: [255, 400], surface: 'ash' },
    ],
    features: [
      // the crater shelf
      { type: 'mound', center: [0, -14], radius: 7, height: -0.6, surface: 'bedrock' },
      // the basalt spine, broken by the Column Gap at z 160–172
      { type: 'ridge', path: [[0, 60], [1, 100], [2, 130], [3, 162]], width: 8, depth: 5, taper: [14, 2], surface: 'bedrock' },
      { type: 'ridge', path: [[2, 172], [2, 196]], width: 7, depth: 4, taper: [2, 8], surface: 'bedrock' },
      // the ash pit on the traverse, where the deep drift lies
      { type: 'mound', center: [19.5, 124], radius: 8, height: -1.6, scale: [1.2, 1.6], surface: 'ash' },
      // an ash-choked scoop at the head of the Glass Chute
      { type: 'mound', center: [-10.5, 90], radius: 6, height: -1.2, scale: [1.2, 1.2], surface: 'ash' },
      // the Glass Chute: a steep glassy trough on the left
      { type: 'carve', path: [[-2, 42], [-9, 72], [-11, 105], [-10, 140], [-7, 175], [-3, 200]], width: 8, depth: 1.5, taper: [10, 10], surface: 'scree' },
      // the Ash Traverse: a broad soft trough on the right
      { type: 'carve', path: [[3, 42], [13, 72], [19, 105], [20, 140], [17, 170], [10, 192], [2, 210]], width: 9, depth: 1.0, taper: [10, 10], surface: 'ash' },
      // the Basalt Steps: a bare ledge where the traverse swings back toward the throat
      { type: 'drop', path: [[17, 168], [13, 184], [6, 200]], halfWidth: 7, lipZ: 182, drop: 2.6, rampLength: 6, rejoin: 6, surface: 'bedrock' },
      // the Cinder Chute: a cinder throat with a basalt step across it
      { type: 'carve', path: [[0, 198], [0, 230], [0, 290]], width: 11, depth: 1.2, taper: [8, 30] },
      { type: 'drop', path: [[0, 205], [0, 240]], halfWidth: 10, lipZ: 224, drop: 2.8, rampLength: 10, rejoin: 10, surface: 'bedrock' },
    ],
    peaks: [
      { x: 0, z: -150, radius: 80, height: 90 },
      { x: -120, z: 60, radius: 70, height: 55 },
      { x: 130, z: 140, radius: 80, height: 50 },
      { x: -140, z: 300, radius: 90, height: 40 },
    ],
    snowLine: 400,
  },
  boulder: { position: [0, -14], radius: 1.0, seed: 2207, push: [0, 0, 3.0] },
  water: [],
  objects: [
    {
      id: 'glass-drift',
      type: 'soil',
      material: 'ash',
      name: 'Ash drift',
      hint: 'A deep drift of ash at the head of the Glass Chute. It will check your speed before the obsidian — dig it out only if you want to fly.',
      position: [-10.8, 102],
      radius: [5, 3.4],
      height: 1.9,
      yaw: 0,
      seed: 31,
    },
    {
      id: 'traverse-drift',
      type: 'soil',
      material: 'ash',
      name: 'Deep drift',
      hint: 'Wind-piled ash across the traverse. Soft — and deep enough to bury a slow stone. Dig it out to keep rolling.',
      position: [19.5, 131],
      radius: [5.5, 3.2],
      height: 2.4,
      yaw: 0,
      seed: 32,
    },
    {
      id: 'bend-drift',
      type: 'soil',
      material: 'ash',
      name: 'Bend drift',
      hint: 'Ash banked up where the traverse swings back toward the throat. A tired stone will bog down in it.',
      position: [17.2, 165],
      radius: [5, 3.2],
      height: 2.7,
      yaw: 10 * deg,
      seed: 34,
    },
    {
      id: 'leaning-column',
      type: 'outcrop',
      name: 'Leaning column',
      hint: 'A basalt column plugging the gap in the spine. Lever it out to open a shortcut from the traverse to the foot of the chute.',
      actionLabel: 'Lever it out',
      hardness: 2.0,
      position: [2.5, 167],
      size: [3.6, 4.6, 11],
      yaw: 0,
      splitTo: [4, 146],
      seed: 41,
    },
    {
      id: 'fork-column',
      type: 'outcrop',
      name: 'Cracked column',
      hint: 'A tall column beside the chute mouth. Lever it over to shut the Glass Chute and keep the stone on the traverse.',
      actionLabel: 'Lever it over',
      hardness: 2.0,
      position: [-17, 64],
      size: [7, 4.4, 2.8],
      yaw: 80 * deg,
      splitTo: [-8.5, 70],
      seed: 42,
    },
    {
      id: 'throat-drift',
      type: 'soil',
      material: 'ash',
      name: 'Cinder bank',
      hint: 'A bank of cinders at the foot of the basalt step in the Cinder Chute. It cushions the drop — though a stone that limps in slow can come to rest against it.',
      position: [0, 229.5],
      radius: [6, 4.5],
      height: 0.75,
      yaw: 0,
      seed: 33,
    },
  ],
  formations: [
    // the obsidian field
    shard('glass-1', -15.2, 108, 0.81, 39, 701),
    shard('glass-2', -6.6, 108, 0.87, -32, 702),
    shard('glass-3', -10.9, 114, 0.8, 77, 703),
    shard('glass-4', -14.7, 120, 0.72, -3, 704),
    shard('glass-5', -6.5, 120, 0.81, -70, 705),
    shard('glass-6', -10.3, 126, 0.78, 35, 706),
    shard('glass-7', -14.4, 132, 0.82, -40, 707),
    shard('glass-8', -5.9, 132, 0.87, -64, 708),
    shard('glass-9', -10.3, 138, 0.74, -19, 709),
    shard('glass-10', -13.9, 144, 0.86, 3, 710),
    shard('glass-11', -5.4, 144, 0.87, 52, 711),
    shard('glass-12', -9.3, 150, 0.76, -79, 712),
    shard('glass-13', -12.8, 156, 0.79, -9, 713),
    shard('glass-14', -4.4, 156, 0.81, -59, 714),
    shard('glass-15', -8.0, 162, 0.76, -22, 715),
    // columns on the spine
    column('spine-1', 1.5, 92, 1.0, 10, 801),
    column('spine-2', 2.5, 122, 1.1, -20, 802),
    column('spine-3', 3, 190, 1.0, 40, 803),
    // the traverse's outer wall
    column('wall-1', 27, 98, 1.1, 5, 804),
    column('wall-2', 28, 150, 1.0, 25, 805),
    // the Cinder Chute
    column('throat-1', -7.5, 218, 1.1, 15, 806, 'the throat columns'),
    column('throat-2', 7.5, 226, 1.1, -10, 807, 'the throat columns'),
    column('throat-3', -6.5, 240, 1.0, 30, 808, 'the throat columns'),
    // the crater rim behind the start
    { id: 'rim', name: 'the crater rim', position: [-7, -22], size: [6, 8, 5], yaw: 8 * deg, seed: 809, hardness: 2.0, sink: 1.2, rock: 'basalt' },
  ],
  regions: [
    { name: 'the ash slope', x: [-60, 60], z: [-60, 62] },
    { name: 'the glass chute', x: [-60, 0], z: [62, 172] },
    { name: 'the ash traverse', x: [0, 60], z: [62, 195] },
    { name: 'the column gap', x: [-8, 8], z: [158, 175] },
    { name: 'the cinder chute', x: [-60, 60], z: [195, 260] },
    { name: 'the ash fan', x: [-60, 60], z: [260, 400] },
  ],
  forest: {
    count: 260,
    seed: 517,
    keepOut: [{ path: COURSE, width: 30 }],
  },
  camera: { target: [0, 110, 90], yaw: 0, pitch: 50 * deg, distance: 100 },
  look: { sunAzimuth: 230 * deg, sunElevation: 22 * deg },
  palette: {
    ash: [0.2, 0.19, 0.19],
    scree: [0.12, 0.11, 0.13],
    bedrock: [0.16, 0.15, 0.15],
    soil: [0.24, 0.17, 0.13],
    meadow: [0.26, 0.24, 0.21],
    forest: [0.1, 0.1, 0.08],
    rock: [0.14, 0.13, 0.13],
    strata: [0.48, 0.2, 0.1],
    valley: [0.22, 0.2, 0.18],
  },
  atmos: [
    { z: -40, fog: [0.62, 0.5, 0.42], density: 0.0026, sky: [0.78, 0.6, 0.46], zenith: [0.3, 0.3, 0.38], ground: [0.22, 0.18, 0.16], sun: [1.0, 0.78, 0.55], sunI: 2.4, hemiI: 0.85, exposure: 0.95 },
    { z: 130, fog: [0.58, 0.42, 0.32], density: 0.0034, sky: [0.8, 0.55, 0.38], zenith: [0.32, 0.26, 0.3], ground: [0.2, 0.15, 0.12], sun: [1.0, 0.7, 0.45], sunI: 2.2, hemiI: 0.9, exposure: 0.98 },
    { z: 320, fog: [0.66, 0.46, 0.34], density: 0.003, sky: [0.86, 0.6, 0.42], zenith: [0.34, 0.3, 0.36], ground: [0.24, 0.18, 0.14], sun: [1.0, 0.72, 0.5], sunI: 2.3, hemiI: 0.9, exposure: 0.98 },
  ],
};

const dig = { type: 'soil', dug: true } as const;
const lever = { type: 'outcrop', split: true } as const;

/** Candidate plans for balancing (scripts/balance.ts). */
export const CINDER_CONE_TESTS: { name: string; route: string; plan: Plan }[] = [
  { name: 'glass as found', route: 'glass', plan: {} },
  { name: 'traverse as found', route: 'traverse', plan: {} },
  { name: 'glass, drift dug', route: 'glass', plan: { 'glass-drift': dig } },
  { name: 'traverse, drifts dug', route: 'traverse', plan: { 'traverse-drift': dig, 'bend-drift': dig } },
  { name: 'gap, column left in place', route: 'gap', plan: { 'traverse-drift': dig } },
  { name: 'gap, column levered, drift dug', route: 'gap', plan: { 'leaning-column': lever, 'traverse-drift': dig } },
  { name: 'traverse, drifts dug, bank dug', route: 'traverse', plan: { 'traverse-drift': dig, 'bend-drift': dig, 'throat-drift': dig } },
  { name: 'glass, chute shut', route: 'glass', plan: { 'fork-column': lever } },
];
