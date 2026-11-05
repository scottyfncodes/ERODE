import * as THREE from 'three';

/**
 * The miniature-world kit, from SKYTRACE: chunky primitives, flat Lambert colour, clear
 * silhouettes. Everything hand-placed in the valley is built from these.
 */

/**
 * The high-country grade: every colour the valley is built from passes through this once, when its
 * material is made, so even a one-off colour belongs to a working Colorado mountain. Paint weathers
 * at altitude: saturation settles (more for the pale, chalky colours), darks stay a cold near-neutral
 * instead of black, greens lean olive, and the old storybook pastels are mapped to what a mountain
 * operation actually paints things.
 */
const _c = new THREE.Color();
const _hsl = { h: 0, s: 0, l: 0 };
/** the storybook colours, and what they became */
const REPAINT: Record<number, number> = {
  0x8fbfa8: 0x4d6152, // the garage's mint boards: forest-service green
  0xd98b8f: 0x8a4a3e, // blush trim: faded barn red
  0x8e3f4c: 0x5e2c27, // raspberry: oxblood
  0xc8747f: 0x7d6150, // painted timber: weathered timber
  0x7fd3e8: 0x6f9bb0, // sky-blue paint: a cold slate blue
  0xcfe8f5: 0xc9d6df,
  0x8fc4dc: 0x6a8ea3,
  0x2a9d8f: 0x3e6b63, // teal: spruce
  0xc8e05a: 0xa8b04a, // lime: lichen
};
export function grade(hex: number): number {
  const rep = REPAINT[hex];
  if (rep !== undefined) hex = rep;
  // in sRGB, the space the colours were picked in
  _c.setHex(hex, THREE.SRGBColorSpace).getHSL(_hsl, THREE.SRGBColorSpace);
  let { h, s, l } = _hsl;
  // no pure blacks: near-black lifts a little toward a cold slate
  if (l < 0.2) {
    const k = 1 - l / 0.2;
    let dh = 0.6 - h;
    if (dh > 0.5) dh -= 1;
    if (dh < -0.5) dh += 1;
    h += dh * k * 0.4;
    s = Math.max(s, 0.08 * k);
  }
  l = 0.1 + l * 0.86;
  // weathered, not neon; chalky pastels lose the most
  s = Math.min(s, 0.68) * (l > 0.7 ? 0.7 : 0.88);
  // greens lean olive
  if (h > 0.22 && h < 0.45) h -= 0.02;
  _c.setHSL(((h % 1) + 1) % 1, s, l, THREE.SRGBColorSpace);
  return _c.getHex(THREE.SRGBColorSpace);
}

const matCache = new Map<string, THREE.MeshLambertMaterial>();
export function mat(color: number, extra?: Partial<THREE.MeshLambertMaterialParameters>): THREE.MeshLambertMaterial {
  const key = extra ? '' : `${color}`;
  if (key) {
    const m = matCache.get(key);
    if (m) return m;
  }
  const m = new THREE.MeshLambertMaterial({ color: grade(color), ...extra });
  if (key) matCache.set(key, m);
  return m;
}

/** A material that can be recoloured (customisation) without touching the shared cache. */
export const paint = (color: number) => new THREE.MeshLambertMaterial({ color: grade(color) });

/** Recolour a `paint` material through the same grade. */
export const repaint = (m: THREE.MeshLambertMaterial, color: number) => m.color.setHex(grade(color));

/**
 * Faceted: the same storybook colour, flat shaded, so a figure reads as cut polygons like the
 * terrain it walks on instead of smooth plastic. Cached per colour; `facetPaint` is recolourable.
 */
/**
 * Out on the mountain things carry snow: a light dusting wherever a surface faces the sky (shoulders,
 * the top of the pack, a hat, Koda's back, the toes of the boots), in world space, so it stays on top
 * whatever the figure is doing.
 */
function dusted(m: THREE.MeshLambertMaterial): THREE.MeshLambertMaterial {
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      {
        vec3 nW = (vec4(normal, 0.0) * viewMatrix).xyz;
        float dust = smoothstep(0.5, 0.9, nW.y) * 0.42;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.94, 0.98), dust);
      }`,
    );
  };
  m.customProgramCacheKey = () => 'facet-dusted';
  return m;
}
const facetCache = new Map<number, THREE.MeshLambertMaterial>();
export function facet(color: number): THREE.MeshLambertMaterial {
  let m = facetCache.get(color);
  if (!m) facetCache.set(color, (m = dusted(new THREE.MeshLambertMaterial({ color: grade(color), flatShading: true }))));
  return m;
}
export const facetPaint = (color: number) => dusted(new THREE.MeshLambertMaterial({ color: grade(color), flatShading: true }));

/** A cut gem: an icosahedron (detail 0 or 1), the faceted building block of the people and Koda. */
export function gem(r: number, m: THREE.Material | number, x = 0, y = 0, z = 0, detail = 1): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(r, detail), typeof m === 'number' ? facet(m) : m);
  mesh.position.set(x, y, z);
  return mesh;
}

export const glow = (color: number) => new THREE.MeshBasicMaterial({ color });

/**
 * The Kessel storybook palette (art/rockslide-palette.json): a painted Swiss valley. Powder-blue
 * sky over cream snow with lavender shade, teal spruce, raspberry and mustard chalets with cream
 * trim under burgundy roofs; the patrol's tomato red and cream cross wherever help is.
 */
export const PAL = {
  snow: 0xf1f4f8,
  snowShade: 0xc9d4e6,
  // Colorado working timber: board-and-batten and logs weathered grey-brown by sun at altitude
  log: 0x7d6150,
  logDark: 0x4e3b30,
  logLight: 0xa48a74,
  // standing-seam metal roofs, dark, so the snow on them reads
  roof: 0x353d3c,
  roofSnow: 0xf2f5f8,
  stone: 0x8e8a86,
  stoneDark: 0x5d5a57,
  window: 0xffcf8a,
  windowDay: 0x7f9fb3,
  // patrol red (the jackets, the cross), deeper than a toy red
  red: 0xc0352a,
  white: 0xe9e6df,
  dark: 0x24272c,
  // galvanised and painted steel
  metal: 0x9aa0a6,
  yellow: 0xd9a429,
  wood: 0x96785a,
  // forest-service green
  green: 0x3e5a48,
  // the people: technical shells and soft-shell pants, worn boots
  trousers: 0x2b2f37,
  boot: 0x2b2420,
  sock: 0xd9d2c3,
  mitt: 0x2a2d33,
  brass: 0xc29a45,
  pack: 0x3d444c,
  packDark: 0x2c3238,
  hair: 0x5a3a26,
  // the mining-town row in Hollin: barn red, slate blue, ochre, sage, weathered grey
  mint: 0x7c917f,
  powder: 0x5d7286,
  mustard: 0xb5863a,
  blush: 0x8f3c2f,
  lavender: 0x84878a,
  burgundy: 0x5b2a26,
};

export function box(w: number, h: number, d: number, m: THREE.Material | number, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof m === 'number' ? mat(m) : m);
  mesh.position.set(x, y, z);
  return mesh;
}

export function cyl(rt: number, rb: number, h: number, seg: number, m: THREE.Material | number, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), typeof m === 'number' ? mat(m) : m);
  mesh.position.set(x, y, z);
  return mesh;
}

export function ball(r: number, m: THREE.Material | number, x = 0, y = 0, z = 0, seg = 12): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(4, Math.round(seg * 0.7))), typeof m === 'number' ? mat(m) : m);
  mesh.position.set(x, y, z);
  return mesh;
}

/** A gable roof: triangular prism along x, eaves at y = 0, ridge at y = h, width d across. */
export function gable(w: number, h: number, d: number, m: THREE.Material | number): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(-d / 2, 0);
  shape.lineTo(d / 2, 0);
  shape.lineTo(0, h);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  geo.rotateY(Math.PI / 2);
  geo.translate(-w / 2, 0, 0);
  return new THREE.Mesh(geo, typeof m === 'number' ? mat(m) : m);
}

/** Two roof planes with snow on top: an alpine roof with a deep overhang. */
export function snowRoof(w: number, d: number, pitchH: number, roofColor = PAL.roof, snowDepth = 0.28): THREE.Group {
  const g = new THREE.Group();
  const half = d / 2;
  const slopeLen = Math.hypot(half, pitchH);
  const ang = Math.atan2(pitchH, half);
  for (const s of [-1, 1]) {
    const plane = box(w, 0.22, slopeLen, roofColor);
    plane.position.set(0, pitchH / 2, (s * half) / 2);
    plane.rotation.x = s * ang;
    const snow = box(w - 0.1, snowDepth, slopeLen - 0.15, PAL.roofSnow);
    snow.position.set(0, pitchH / 2 + 0.2, (s * half) / 2 - s * 0.02);
    snow.rotation.x = s * ang;
    g.add(plane, snow);
  }
  // the snow cornice along the eaves
  for (const s of [-1, 1]) {
    const lip = cyl(0.18, 0.18, w - 0.2, 6, PAL.roofSnow);
    lip.rotation.z = Math.PI / 2;
    lip.position.set(0, 0.05, s * (half - 0.05));
    g.add(lip);
  }
  return g;
}

/** A log wall: stacked round logs with the ends poking out at the corners. */
export function logWall(len: number, h: number, color = PAL.log): THREE.Group {
  const g = new THREE.Group();
  const r = 0.17;
  const n = Math.max(2, Math.round(h / (r * 2)));
  const geo = new THREE.CylinderGeometry(r, r, len + 0.5, 7);
  geo.rotateZ(Math.PI / 2);
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(geo, mat(i % 2 ? color : shade(color, 0.92)));
    m.position.y = r + i * r * 2;
    g.add(m);
  }
  return g;
}

export function shade(c: number, k: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * k));
  const gg = Math.min(255, Math.round(((c >> 8) & 255) * k));
  const b = Math.min(255, Math.round((c & 255) * k));
  return (r << 16) | (gg << 8) | b;
}

/** A glowing window with a frame and a sill of snow. */
export function windowPane(w: number, h: number, lit: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.add(box(w + 0.18, h + 0.18, 0.1, PAL.logDark));
  const pane = box(w, h, 0.12, lit);
  pane.position.z = 0.02;
  g.add(pane);
  g.add(box(0.06, h, 0.14, PAL.logDark, 0, 0, 0.03));
  g.add(box(w, 0.06, 0.14, PAL.logDark, 0, 0, 0.03));
  g.add(box(w + 0.3, 0.12, 0.3, PAL.roofSnow, 0, -h / 2 - 0.12, 0.1));
  return g;
}

/** Make every mesh in a group cast and receive shadows. */
export function shadows(o: THREE.Object3D, cast = true, receive = true): THREE.Object3D {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = cast;
      m.receiveShadow = receive;
    }
  });
  return o;
}

/**
 * Merge a static group into as few meshes as possible (one per material), keeping the group's own
 * placement. Lights and other non-mesh children are not carried over: keep those outside.
 */
/** The one vertex-coloured material every colour-baked mesh shares (see bake). */
let vertexColored: THREE.MeshLambertMaterial | null = null;

/** A plain Lambert colour (no texture, no glow, opaque): one that can become a vertex colour. */
const plainColor = (m: THREE.Material): m is THREE.MeshLambertMaterial => {
  const l = m as THREE.MeshLambertMaterial;
  return !!l.isMeshLambertMaterial && !l.map && !l.vertexColors && !l.transparent && l.emissive.getHex() === 0 && l.side === THREE.FrontSide;
};

/**
 * Merge a group's meshes into one mesh per material. With `byColor`, every plain-coloured part (see
 * plainColor) goes into a single mesh that carries its material's colour per vertex, so a model painted
 * in many roles still draws in a couple of calls; glows, lit windows and textures keep their own.
 */
export function bake(g: THREE.Object3D, byColor = false): THREE.Group {
  g.updateMatrixWorld(true);
  const inv = g.matrixWorld.clone().invert();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const vc = byColor ? (vertexColored ??= new THREE.MeshLambertMaterial({ vertexColors: true })) : null;
  g.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material) || (m as THREE.InstancedMesh).isInstancedMesh || !visibleUpTo(m, g)) return;
    let geo = m.geometry.clone();
    geo.applyMatrix4(m.matrixWorld);
    geo.applyMatrix4(inv);
    if (geo.index) geo = geo.toNonIndexed();
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
    let into = m.material;
    if (vc && plainColor(m.material)) {
      const n = geo.attributes.position.count;
      const col = new Float32Array(n * 3);
      const { r, g: gg, b } = m.material.color;
      for (let i = 0; i < n; i++) col.set([r, gg, b], i * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.deleteAttribute('uv');
      into = vc;
    }
    const list = byMat.get(into) ?? [];
    list.push(geo);
    byMat.set(into, list);
  });
  const out = new THREE.Group();
  out.position.copy(g.position);
  out.quaternion.copy(g.quaternion);
  out.scale.copy(g.scale);
  for (const [m, geos] of byMat) {
    const merged = mergeAll(geos);
    const mesh = new THREE.Mesh(merged, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    out.add(mesh);
  }
  return out;
}

function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let count = 0;
  for (const g of geos) count += g.attributes.position.count;
  const withUv = geos.every((g) => !!g.attributes.uv);
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uv = withUv ? new Float32Array(count * 2) : null;
  const withColor = geos.every((g) => !!g.attributes.color);
  const col = withColor ? new Float32Array(count * 3) : null;
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array as Float32Array, o * 3);
    if (uv) uv.set(g.attributes.uv.array as Float32Array, o * 2);
    if (col) col.set(g.attributes.color.array as Float32Array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

function visibleUpTo(o: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let c: THREE.Object3D | null = o; c && c !== root; c = c.parent) if (!c.visible) return false;
  return true;
}

/**
 * Bake a group in place: everything static inside it becomes one mesh per material, while the
 * objects in `keep` (things that move, blink or toggle) and any lights stay as they are.
 */
export function bakeInPlace(g: THREE.Object3D, keep: THREE.Object3D[] = [], byColor = false) {
  g.updateMatrixWorld(true);
  const kept: THREE.Object3D[] = [];
  for (const k of keep) {
    g.attach(k);
    kept.push(k);
  }
  for (const c of [...g.children]) {
    const inst = (c as THREE.InstancedMesh).isInstancedMesh;
    const plain = !(c as THREE.Mesh).isMesh && c.type !== 'Group' && c.type !== 'Object3D';
    if (inst || plain) if (!kept.includes(c)) kept.push(c);
  }
  for (const k of kept) g.remove(k);
  const baked = bake(g, byColor);
  g.clear();
  for (const m of [...baked.children]) g.add(m);
  for (const k of kept) g.add(k);
}
