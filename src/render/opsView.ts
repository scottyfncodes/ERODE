import * as THREE from 'three';
import { CHARGE_SPOTS, pad } from '../world/places';
import { contourRot, findSite, groundUnder, type Footprint, type Ground } from '../world/footing';
import type { Terrain } from '../world/terrain';
import type { Tree } from '../world/forest';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { box, cyl, mat, PAL } from './kit';
import { OPS_MODELS, paintModel, type PatrolModels } from './patrolModels';

/**
 * The working mountain: what an avalanche operation leaves on a range over the years, placed where it
 * would actually stand, not scattered.
 *
 * - Kessel Ridge, above the slab: two rows of snow fences with the drifts they build in their lee
 *   (they stop the wind loading the start zone), three remote avalanche control exploders (a steel
 *   tube on a concrete footing, the mouth aimed down the slope) and a solar radio repeater.
 * - The pass road where it crosses the bowl's runout: AVALANCHE AREA / NO STOPPING signs both ways.
 * - Tannberg top station: an old grooming snowcat, retired where it died and half drifted in.
 * - Above the pass road (built, like most Colorado pass roads, to reach a mine): what is left of a
 *   silver mine, a timber headframe and a collapsed cabin.
 *
 * Each piece is a GITCRAFT MeshCraft model (art/3d/scripts/working_mountain.py) when it loaded, with
 * the code-built one below as its fallback; either way the lot is baked into two meshes. The solid parts
 * are returned as obstacles for the walker.
 */

export type OpsKind = 'fence' | 'exploder' | 'repeater' | 'sign' | 'snowcat' | 'headframe' | 'minecabin';

export interface OpsSpot {
  kind: OpsKind;
  x: number;
  z: number;
  rot: number;
  /** base height: the lowest ground under the footprint (plumb) or the fitted plane at the origin (conform) */
  y: number;
  /** stands upright, or lies on the ground's fitted plane (tilted with the slope) */
  mode: 'plumb' | 'conform';
  /** the fitted ground plane's normal (used by conform pieces) */
  n: [number, number, number];
}

/**
 * Each piece's footprint (its own frame, metres) and how it meets the ground. `rules` say what ground it
 * can stand on when its spot is chosen; `drape` is how high (local y) the ground snow it carries reaches:
 * those parts are laid onto the terrain under them rather than left flat.
 */
const SITING: Record<OpsKind, { f: Footprint; mode: 'plumb' | 'conform'; maxSlope: number; maxRise: number; radius: number; drape?: number }> = {
  // posts, slats and the lee drift (which runs 3.3 m downwind of the fence)
  fence: { f: { hx: 2.6, hz: 2.0, oz: 1.3 }, mode: 'plumb', maxSlope: rad(24), maxRise: 1.1, radius: 3, drape: 0.9 },
  exploder: { f: { hx: 1.0, hz: 1.0 }, mode: 'plumb', maxSlope: rad(26), maxRise: 0.8, radius: 6 },
  repeater: { f: { hx: 1.3, hz: 1.4, oz: 0.2 }, mode: 'plumb', maxSlope: rad(14), maxRise: 0.4, radius: 10, drape: 0.5 },
  sign: { f: { hx: 0.8, hz: 0.4 }, mode: 'plumb', maxSlope: rad(30), maxRise: 0.5, radius: 6, drape: 0.4 },
  snowcat: { f: { hx: 1.8, hz: 3.1 }, mode: 'conform', maxSlope: rad(16), maxRise: 1.6, radius: 30 },
  headframe: { f: { hx: 1.7, hz: 2.4, oz: 1.9 }, mode: 'plumb', maxSlope: rad(20), maxRise: 0.7, radius: 10, drape: 1.7 },
  minecabin: { f: { hx: 2.7, hz: 2.2 }, mode: 'plumb', maxSlope: rad(14), maxRise: 0.5, radius: 24, drape: 0.6 },
};
function rad(d: number) {
  return (d * Math.PI) / 180;
}

const RIDGE_PAD = pad('ridge');

/** Off the roads and tracks, the charge spots, the ridge pad (where the track arrives) and other pieces. */
function clearOf(t: Terrain, placed: OpsSpot[], kind: OpsKind) {
  return (x: number, z: number) => {
    const r = t.onRoute(x, z, 0);
    if (kind !== 'sign' && r && r.d < r.route.width + 2.5) return false;
    if (kind === 'sign') {
      // a sign stands at the roadside: beside the road, never on it
      const near = t.onRoute(x, z, 10);
      if (!near || near.d < near.route.width * 0.5 + 0.8 || near.d > near.route.width * 0.5 + 4) return false;
    }
    for (const c of CHARGE_SPOTS) if (Math.hypot(x - c.x, z - c.z) < 13) return false;
    if (kind !== 'repeater' && Math.hypot(x - RIDGE_PAD.x, z - RIDGE_PAD.z) < 19) return false;
    for (const p of placed) {
      const gap = p.kind === 'fence' && kind === 'fence' ? 4.4 : 7;
      if (Math.hypot(x - p.x, z - p.z) < gap) return false;
    }
    return true;
  };
}

function seat(kind: OpsKind, x: number, z: number, rot: number, g: Ground): OpsSpot {
  const m = SITING[kind].mode;
  return { kind, x, z, rot, mode: m, y: m === 'plumb' ? g.min : g.y, n: [g.nx, g.ny, g.nz] };
}

/**
 * Put a piece down at the nearest good ground to (x, z). If there is none within its radius, look twice as
 * far, then accept somewhat steeper and less even ground; only if all of that fails does it stand where
 * asked (still seated by its footprint, so nothing floats).
 */
function place(t: Terrain, placed: OpsSpot[], kind: OpsKind, x: number, z: number, rot: number, strict = false): OpsSpot | null {
  const S = SITING[kind];
  const clear = clearOf(t, placed, kind);
  const tries = [
    { maxSlope: S.maxSlope, maxRise: S.maxRise, radius: S.radius, clear },
    ...(strict
      ? []
      : [
          { maxSlope: S.maxSlope, maxRise: S.maxRise, radius: S.radius * 2 + 4, clear },
          { maxSlope: S.maxSlope + rad(8), maxRise: S.maxRise * 1.8, radius: S.radius * 2 + 4, clear },
        ]),
  ];
  let site = null;
  for (const r of tries) if ((site = findSite(t, x, z, rot, S.f, r))) break;
  if (!site && strict) return null;
  const spot = site ? seat(kind, site.x, site.z, rot, site.g) : seat(kind, x, z, rot, groundUnder(t, x, z, rot, S.f));
  placed.push(spot);
  return spot;
}

const memo = new WeakMap<Terrain, OpsSpot[]>();

/**
 * Where everything stands (world metres; rot about +y, facing -z at 0), chosen from the terrain itself.
 *
 * - Snow fences: rows across the shelf at the top of Kessel Bowl, where the wind loads the start zone.
 *   Each fence follows the contour (its drift on the downhill, lee side) on ground gentle and even
 *   enough for it; where the shelf turns to rock a row simply leaves a gap, as real fence lines do.
 * - Exploders over the loaded slopes, aimed down into the start zone.
 * - The radio repeater on the knoll at the north-west corner of the ridge pad, where the ridge track
 *   arrives, so you see it on the skyline as you come up and from the helicopter over the bowl.
 * - The warning signs where the pass road crosses the runout, facing the traffic.
 * - The old snowcat parked on the nearest gentle ground east of the top station, lying on the slope.
 * - The silver mine above the pass road: the headframe over its shaft, the cabin on the nearest bench.
 */
export function opsSpots(t: Terrain): OpsSpot[] {
  const had = memo.get(t);
  if (had) return had;
  const out: OpsSpot[] = [];
  // the exploders first: the fences keep clear of them
  for (const x of [-172, -112, -66]) place(t, out, 'exploder', x, -474, Math.PI);
  // the repeater on the pad's north-west knoll, panel to the south
  place(t, out, 'repeater', -236, -484, 0.25);
  // fence rows along the shelf (east, the lower and upper staggered rows; west, along the pad's back rim)
  for (const [x0, x1, z, phase] of [
    [-100, -20, -469, 0],
    [-98, -22, -481, 2.4],
    [-238, -192, -492, 0],
  ] as const)
    for (let x = x0 + phase; x <= x1; x += 4.9) {
      const zz = z + Math.sin(x * 0.07) * 1.5;
      // across the fall line, its back (and its drift) downhill: the fence faces up into the wind
      const rot = contourRot(t, x, zz) + Math.PI;
      place(t, out, 'fence', x, zz, rot, true);
    }
  place(t, out, 'sign', -133, -36, Math.atan2(0.37, 0.93));
  place(t, out, 'sign', -268, -140, Math.atan2(-0.95, 0.3) + Math.PI);
  const top = pad('lifttop');
  place(t, out, 'snowcat', top.x + 44, top.z + 16, 2.6);
  const head = place(t, out, 'headframe', -358, -224, 2.8);
  place(t, out, 'minecabin', (head?.x ?? -358) + 14, (head?.z ?? -224) + 9, 2.3);
  memo.set(t, out);
  return out;
}

/** The ground-snow height (local y) a piece's drifts reach, if it carries any. */
export const drapeHeight = (k: OpsKind) => SITING[k].drape;
/** A piece's footprint (for checks). */
export const opsFootprint = (k: OpsKind) => SITING[k].f;
export { groundUnder };

/** Collision circles for the solid pieces (the fences are open slats you can step through gaps in). */
export function opsObstacles(t: Terrain): Tree[] {
  const r: Partial<Record<OpsSpot['kind'], number>> = { exploder: 1.1, repeater: 1.2, sign: 0.3, snowcat: 2.6, headframe: 1.6, minecabin: 2.8 };
  return opsSpots(t)
    .filter((s) => r[s.kind])
    .map((s) => ({ x: s.x, z: s.z, y: t.height(s.x, s.z), h: 3, r: r[s.kind]!, rot: s.rot, snow: 0 }));
}

const TIMBER = 0x6f5b4c;
const TIMBER_OLD = 0x5a4a3f;
const STEEL = 0x8c9298;
const CONCRETE = 0x9a9893;
const CAT_RED = 0xa4473a;

function snowCap(w: number, d: number, h: number): THREE.Mesh {
  const g = new THREE.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(w, h * 2, d);
  return new THREE.Mesh(g, mat(PAL.snow));
}

function fence(): THREE.Group {
  const g = new THREE.Group();
  const wood = mat(TIMBER_OLD);
  for (const x of [-2.1, 2.1]) g.add(box(0.14, 2.6, 0.14, wood, x, 1.1, 0));
  // slats with gaps: a fence that slows the wind rather than stopping it
  for (let i = 0; i < 6; i++) g.add(box(4.5, 0.14, 0.04, wood, 0, 0.35 + i * 0.32, 0));
  // a raking brace on the windward side
  const brace = box(0.1, 2.4, 0.1, wood, 0, 0.9, -0.7);
  brace.rotation.x = 0.55;
  g.add(brace);
  // the drift it builds in its lee, and a little snow along the top rail
  const drift = snowCap(5.0, 3.6, 0.62);
  drift.position.set(0, -0.12, 1.5);
  g.add(drift);
  g.add(box(4.4, 0.08, 0.16, mat(PAL.snow), 0, 2.27, 0));
  return g;
}

function exploder(): THREE.Group {
  const g = new THREE.Group();
  const steel = mat(STEEL);
  g.add(box(1.8, 0.9, 1.8, mat(CONCRETE), 0, 0.2, 0));
  g.add(cyl(0.3, 0.3, 4.2, 10, steel, 0, 2.6, 0));
  // the bent tube: over the top and down toward the slope, a flared mouth
  const arm = cyl(0.26, 0.26, 2.4, 10, steel, 0, 4.6, 1.0);
  arm.rotation.x = Math.PI / 2 - 0.35;
  g.add(arm);
  const mouth = cyl(0.42, 0.26, 0.5, 12, mat(0x2b2f33), 0, 4.15, 2.15);
  mouth.rotation.x = Math.PI / 2 - 0.35;
  g.add(mouth);
  g.add(cyl(0.32, 0.32, 0.3, 10, mat(PAL.yellow), 0, 1.6, 0));
  // control box, gas bottles under a little roof, and the snow on it all
  g.add(box(0.6, 0.8, 0.4, mat(0xd2c9a8), 0.95, 1.05, -0.3));
  g.add(box(1.8, 0.18, 1.8, mat(PAL.snow), 0, 0.72, 0));
  g.add(box(0.7, 0.1, 0.5, mat(PAL.snow), 0.95, 1.5, -0.3));
  return g;
}

function repeater(): THREE.Group {
  const g = new THREE.Group();
  const steel = mat(STEEL);
  // a three-legged lattice mast, braced
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    g.add(cyl(0.05, 0.05, 9, 5, steel, Math.cos(a) * 0.35, 4.5, Math.sin(a) * 0.35));
  }
  for (let y = 0.8; y < 9; y += 1.1) {
    const r = cyl(0.03, 0.03, 0.75, 4, steel, 0, y, 0);
    r.rotation.z = Math.PI / 2;
    r.rotation.y = y * 1.7;
    g.add(r);
  }
  g.add(cyl(0.04, 0.04, 2.2, 5, mat(0xd8d8d8), 0.2, 10, 0));
  g.add(cyl(0.12, 0.12, 0.9, 8, mat(0xe6e3dc), -0.35, 8.4, 0.1));
  // the solar panel, tilted south, and the battery box
  const panel = box(1.6, 0.06, 1.0, mat(0x1d2a3a), 0, 3.2, 0.9);
  panel.rotation.x = -0.9;
  g.add(panel);
  g.add(box(0.8, 1.0, 0.6, mat(0x8a8e88), 0.9, 0.5, 0));
  g.add(box(0.9, 0.12, 0.7, mat(PAL.snow), 0.9, 1.05, 0));
  return g;
}

let signTex: THREE.Texture | null = null;
function warningTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  if (signTex) return signTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#5d5a55';
  g.fillRect(0, 0, 256, 256);
  // the diamond
  g.save();
  g.translate(128, 128);
  g.rotate(Math.PI / 4);
  g.fillStyle = '#e5b021';
  g.fillRect(-84, -84, 168, 168);
  g.strokeStyle = '#1b1b1b';
  g.lineWidth = 7;
  g.strokeRect(-78, -78, 156, 156);
  g.restore();
  g.fillStyle = '#141414';
  g.textAlign = 'center';
  g.font = '800 30px "Jost", "Arial Narrow", sans-serif';
  g.fillText('AVALANCHE', 128, 118);
  g.fillText('AREA', 128, 150);
  g.font = '700 17px "Jost", Arial, sans-serif';
  g.fillText('NO STOPPING', 128, 178);
  // weathering: a few scuffs and a rust run from the bolts
  g.fillStyle = 'rgba(120,70,30,0.35)';
  g.fillRect(124, 40, 4, 26);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return (signTex = t);
}

function warningSign(): THREE.Group {
  const g = new THREE.Group();
  const steel = mat(STEEL);
  g.add(cyl(0.05, 0.05, 2.6, 6, steel, -0.5, 1.3, 0), cyl(0.05, 0.05, 2.6, 6, steel, 0.5, 1.3, 0));
  const tex = warningTexture();
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), tex ? new THREE.MeshLambertMaterial({ map: tex }) : mat(PAL.yellow));
  face.position.set(0, 2.2, 0.06);
  g.add(face);
  g.add(box(1.5, 1.5, 0.04, mat(0x55534e), 0, 2.2, 0.02));
  g.add(box(1.0, 0.1, 0.3, mat(PAL.snow), 0, 3.0, 0.02));
  return g;
}

function snowcat(): THREE.Group {
  const g = new THREE.Group();
  const paint = mat(CAT_RED);
  const dark = mat(0x23262a);
  // tracks, hull, cab, a blade at the front: a grooming machine, decades old
  for (const x of [-1.15, 1.15]) {
    g.add(box(0.8, 0.85, 4.8, dark, x, 0.42, 0));
    g.add(box(0.82, 0.08, 4.4, mat(0x4a4d50), x, 0.88, 0));
  }
  g.add(box(2.4, 1.0, 4.0, paint, 0, 1.3, 0.1));
  g.add(box(2.0, 1.3, 1.9, paint, 0, 2.4, 0.7));
  g.add(box(2.02, 0.75, 1.5, mat(0x2e3b44), 0, 2.55, 0.62));
  const blade = box(3.6, 1.1, 0.25, mat(0x6d6a63), 0, 0.75, -2.75);
  blade.rotation.x = 0.25;
  g.add(blade);
  g.add(box(2.2, 0.3, 0.8, mat(0x5b5e60), 0, 0.6, 2.6));
  // rust coming through the paint along the hull
  g.add(box(2.42, 0.25, 3.0, mat(0x7a4c33), 0, 0.9, 0.1));
  // half drifted in: snow banked up the uphill side and lying on the roof and hood
  const bank = snowCap(4.6, 6.0, 1.9);
  bank.position.set(1.3, 0, 0.3);
  g.add(bank);
  g.add(box(2.0, 0.22, 1.9, mat(PAL.snow), 0, 3.15, 0.7));
  g.add(box(2.3, 0.18, 1.7, mat(PAL.snow), 0, 1.88, -1.0));
  // sunk a little and listing
  g.rotation.z = 0.1;
  g.position.y = -0.35;
  return g;
}

function headframe(): THREE.Group {
  const g = new THREE.Group();
  const wood = mat(TIMBER);
  const old = mat(TIMBER_OLD);
  // two raking legs and two plumb posts, cross-braced, the sheave wheel at the top
  for (const x of [-1.3, 1.3]) {
    g.add(box(0.3, 9, 0.3, wood, x, 4.5, 0));
    const leg = box(0.28, 9.6, 0.28, old, x, 4.2, 2.2);
    leg.rotation.x = -0.5;
    g.add(leg);
  }
  for (const y of [2.5, 5, 7.5]) g.add(box(2.9, 0.22, 0.22, old, 0, y, 0));
  const xb = box(0.18, 3.6, 0.18, old, 0, 3.75, 0);
  xb.rotation.z = 0.72;
  g.add(xb);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.09, 6, 18), mat(0x4c3d33));
  wheel.position.set(0, 9.4, 0.2);
  g.add(wheel);
  g.add(box(3.2, 0.3, 1.2, wood, 0, 9.0, 0.2));
  g.add(box(3.1, 0.12, 1.1, mat(PAL.snow), 0, 9.2, 0.2));
  // the collar of the shaft, drifted over, and a tailings heap stained by the ore
  g.add(box(3.4, 0.6, 3.0, old, 0, 0.1, 0));
  const tail = snowCap(7, 5, 1.6);
  tail.material = mat(0x9a7456);
  tail.position.set(3.5, -0.3, 2.5);
  g.add(tail);
  const tailSnow = snowCap(6.4, 4.4, 1.45);
  tailSnow.position.set(3.4, -0.2, 2.4);
  g.add(tailSnow);
  return g;
}

function mineCabin(): THREE.Group {
  const g = new THREE.Group();
  const old = mat(TIMBER_OLD);
  // what stands: the lower courses of the walls, one gable end
  for (let i = 0; i < 3; i++) {
    const y = 0.2 + i * 0.32;
    g.add(box(5, 0.3, 0.3, old, 0, y, -1.8), box(5, 0.3, 0.3, old, 0, y, 1.8), box(0.3, 0.3, 3.9, old, -2.4, y, 0));
  }
  g.add(box(0.3, 2.2, 3.9, old, 2.4, 1.1, 0));
  // the roof, fallen in: planks at a slant, one end on the ground
  const roof = box(4.6, 0.12, 3.6, mat(0x4f4339), -0.3, 1.0, 0);
  roof.rotation.z = 0.32;
  g.add(roof);
  const snow = box(4.4, 0.25, 3.4, mat(PAL.snow), -0.3, 1.2, 0);
  snow.rotation.z = 0.32;
  g.add(snow);
  // a stovepipe that outlasted the roof
  g.add(cyl(0.12, 0.12, 2.2, 8, mat(0x3b3532), 1.6, 1.4, 1.0));
  return g;
}

const BUILD: Record<OpsSpot['kind'], () => THREE.Group> = { fence, exploder, repeater, sign: warningSign, snowcat, headframe, minecabin: mineCabin };

/** The game's colour for each paint role of the working-mountain models (graded like the code's parts). */
const ROLE_HEX: Record<string, number> = {
  timber: TIMBER,
  timberOld: TIMBER_OLD,
  timberDark: 0x4f4339,
  steel: STEEL,
  steelDark: 0x5b5e60,
  concrete: CONCRETE,
  catRed: CAT_RED,
  rust: 0x7a4c33,
  dark: 0x23262a,
  track: 0x4a4d50,
  glass: 0x2e3b44,
  blade: 0x6d6a63,
  snow: PAL.snow,
  groundSnow: PAL.snow,
  yellow: PAL.yellow,
  control: 0xd2c9a8,
  panel: 0x1d2a3a,
  panelCell: 0x2f4a66,
  battery: 0x8a8e88,
  whip: 0xd8d8d8,
  antenna: 0xe6e3dc,
  plate: 0x55534e,
  tailings: 0x9a7456,
  pipe: 0x3b3532,
  rope: 0x8a7a5a,
  lamp: 0xe9c46a,
};

/** A working-mountain piece from its MeshCraft model, standing as the code-built one did. */
function modelled(kind: OpsSpot['kind'], src: THREE.Object3D): THREE.Group {
  const paint = Object.fromEntries(Object.entries(ROLE_HEX).map(([r, h]) => [r, mat(h)]));
  const m = paintModel(src, paint, (hex) => mat(hex));
  const g = new THREE.Group();
  g.add(m);
  if (kind === 'sign') {
    // the printed face is the game's own canvas, on the model's backing plate
    const tex = warningTexture();
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), tex ? new THREE.MeshLambertMaterial({ map: tex }) : mat(PAL.yellow));
    face.position.set(0, 2.2, 0.06);
    g.add(face);
  }
  if (kind === 'snowcat') {
    // modelled upright on the ground: sunk a little and listing, as the code's
    m.rotation.z = 0.1;
    g.position.y = -0.35;
  }
  return g;
}

const tmpV = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
/** Lay the vertices of a world-space geometry that sit below `reach` (in the holder's frame) onto the terrain. */
function drape(geo: THREE.BufferGeometry, holder: THREE.Object3D, reach: number, t: Terrain) {
  tmpM.copy(holder.matrixWorld).invert();
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    tmpV.fromBufferAttribute(pos, i);
    const wx = tmpV.x;
    const wz = tmpV.z;
    const local = tmpV.applyMatrix4(tmpM).y;
    if (local > reach) continue;
    pos.setY(i, t.height(wx, wz) + local);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

/** Which site a piece belongs to: each site is baked on its own, so the camera culls what it cannot see. */
const SITE: Record<OpsSpot['kind'], string> = { fence: 'ridge', exploder: 'ridge', repeater: 'repeater', sign: 'pass', snowcat: 'top', headframe: 'mine', minecabin: 'mine' };

/**
 * The whole lot, baked per site (Kessel Ridge, the repeater, the pass road signs, the top station, the mine) into one
 * vertex-coloured mesh (every plain-coloured part, its material's colour per vertex) and, for the signs,
 * one textured mesh for their faces. A handful of draw calls for the whole working mountain, and only
 * the sites in view are drawn.
 */
export function buildOps(t: Terrain, models: PatrolModels = {}): THREE.Group {
  const out = new THREE.Group();
  out.name = 'ops';
  const vc = new THREE.MeshLambertMaterial({ vertexColors: true });
  const sites = new Map<string, THREE.Group>();
  const up = new THREE.Vector3(0, 1, 0);
  const n = new THREE.Vector3();
  const yaw = new THREE.Quaternion();
  for (const s of opsSpots(t)) {
    const src = models[OPS_MODELS[s.kind]];
    const g = src ? modelled(s.kind, src) : BUILD[s.kind]();
    // seated by its footprint (opsSpots): upright on the lowest ground under it, or lying on the slope
    const holder = new THREE.Group();
    holder.position.set(s.x, s.y, s.z);
    yaw.setFromAxisAngle(up, s.rot);
    if (s.mode === 'conform') holder.quaternion.setFromUnitVectors(up, n.set(...s.n)).multiply(yaw);
    else holder.quaternion.copy(yaw);
    holder.add(g);
    holder.userData.drape = src ? drapeHeight(s.kind) : undefined;
    const site = sites.get(SITE[s.kind]) ?? new THREE.Group();
    sites.set(SITE[s.kind], site);
    site.add(holder);
  }
  for (const all of sites.values()) {
    all.updateMatrixWorld(true);
    const plain: THREE.BufferGeometry[] = [];
    const textured = new Map<THREE.Material, THREE.BufferGeometry[]>();
    all.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      let geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
      if (geo.index) geo = geo.toNonIndexed();
      // ground snow (drifts, mounds, the tailings) is laid onto the terrain under it: each vertex keeps its
      // height above the piece's base, measured from the ground beneath that vertex
      let holder: THREE.Object3D | null = m.parent;
      while (holder && !('drape' in holder.userData)) holder = holder.parent;
      const reach = holder?.userData.drape as number | undefined;
      if (reach !== undefined && (m.userData.role === 'groundSnow' || m.userData.role === 'tailings')) drape(geo, holder!, reach, t);
      const mt = m.material as THREE.MeshLambertMaterial;
      if (mt.map) {
        for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
        textured.set(mt, [...(textured.get(mt) ?? []), geo]);
        return;
      }
      for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
      const n = geo.getAttribute('position').count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.set([mt.color.r, mt.color.g, mt.color.b], i * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      plain.push(geo);
    });
    const add = (geo: THREE.BufferGeometry | null, m: THREE.Material) => {
      if (!geo) return;
      const mesh = new THREE.Mesh(geo, m);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      out.add(mesh);
    };
    if (plain.length) add(mergeGeometries(plain, false), vc);
    for (const [m, geos] of textured) add(mergeGeometries(geos, false), m);
  }
  return out;
}
