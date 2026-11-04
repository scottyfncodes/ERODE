import * as THREE from 'three';
import { BOWL, pad } from '../world/places';
import type { Terrain } from '../world/terrain';
import type { Tree } from '../world/forest';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { box, cyl, mat, PAL } from './kit';

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
 * Built from the kit and baked by material (a handful of draw calls); the solid parts are returned
 * as obstacles for the walker.
 */

export interface OpsSpot {
  kind: 'fence' | 'exploder' | 'repeater' | 'sign' | 'snowcat' | 'headframe' | 'minecabin';
  x: number;
  z: number;
  rot: number;
}

/** Where everything stands (world metres; rot about +y, facing -z at 0). */
export function opsSpots(): OpsSpot[] {
  const out: OpsSpot[] = [];
  // snow fences: two staggered rows along the ridge, across the prevailing (westerly-northwesterly) wind
  for (const [z0, x0, x1] of [
    [BOWL.zTop - 22, -178, -30],
    [BOWL.zTop - 36, -165, -40],
  ] as const)
    for (let x = x0; x <= x1; x += 4.6 + ((x * 7) % 3) * 0.4) out.push({ kind: 'fence', x, z: z0 + Math.sin(x * 0.07) * 3, rot: 0.06 * Math.sin(x * 0.11) });
  // exploders above the loaded slopes, aimed down into the start zone (south, +z)
  for (const x of [-172, -112, -66]) out.push({ kind: 'exploder', x, z: BOWL.zTop + 6, rot: Math.PI });
  out.push({ kind: 'repeater', x: -252, z: BOWL.zTop - 30, rot: 0.4 });
  // warning signs where the pass road enters the runout from either side, facing the traffic
  out.push({ kind: 'sign', x: -133, z: -36, rot: Math.atan2(0.37, 0.93) });
  out.push({ kind: 'sign', x: -268, z: -140, rot: Math.atan2(-0.95, 0.3) + Math.PI });
  // the old snowcat, east of the top station, nose down the fall line
  const top = pad('lifttop');
  out.push({ kind: 'snowcat', x: top.x + 44, z: top.z + 16, rot: 2.6 });
  // the mine the pass road was first built to reach, on the open slope above it
  out.push({ kind: 'headframe', x: -358, z: -224, rot: 2.8 });
  out.push({ kind: 'minecabin', x: -343, z: -214, rot: 2.3 });
  return out;
}

/** Collision circles for the solid pieces (the fences are open slats you can step through gaps in). */
export function opsObstacles(t: Terrain): Tree[] {
  const r: Partial<Record<OpsSpot['kind'], number>> = { exploder: 1.1, repeater: 1.2, sign: 0.3, snowcat: 2.6, headframe: 1.6, minecabin: 2.8 };
  return opsSpots()
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

/**
 * The whole lot, baked to two meshes: every plain-coloured part merged into one vertex-coloured mesh
 * (its material's colour per vertex), and the sign faces (textured) into a second. Two draw calls for
 * the whole working mountain.
 */
export function buildOps(t: Terrain): THREE.Group {
  const all = new THREE.Group();
  for (const s of opsSpots()) {
    const g = BUILD[s.kind]();
    // stand on the snow; follow the ground's lowest corner so nothing floats
    const y = Math.min(t.height(s.x - 1.5, s.z), t.height(s.x + 1.5, s.z), t.height(s.x, s.z - 1.5), t.height(s.x, s.z + 1.5));
    g.position.set(s.x, y + g.position.y, s.z);
    g.rotation.y = s.rot;
    all.add(g);
  }
  all.updateMatrixWorld(true);
  const plain: THREE.BufferGeometry[] = [];
  const textured = new Map<THREE.Material, THREE.BufferGeometry[]>();
  all.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    let geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
    if (geo.index) geo = geo.toNonIndexed();
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
  const out = new THREE.Group();
  out.name = 'ops';
  const add = (geo: THREE.BufferGeometry | null, m: THREE.Material) => {
    if (!geo) return;
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    out.add(mesh);
  };
  add(mergeGeometries(plain, false), new THREE.MeshLambertMaterial({ vertexColors: true }));
  for (const [m, geos] of textured) add(mergeGeometries(geos, false), m);
  return out;
}
