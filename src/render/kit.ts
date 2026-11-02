import * as THREE from 'three';

/**
 * The miniature-world kit, from SKYTRACE: chunky primitives, flat Lambert colour, clear
 * silhouettes. Everything hand-placed in the valley is built from these.
 */

const matCache = new Map<string, THREE.MeshLambertMaterial>();
export function mat(color: number, extra?: Partial<THREE.MeshLambertMaterialParameters>): THREE.MeshLambertMaterial {
  const key = extra ? '' : `${color}`;
  if (key) {
    const m = matCache.get(key);
    if (m) return m;
  }
  const m = new THREE.MeshLambertMaterial({ color, ...extra });
  if (key) matCache.set(key, m);
  return m;
}

/** A material that can be recoloured (customisation) without touching the shared cache. */
export const paint = (color: number) => new THREE.MeshLambertMaterial({ color });

export const glow = (color: number) => new THREE.MeshBasicMaterial({ color });

export const PAL = {
  snow: 0xf4f6f8,
  snowShade: 0xd9e3ee,
  log: 0x8a5a36,
  logDark: 0x5e3a22,
  logLight: 0xa8744a,
  roof: 0x3b4a58,
  roofSnow: 0xf2f5f8,
  stone: 0x8d8f91,
  stoneDark: 0x66686b,
  window: 0xffcf7a,
  windowDay: 0x7fb2cf,
  red: 0xd8382a,
  white: 0xf3efe6,
  dark: 0x262a30,
  metal: 0x9aa3ab,
  yellow: 0xf2c230,
  wood: 0xb98a55,
  green: 0x3c6b4a,
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
export function bake(g: THREE.Object3D): THREE.Group {
  g.updateMatrixWorld(true);
  const inv = g.matrixWorld.clone().invert();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  g.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material) || (m as THREE.InstancedMesh).isInstancedMesh || !visibleUpTo(m, g)) return;
    let geo = m.geometry.clone();
    geo.applyMatrix4(m.matrixWorld);
    geo.applyMatrix4(inv);
    if (geo.index) geo = geo.toNonIndexed();
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
    const list = byMat.get(m.material) ?? [];
    list.push(geo);
    byMat.set(m.material, list);
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
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array as Float32Array, o * 3);
    if (uv) uv.set(g.attributes.uv.array as Float32Array, o * 2);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
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
export function bakeInPlace(g: THREE.Object3D, keep: THREE.Object3D[] = []) {
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
  const baked = bake(g);
  g.clear();
  for (const m of [...baked.children]) g.add(m);
  for (const k of kept) g.add(k);
}
