import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PatrollerMesh, type Pose } from '../src/render/characterMesh';
import { HuskyMesh } from '../src/render/huskyMesh';
import type { DogAnim } from '../src/actors/husky';

// The patroller and Koda as MeshCraft models (art/3d/scripts/patrol_people.py): skinned meshes on
// skeletons of the code's own joints. The same animation code must move them exactly as it moved the
// code-built figures, and the models must sit where those figures stood.

function load(id: string): Promise<THREE.Group> {
  const buf = readFileSync(`public/models/${id}.glb`);
  const ab = buf.slice().buffer as ArrayBuffer;
  return new Promise((ok, fail) => new GLTFLoader().parse(ab, '', (g) => ok(g.scene), fail));
}

/** A repeatable Math.random, so both figures blink, glance and fidget on the same frames. */
function seedRandom(seed: number) {
  let s = seed >>> 0;
  vi.spyOn(Math, 'random').mockImplementation(() => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
}
afterEach(() => vi.restoreAllMocks());

const P_JOINTS = ['body', 'pelvis', 'spine', 'chest', 'neck', 'head', 'pack', 'L.hip', 'L.knee', 'L.ankle', 'L.shoulder', 'L.elbow', 'R.hip', 'R.knee', 'R.ankle', 'R.shoulder', 'R.elbow'];
const pick = (o: object, path: string): THREE.Object3D => path.split('.').reduce((a: any, k) => a[k], o);

/**
 * Each named joint's full world transform. (Matrices, not quaternions: the spine squashes, so the
 * chain above the chest carries shear, and a quaternion pulled out of a sheared matrix is not unit
 * length, which would make identical joints look different.)
 */
function joints(root: THREE.Object3D, owner: object, names: string[]) {
  root.updateMatrixWorld(true);
  return names.map((n) => ({ n, m: pick(owner, n).matrixWorld.clone() }));
}
const matrixGap = (a: THREE.Matrix4, b: THREE.Matrix4) => Math.max(...a.elements.map((v, i) => Math.abs(v - b.elements[i])));

/** Bounds of what is drawn: skinned meshes in their current pose, other meshes as they are. */
function drawnBounds(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (let p: THREE.Object3D | null = m; p; p = p.parent) if (!p.visible) return;
    if ((m as THREE.SkinnedMesh).isSkinnedMesh) {
      const sm = m as THREE.SkinnedMesh;
      sm.skeleton.update();
      const v = new THREE.Vector3();
      const pos = sm.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) box.expandByPoint(sm.applyBoneTransform(i, v.fromBufferAttribute(pos, i)).applyMatrix4(sm.matrixWorld));
    } else box.union(new THREE.Box3().setFromObject(m));
  });
  return box;
}

/** Every drawn vertex of every shown skinned mesh lies inside that mesh's culling sphere. */
function insideCullSphere(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  let worst = -Infinity;
  root.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh) return;
    expect(sm.frustumCulled).toBe(true);
    for (let p: THREE.Object3D | null = sm; p; p = p.parent) if (!p.visible) return;
    sm.skeleton.update();
    const v = new THREE.Vector3();
    const pos = sm.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) worst = Math.max(worst, sm.applyBoneTransform(i, v.fromBufferAttribute(pos, i)).distanceTo(sm.boundingSphere!.center) - sm.boundingSphere!.radius);
  });
  return worst;
}

const visibleTris = (root: THREE.Object3D) => {
  let n = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (let p: THREE.Object3D | null = m; p; p = p.parent) if (!p.visible) return;
    const g = m.geometry;
    n += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return n;
};

const PLAN: [Pose, number, number][] = [
  ['idle', 0, 1.5],
  ['walk', 1.4, 2],
  ['run', 5, 1.5],
  ['walk', 1.2, 1],
  ['ride', 8, 1],
  ['ski', 6, 1],
  ['work', 0, 1],
  ['pet', 0, 1],
  ['carry', 1.2, 1],
  ['sleep', 0, 1],
  ['idle', 0, 6],
];

describe('the patroller model (MeshCraft, skinned)', () => {
  it('moves exactly as the code-built figure: every joint, every frame, through every pose', async () => {
    const src = await load('rs_patroller');
    const run = (modelled: boolean) => {
      seedRandom(7);
      const p = new PatrollerMesh();
      if (modelled) expect(p.useModel(src)).toBe(true);
      // cloning a model draws ids from Math.random: start both figures' blinks and fidgets level
      seedRandom(8);
      const frames: ReturnType<typeof joints>[] = [];
      let stride = 0;
      for (const [pose, speed, secs] of PLAN) {
        p.setSkis(pose === 'ski');
        for (let t = 0; t < secs; t += 1 / 30) {
          stride += speed / 30;
          p.group.rotation.y += pose === 'run' ? 0.01 : 0;
          p.animate(pose, stride, speed, pose === 'ride' ? 0.4 : 0, 1 / 30, pose === 'walk' ? 0.1 : 0);
          frames.push(joints(p.group, p, P_JOINTS));
          if (modelled && frames.length % 15 === 0) expect(insideCullSphere(p.group), `culling sphere, ${pose}`).toBeLessThan(0);
        }
      }
      vi.restoreAllMocks();
      return { p, frames };
    };
    const a = run(false);
    const b = run(true);
    expect(b.frames.length).toBe(a.frames.length);
    let worst = 0;
    for (let f = 0; f < a.frames.length; f++)
      for (let j = 0; j < P_JOINTS.length; j++) {
        const gap = matrixGap(a.frames[f][j].m, b.frames[f][j].m);
        worst = Math.max(worst, gap);
        expect(gap, `${P_JOINTS[j]} frame ${f}`).toBeLessThan(1e-9);
      }
    expect(worst).toBeLessThan(1e-9);
  });

  it('stands where the code-built figure stood, at about its weight, in fewer draw calls', async () => {
    const src = await load('rs_patroller');
    const code = new PatrollerMesh();
    const model = new PatrollerMesh();
    expect(model.useModel(src)).toBe(true);
    for (const pose of ['idle', 'walk', 'ride'] as Pose[]) {
      for (let i = 0; i < 40; i++) {
        code.animate(pose, i * 0.05, pose === 'walk' ? 1.4 : 0, 0, 1 / 30);
        model.animate(pose, i * 0.05, pose === 'walk' ? 1.4 : 0, 0, 1 / 30);
      }
      const a = drawnBounds(code.group);
      const b = drawnBounds(model.group);
      for (const k of ['x', 'y', 'z'] as const) {
        expect(Math.abs(a.min[k] - b.min[k]), `${pose} min ${k}`).toBeLessThan(0.06);
        expect(Math.abs(a.max[k] - b.max[k]), `${pose} max ${k}`).toBeLessThan(0.06);
      }
    }
    // boots on the snow as before (both sink a few cm into it)
    const a = drawnBounds(code.group);
    const b = drawnBounds(model.group);
    expect(Math.abs(a.min.y - b.min.y)).toBeLessThan(0.02);
    // about the same triangles drawn, far fewer meshes
    expect(visibleTris(model.group)).toBeLessThan(visibleTris(code.group) * 1.05);
    const drawn = (root: THREE.Object3D) => {
      let n = 0;
      root.traverse((o) => {
        if (!(o as THREE.Mesh).isMesh) return;
        for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return;
        n++;
      });
      return n;
    };
    expect(drawn(model.group)).toBeLessThan(drawn(code.group) * 0.7);
  });

  it('keeps every toggle: hats, skis on the feet or the back, the cat in the glove; villagers without the gear', async () => {
    const src = await load('rs_patroller');
    const p = new PatrollerMesh();
    p.useModel(src);
    const g = p.group;
    const shown = (name: string) => g.getObjectByName(name)!.visible;
    expect(shown('pat_hat_beanie')).toBe(true);
    p.setLook(0xd4422f, 0xf6ecdc, 'hat-helmet', 0xd4422f, 0xf6ecdc, 0xf2a33a, 0xc79a62);
    expect(shown('pat_hat_beanie')).toBe(false);
    expect(shown('pat_hat_helmet')).toBe(true);
    p.setSkis(true);
    expect(shown('pat_ski_L') && shown('pat_pole_R')).toBe(true);
    expect(shown('pat_skis_back')).toBe(false);
    p.setSkis(false);
    expect(shown('pat_ski_L')).toBe(false);
    expect(shown('pat_skis_back')).toBe(true);
    const cat = new THREE.Group();
    p.hold(cat);
    expect(cat.parent?.parent?.name).toBe('elbow_R');
    const villager = new PatrollerMesh(true);
    expect(villager.useModel(src)).toBe(true);
    expect(villager.group.getObjectByName('pat_gear')).toBeUndefined();
    expect(villager.group.getObjectByName('pat_skis_back')).toBeUndefined();
  });

  it('shows the face under every hat, and blinks each eye about its own centre', async () => {
    const p = new PatrollerMesh();
    p.useModel(await load('rs_patroller'));
    p.group.updateMatrixWorld(true);
    const eye = p.group.getObjectByName('eye_L')!;
    const at = new THREE.Vector3();
    eye.getWorldPosition(at);
    // every hat stops above the brows: nothing of it comes down over the front of the face (the
    // trapper's ear flaps hang beside it, which is the point of them)
    for (const hat of ['hat-beanie', 'hat-helmet', 'hat-trapper', 'hat-bobble']) {
      let lowest = Infinity;
      const v = new THREE.Vector3();
      p.group.getObjectByName(`pat_${hat.replace('-', '_')}`)!.traverse((o) => {
        const sm = o as THREE.SkinnedMesh;
        if (!sm.isSkinnedMesh) return;
        sm.skeleton.update();
        const pos = sm.geometry.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          sm.applyBoneTransform(i, v.fromBufferAttribute(pos, i)).applyMatrix4(sm.matrixWorld);
          if (v.z < at.z + 0.06 && Math.abs(v.x) < 0.13) lowest = Math.min(lowest, v.y);
        }
      });
      expect(lowest, `${hat} clears the eyes`).toBeGreaterThan(at.y + 0.03);
    }
    // a blink squashes the eye where it is: its centre does not move
    const eyeMesh = p.group.getObjectByName('pat_body')!;
    const before = drawnBounds(eyeMesh);
    eye.scale.y = 0.15;
    p.group.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    eye.getWorldPosition(v);
    expect(v.distanceTo(at)).toBeLessThan(1e-9);
    expect(drawnBounds(eyeMesh).min.y).toBeCloseTo(before.min.y, 6);
  });

  it('keeps the code-built figure when the model is missing or broken', async () => {
    const p = new PatrollerMesh();
    expect(p.useModel(undefined)).toBe(false);
    const broken = await load('rs_patroller');
    broken.getObjectByName('knee_L')!.name = 'kneeish';
    expect(p.useModel(broken)).toBe(false);
    expect(p.modelled).toBe(false);
    let skinned = 0;
    p.group.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && skinned++);
    expect(skinned).toBe(0);
  });
});

describe('the villagers model (MeshCraft, skinned: their own outfit on the patroller skeleton)', () => {
  it('moves exactly as the code-built villager: every joint, every frame, through every pose', async () => {
    const src = await load('rs_villager');
    const run = (modelled: boolean) => {
      seedRandom(11);
      const p = new PatrollerMesh(true);
      if (modelled) expect(p.useModel(src)).toBe(true);
      seedRandom(12);
      const frames: ReturnType<typeof joints>[] = [];
      let stride = 0;
      for (const [pose, speed, secs] of PLAN) {
        p.setSkis(pose === 'ski');
        for (let t = 0; t < secs; t += 1 / 30) {
          stride += speed / 30;
          p.animate(pose, stride, speed, pose === 'ride' ? 0.4 : 0, 1 / 30, pose === 'walk' ? 0.1 : 0);
          frames.push(joints(p.group, p, P_JOINTS));
          if (modelled && frames.length % 15 === 0) expect(insideCullSphere(p.group), `culling sphere, ${pose}`).toBeLessThan(0);
        }
      }
      vi.restoreAllMocks();
      return frames;
    };
    const a = run(false);
    const b = run(true);
    expect(b.length).toBe(a.length);
    // (every joint but the pack: the villagers carry none, and the code-built one never hangs it on them)
    for (let f = 0; f < a.length; f++)
      for (let j = 0; j < P_JOINTS.length; j++)
        if (P_JOINTS[j] !== 'pack') expect(matrixGap(a[f][j].m, b[f][j].m), `${P_JOINTS[j]} frame ${f}`).toBeLessThan(1e-9);
  });

  it('stands where the code-built villager stood, in fewer draw calls, without any patrol gear', async () => {
    const code = new PatrollerMesh(true);
    const model = new PatrollerMesh(true);
    expect(model.useModel(await load('rs_villager'))).toBe(true);
    for (const pose of ['idle', 'walk'] as Pose[]) {
      for (let i = 0; i < 40; i++) {
        code.animate(pose, i * 0.05, pose === 'walk' ? 1.4 : 0, 0, 1 / 30);
        model.animate(pose, i * 0.05, pose === 'walk' ? 1.4 : 0, 0, 1 / 30);
      }
      const a = drawnBounds(code.group);
      const b = drawnBounds(model.group);
      for (const k of ['x', 'y', 'z'] as const) {
        expect(Math.abs(a.min[k] - b.min[k]), `${pose} min ${k}`).toBeLessThan(0.06);
        expect(Math.abs(a.max[k] - b.max[k]), `${pose} max ${k}`).toBeLessThan(0.06);
      }
    }
    // the cardigan's yoke, buttons, elbow patches and fur cuffs: about 200 triangles more than the
    // code-built villager, for three villagers
    expect(visibleTris(model.group)).toBeLessThan(visibleTris(code.group) * 1.12);
    expect(model.group.getObjectByName('pat_gear')).toBeUndefined();
    expect(model.group.getObjectByName('pat_skis_back')).toBeUndefined();
  });

  it('keeps the villagers own colours, hats and skis; goggles only on the skiers', async () => {
    const p = new PatrollerMesh(true);
    expect(p.useModel(await load('rs_villager'))).toBe(true);
    const shown = (name: string) => p.group.getObjectByName(name)!.visible;
    // Greta: no goggles (a dark lens means none)
    p.setLook(0x3c6b4a, 0xe8dcc8, 'hat-bobble', 0xe9c46a, 0xf3efe6, 0x222222, 0);
    expect(shown('vil_goggles')).toBe(false);
    expect(shown('pat_hat_bobble') && !shown('pat_hat_beanie')).toBe(true);
    // Nils, the skier: goggles, helmet, skis and poles
    p.setLook(0x2f7fb8, 0xf2c230, 'hat-helmet', 0x262a30, 0xf2c230, 0x7fd3e8, 0xd8382a);
    p.setSkis(true);
    expect(shown('vil_goggles') && shown('pat_hat_helmet') && shown('pat_ski_L') && shown('pat_pole_R')).toBe(true);
    // the jacket and trim are the figure's own paint, so each villager keeps their colours
    const own = p as unknown as { jacket: THREE.Material; trim: THREE.Material };
    const painted = new Set<THREE.Material>();
    p.group.traverse((o) => (o as THREE.Mesh).isMesh && painted.add((o as THREE.Mesh).material as THREE.Material));
    expect(painted.has(own.jacket) && painted.has(own.trim)).toBe(true);
  });

  it('wears the patroller model (without the gear) when the villager file is missing', async () => {
    const { MissionProps } = await import('../src/render/missionProps');
    const { getTerrain } = await import('../src/world/terrain');
    const props = new MissionProps(getTerrain());
    expect(props.usePeople(undefined, await load('rs_patroller'))).toBe(true);
    expect(props.greta.group.getObjectByName('vil_goggles')).toBeUndefined();
    expect(props.greta.group.getObjectByName('pat_gear')).toBeUndefined();
    const fresh = new MissionProps(getTerrain());
    expect(fresh.usePeople(await load('rs_villager'), await load('rs_patroller'))).toBe(true);
    expect(fresh.nils.group.getObjectByName('vil_goggles')).toBeDefined();
    expect(new MissionProps(getTerrain()).usePeople(undefined, undefined)).toBe(false);
  });
});

const K_JOINTS = ['body', 'front', 'rear', 'head', 'jaw', 'tongue', 'earL', 'earR', 'tail.0', 'tail.1', 'tail.2', 'tail.3', ...[0, 1, 2, 3].flatMap((i) => [`legs.${i}.upper`, `legs.${i}.lower`])];
const K_PLAN: [DogAnim, number][] = [
  ['idle', 1.5],
  ['trot', 2],
  ['run', 1.5],
  ['happy', 1],
  ['bark', 1],
  ['sniff', 1],
  ['sit', 1],
  ['lie', 1],
  ['sleep', 2],
  ['ride', 1],
  ['idle', 5],
];

describe('Koda model (MeshCraft, skinned)', () => {
  it('moves exactly as the code-built Koda: every joint, every frame, through every animation', async () => {
    const src = await load('rs_koda');
    const run = (modelled: boolean) => {
      seedRandom(11);
      const k = new HuskyMesh();
      if (modelled) expect(k.useModel(src)).toBe(true);
      seedRandom(12);
      const frames: ReturnType<typeof joints>[] = [];
      const flags: boolean[][] = [];
      const chest: [THREE.Vector3, THREE.Vector3][] = [];
      let stride = 0;
      for (const [anim, secs] of K_PLAN) {
        for (let t = 0; t < secs; t += 1 / 30) {
          stride += anim === 'run' ? 0.25 : anim === 'trot' ? 0.1 : 0;
          k.animate(anim, stride, 1 / 30);
          frames.push(joints(k.group, k, K_JOINTS));
          if (modelled && frames.length % 15 === 0) expect(insideCullSphere(k.group), `culling sphere, ${anim}`).toBeLessThan(0);
          const kk = k as unknown as { tongueShow: THREE.Object3D; eyesOpen: THREE.Object3D[]; eyesShut: THREE.Object3D[] };
          flags.push([kk.tongueShow.visible, kk.eyesOpen[0].visible, kk.eyesShut[0].visible]);
          // the breathing chest: the code scales a mesh with its own proportions built in, the model a
          // bone (proportions in the geometry), so compare where it is and how much it breathes
          const ch = (k as unknown as { chestMesh: THREE.Object3D; chestBase: THREE.Vector3 });
          const cp = new THREE.Vector3();
          ch.chestMesh.getWorldPosition(cp);
          chest.push([cp, ch.chestMesh.scale.clone().divide(ch.chestBase)]);
        }
      }
      vi.restoreAllMocks();
      return { k, frames, flags, chest };
    };
    const a = run(false);
    const b = run(true);
    let worst = 0;
    for (let f = 0; f < a.frames.length; f++) {
      for (let j = 0; j < K_JOINTS.length; j++) {
        const gap = matrixGap(a.frames[f][j].m, b.frames[f][j].m);
        worst = Math.max(worst, gap);
        expect(gap, `${K_JOINTS[j]} frame ${f}`).toBeLessThan(1e-9);
      }
      expect(b.flags[f], `toggles frame ${f}`).toEqual(a.flags[f]);
      expect(a.chest[f][0].distanceTo(b.chest[f][0]), `chest frame ${f}`).toBeLessThan(1e-9);
      expect(a.chest[f][1].distanceTo(b.chest[f][1]), `breath frame ${f}`).toBeLessThan(1e-9);
    }
    expect(worst).toBeLessThan(1e-9);
    // the panting tongue and the sleeping eyes both happened
    expect(a.flags.some((x) => x[0])).toBe(true);
    expect(a.flags.some((x) => x[2])).toBe(true);
  });

  it('stands where the code-built Koda stood, breathing included, within its triangle budget', async () => {
    const src = await load('rs_koda');
    const code = new HuskyMesh();
    const model = new HuskyMesh();
    expect(model.useModel(src)).toBe(true);
    for (const anim of ['idle', 'trot', 'lie'] as DogAnim[]) {
      for (let i = 0; i < 40; i++) {
        code.animate(anim, i * 0.1, 1 / 30);
        model.animate(anim, i * 0.1, 1 / 30);
      }
      const a = drawnBounds(code.group);
      const b = drawnBounds(model.group);
      for (const k of ['x', 'y', 'z'] as const) {
        expect(Math.abs(a.min[k] - b.min[k]), `${anim} min ${k}`).toBeLessThan(0.06);
        expect(Math.abs(a.max[k] - b.max[k]), `${anim} max ${k}`).toBeLessThan(0.06);
      }
    }
    // the face pass (eyes with catchlights, brow spots, cheek ruff) is allowed what the patroller's is
    expect(visibleTris(model.group)).toBeLessThan(visibleTris(code.group) * 1.05);
  });

  it('keeps the gear toggles, and the code-built Koda when the model is unusable', async () => {
    const src = await load('rs_koda');
    const k = new HuskyMesh();
    k.useModel(src);
    const shown = (name: string) => k.group.getObjectByName(name)!.visible;
    expect(shown('koda_harness') || shown('koda_bandana')).toBe(false);
    k.setGear(0xd8382a, { main: 0xd8382a, second: 0xf3efe6, pack: true }, 0x5f9c86);
    expect(shown('koda_harness') && shown('koda_harness_pack') && shown('koda_bandana')).toBe(true);
    k.setGear(0xd8382a, null, null);
    expect(shown('koda_harness') || shown('koda_harness_pack') || shown('koda_bandana')).toBe(false);
    const fallback = new HuskyMesh();
    expect(fallback.useModel(undefined)).toBe(false);
    const broken = await load('rs_koda');
    broken.getObjectByName('tail_2')!.name = 'tailish';
    expect(fallback.useModel(broken)).toBe(false);
    expect(fallback.modelled).toBe(false);
  });
});
