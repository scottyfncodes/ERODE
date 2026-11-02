import type { LevelDef, Plan } from './types';

const deg = Math.PI / 180;

// x = across, y = up, z = downhill. Everything here is snow.
// A cornice shelf drops onto the Upper Bowl, where a black rock rib splits the run:
//  - The Couloir (left): a narrow trough of blue water-ice. No drag, almost no lean — you go where it slides.
//    An avalanche fence spans it (burst it and it bleeds the speed that would carry you into the serac at the
//    dogleg), and it spits you out over the middle of the Bergschrund — onto a landing glazed with verglas.
//  - The Snowfield (right): deep, soft snow. Gentle on the stone, but every metre drinks momentum: a wind drift
//    lies across the line and two snow fences below it stop anything that arrives slow (momentum = mass × speed,
//    so light stones need the fences cleared). Its landing below the Bergschrund is a cornice-debris cushion
//    that buries a stone arriving without speed.
// Both drop over the Bergschrund (a 4 m step across the slope) and run out over the Glass Apron to the hut.
const COURSE: [number, number][] = [
  [0, -30],
  [0, 0],
  [0, 50],
  [0, 120],
  [-4, 180],
  [-4, 225],
  [0, 260],
  [0, 300],
  [0, 380],
];

const COULOIR: [number, number][] = [
  [0, -6],
  [-3, 38],
  [-10, 70],
  [-13, 110],
  [-11, 140],
  [-7, 170],
  [0, 192],
  [2, 212],
  [2, 240],
  [0, 280],
  [0, 330],
];
const SNOWFIELD: [number, number][] = [
  [0, -6],
  [3, 38],
  [12, 70],
  [15, 110],
  [12, 140],
  [8, 170],
  [10, 190],
  [11, 210],
  [2, 240],
  [0, 280],
  [0, 330],
];

export const WHITEOUT_COULOIR: LevelDef = {
  id: 'whiteout-couloir',
  stage: 'III',
  environment: 'Snow-covered Mountain',
  name: 'Whiteout Couloir',
  tagline: 'Deep snow drinks your speed; blue ice gives it all back — and takes the wheel.',
  objectiveText: 'Reach the hut with as much of yourself as you can. Keep enough momentum not to drown in the snow.',
  medals: { silver: 0.72, gold: 0.87, platinum: 0.965 },
  budget: 3,
  finish: { z: 322, name: 'the hut' },
  objectives: [
    { id: 'route-couloir', type: 'route', route: 'couloir', label: 'Run the Couloir' },
    { id: 'route-snowfield', type: 'route', route: 'snowfield', label: 'Wade the Snowfield' },
    { id: 'smash-fence', type: 'smash', object: 'couloir-fence', label: 'Burst through the avalanche fence' },
    { id: 'time', type: 'time', seconds: 45, label: 'Reach the hut inside 45 s' },
    { id: 'retain', type: 'retain', fraction: 0.9, label: 'Keep 90% of your mass' },
  ],
  routes: [
    {
      id: 'couloir',
      name: 'The Couloir',
      hint: 'Blue ice: fast, rattling and hard to steer. Mind the serac — and the glazed landing below the step.',
      gates: [
        { x: [-30, -4], z: [95, 128] },
        { x: [-30, -2], z: [135, 160] },
      ],
      path: COULOIR,
    },
    {
      id: 'snowfield',
      name: 'The Snowfield',
      hint: 'Soft, deep snow — gentle on the stone, cruel to your speed.',
      gates: [
        { x: [4, 30], z: [95, 128] },
        { x: [2, 30], z: [135, 160] },
      ],
      path: SNOWFIELD,
    },
  ],
  zones: [
    { id: 'bowl', name: 'Upper Bowl', z: [-30, 50] },
    { id: 'fork', name: 'Couloir & Snowfield', z: [50, 180] },
    { id: 'schrund', name: 'The Bergschrund', z: [180, 230] },
    { id: 'apron', name: 'Glass Apron', z: [230, 340] },
  ],
  props: {
    trees: [{ z: [290, 320], density: 0.12 }],
    rocks: 0,
    spread: 22,
  },
  terrain: {
    bounds: { x: [-46, 46], z: [-44, 342] },
    cell: 1.0,
    course: COURSE,
    valley: {
      cap: 40,
      k: [
        [-60, 0.011],
        [0, 0.009],
        [60, 0.006],
        [170, 0.006],
        [260, 0.006],
        [380, 0.004],
      ],
    },
    profile: [
      [-160, 262],
      [-40, 197],
      [-14, 188],
      [0, 184],
      [40, 169],
      [100, 147],
      [170, 122],
      [200, 112],
      [260, 93],
      [300, 81],
      [330, 75],
      [372, 71],
      [500, 64],
    ],
    bowl: { k: 0, fade: [0, 1] },
    tilt: { amount: 0, z: [0, 1] },
    noise: [
      { amp: 0.7, scale: 26 },
      { amp: 0.18, scale: 6 },
    ],
    features: [
      // the cornice shelf the boulder rests on: wind-scoured rock
      { type: 'mound', center: [0, -14], radius: 7, height: -0.6, surface: 'bedrock' },
      // the black rib that splits the bowl
      { type: 'ridge', path: [[0, 48], [0, 90], [0, 140], [-1, 172]], width: 9, depth: 5, taper: [14, 10], surface: 'bedrock' },
      // the couloir: a deep trough glazed with blue ice
      { type: 'carve', path: [[-3, 38], [-10, 70], [-13, 110], [-11, 140], [-9, 172]], width: 5, depth: 2.8, taper: [10, 8], surface: 'ice' },
      // the snowfield: a broad, shallow scoop of powder
      { type: 'carve', path: [[3, 38], [12, 70], [15, 110], [12, 140], [6, 172]], width: 11, depth: 0.8, taper: [10, 10], surface: 'snow' },
      // the Bergschrund: a step across the whole slope
      { type: 'drop', path: [[0, 180], [0, 230]], halfWidth: 24, lipZ: 205, drop: 4, rampLength: 30, rejoin: 10, surface: 'snow' },
      // bare, wind-blasted rock below the left half of the step
      { type: 'mound', center: [-7, 218], radius: 10, height: 0.35, scale: [1.3, 1.1], surface: 'bedrock' },
      // the Glass Apron: a sheet of old blue ice on the runout
      { type: 'mound', center: [1, 252], radius: 13, height: -0.25, scale: [1.4, 1.2], surface: 'ice' },
    ],
    peaks: [
      { x: 0, z: -150, radius: 80, height: 85 },
      { x: -120, z: 40, radius: 70, height: 70 },
      { x: 130, z: 120, radius: 80, height: 65 },
      { x: -140, z: 300, radius: 90, height: 50 },
    ],
    snowLine: -200,
  },
  boulder: { position: [0, -14], radius: 1.0, seed: 2207, push: [0, 0, 3.5] },
  water: [],
  objects: [
    {
      id: 'couloir-fence',
      type: 'branches',
      style: 'fence',
      name: 'Avalanche fence',
      hint: 'Timber snow-fence across the couloir. Hit it fast to burst through (it bleeds your speed) — or clear it and keep every km/h.',
      position: [-12.8, 100],
      yaw: 0,
      span: 9,
      height: 2.4,
      seed: 911,
      breakMomentum: 65000,
    },
    {
      id: 'snow-fence',
      type: 'branches',
      style: 'fence',
      name: 'Upper snow fence',
      hint: 'A long drift fence across the snowfield, just below the wind drift. Arrive slow and it stops you dead; clear it, or keep your momentum up.',
      position: [14, 122],
      yaw: 0,
      span: 15,
      height: 2.2,
      seed: 912,
      breakMomentum: 80000,
    },
    {
      id: 'lower-fence',
      type: 'branches',
      style: 'fence',
      name: 'Lower snow fence',
      hint: 'A second fence just below the first. If you burst the upper one you arrive here slow — clear one of them, or carry real speed.',
      position: [13, 134],
      yaw: -8 * deg,
      span: 15,
      height: 2.2,
      seed: 913,
      breakMomentum: 85000,
    },
    {
      id: 'wind-drift',
      type: 'soil',
      material: 'snow',
      name: 'Wind drift',
      hint: 'A deep drift right across the snowfield above the snow fence. Soft as a pillow — and it swallows your speed. Dig it out to keep moving.',
      position: [14.5, 104],
      radius: [6, 2.6],
      height: 1.5,
      yaw: 0,
      seed: 31,
    },
    {
      id: 'cornice-debris',
      type: 'soil',
      material: 'snow',
      name: 'Cornice debris',
      hint: 'Collapsed cornice at the foot of the Bergschrund. Land in it and the bare rock never touches you — but arrive slow and you are buried. Dig it out and you land on rock.',
      position: [11, 209.5],
      radius: [6.5, 3.2],
      height: 1.5,
      yaw: 0,
      seed: 33,
    },
    {
      id: 'nunatak-bank',
      type: 'soil',
      material: 'snow',
      name: 'Snowbank',
      hint: 'A snowbank piled against the granite nunatak. It cushions a hit on the rock behind it.',
      position: [9.5, 146],
      radius: [3.4, 2.2],
      height: 1.6,
      yaw: 20 * deg,
      seed: 32,
    },
    {
      id: 'verglas',
      type: 'ice',
      name: 'Verglas',
      hint: 'The landing below the Bergschrund is glazed with clear ice — nearly as hard as rock. Break it and you land in soft snow instead.',
      center: [1, 213],
      size: [13, 17],
      yaw: 0,
      seed: 77,
    },
  ],
  formations: [
    { id: 'serac', name: 'the serac', position: [-14, 149], size: [3, 3.4, 2.6], yaw: 15 * deg, seed: 701, hardness: 1.5, sink: 0.8, rock: 'ice' },
    { id: 'nunatak', name: 'the nunatak', position: [9, 151], size: [3, 2.6, 2.8], yaw: -10 * deg, seed: 702, hardness: 1.8, sink: 0.7, rock: 'granite' },
    { id: 'couloir-wall', name: 'a black buttress', position: [-17, 124], size: [2.6, 2.4, 3.2], yaw: 5 * deg, seed: 703, hardness: 1.8, sink: 0.7, rock: 'basalt' },
    { id: 'apron-1', name: 'a frozen boulder', position: [-6, 268], size: [2.6, 2.2, 2.4], yaw: 30 * deg, seed: 704, hardness: 1.6, sink: 0.6, rock: 'granite' },
    { id: 'apron-2', name: 'an ice tower', position: [8, 236], size: [2.2, 2.8, 2.2], yaw: -20 * deg, seed: 705, hardness: 1.3, sink: 0.6, rock: 'ice' },
    { id: 'summit', name: 'the cornice crag', position: [-7, -22], size: [6, 9, 5], yaw: 8 * deg, seed: 706, hardness: 1.2, sink: 1.2, rock: 'granite' },
  ],
  regions: [
    { name: 'the upper bowl', x: [-60, 60], z: [-60, 50] },
    { name: 'the couloir', x: [-60, -2], z: [50, 180] },
    { name: 'the snowfield', x: [-2, 60], z: [50, 180] },
    { name: 'the bergschrund', x: [-60, 60], z: [180, 230] },
    { name: 'the glass apron', x: [-60, 60], z: [230, 400] },
  ],
  forest: {
    count: 120,
    seed: 523,
    keepOut: [{ path: COURSE, width: 34 }],
  },
  camera: { target: [0, 150, 80], yaw: 0, pitch: 50 * deg, distance: 100 },
  look: { sunAzimuth: 150 * deg, sunElevation: 22 * deg },
  palette: {
    snow: [0.9, 0.94, 1.0],
    ice: [0.55, 0.78, 0.95],
    bedrock: [0.28, 0.3, 0.36],
    scree: [0.5, 0.54, 0.6],
    rock: [0.32, 0.34, 0.4],
    strata: [0.4, 0.44, 0.52],
    valley: [0.78, 0.84, 0.94],
    forest: [0.16, 0.24, 0.26],
  },
  atmos: [
    { z: -40, fog: [0.82, 0.88, 0.98], density: 0.0028, sky: [0.84, 0.9, 1.0], zenith: [0.22, 0.42, 0.82], ground: [0.7, 0.76, 0.86], sun: [0.92, 0.95, 1.0], sunI: 2.4, hemiI: 1.15, exposure: 0.9 },
    { z: 140, fog: [0.74, 0.82, 0.94], density: 0.0042, sky: [0.78, 0.86, 0.97], zenith: [0.2, 0.38, 0.76], ground: [0.64, 0.7, 0.82], sun: [0.86, 0.92, 1.0], sunI: 2.1, hemiI: 1.25, exposure: 0.92 },
    { z: 320, fog: [0.8, 0.84, 0.92], density: 0.0034, sky: [0.86, 0.88, 0.96], zenith: [0.26, 0.42, 0.78], ground: [0.66, 0.7, 0.8], sun: [1.0, 0.94, 0.86], sunI: 2.3, hemiI: 1.1, exposure: 0.94 },
  ],
};

/** Candidate plans for balancing (scripts/balance.ts). */
export const WHITEOUT_COULOIR_TESTS: { name: string; route: string; plan: Plan }[] = [
  { name: 'couloir as found', route: 'couloir', plan: {} },
  { name: 'snowfield as found', route: 'snowfield', plan: {} },
  { name: 'couloir, verglas broken', route: 'couloir', plan: { verglas: { type: 'ice', broken: true } } },
  { name: 'couloir, fence cleared', route: 'couloir', plan: { 'couloir-fence': { type: 'branches', removed: true } } },
  { name: 'couloir, fence cleared + verglas broken', route: 'couloir', plan: { 'couloir-fence': { type: 'branches', removed: true }, verglas: { type: 'ice', broken: true } } },
  { name: 'snowfield, drift dug', route: 'snowfield', plan: { 'wind-drift': { type: 'soil', dug: true } } },
  { name: 'snowfield, upper fence cleared', route: 'snowfield', plan: { 'snow-fence': { type: 'branches', removed: true } } },
  { name: 'snowfield, both fences cleared', route: 'snowfield', plan: { 'snow-fence': { type: 'branches', removed: true }, 'lower-fence': { type: 'branches', removed: true } } },
  { name: 'snowfield, drift dug + lower fence cleared', route: 'snowfield', plan: { 'wind-drift': { type: 'soil', dug: true }, 'lower-fence': { type: 'branches', removed: true } } },
  { name: 'snowfield, fences cleared + debris dug', route: 'snowfield', plan: { 'snow-fence': { type: 'branches', removed: true }, 'lower-fence': { type: 'branches', removed: true }, 'cornice-debris': { type: 'soil', dug: true } } },
  { name: 'snowfield, drift dug + upper fence cleared', route: 'snowfield', plan: { 'wind-drift': { type: 'soil', dug: true }, 'snow-fence': { type: 'branches', removed: true } } },
];
