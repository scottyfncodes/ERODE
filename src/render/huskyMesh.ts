import * as THREE from 'three';
import type { DogAnim } from '../actors/husky';
import { Jiggle } from './characterMesh';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { box, facet, facetPaint, gem, repaint } from './kit';
import { cullAsCharacter, dressModel, retire } from './patrolModels';

const GREY = 0x5f6873;
const DARK = 0x3a4048;
const WHITE = 0xf4f2ee;
const TAU = Math.PI * 2;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

interface Leg {
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  front: boolean;
  side: number;
}

/** A faceted leg segment hanging from its joint. */
function seg(r0: number, r1: number, len: number, m: THREE.Material): THREE.Mesh {
  const g = new THREE.CylinderGeometry(r0, r1, len, 6, 1);
  g.translate(0, -len / 2, 0);
  return new THREE.Mesh(g, m);
}

/**
 * Koda: grey saddle and mask over a white belly and face, pale blue eyes, a curled plume of a
 * tail, and the left ear that has never once stood up. Cut from facets like the valley. The
 * spine flexes between chest and hips, every leg has a working knee or hock, the tail is a
 * chain that wags in a wave, and the ears and tongue flop on springs. Forward is -z.
 */
export class HuskyMesh {
  readonly group = new THREE.Group();
  private body: THREE.Object3D = new THREE.Group();
  private front: THREE.Object3D = new THREE.Group();
  private rear: THREE.Object3D = new THREE.Group();
  private head: THREE.Object3D = new THREE.Group();
  private tail: THREE.Object3D[] = [];
  private legs: Leg[] = [];
  private earL: THREE.Object3D = new THREE.Group();
  private earR: THREE.Object3D = new THREE.Group();
  private jaw: THREE.Object3D = new THREE.Group();
  /** the tongue's joint (it lolls) and the mesh shown when panting: one object in the code-built Koda */
  private tongue: THREE.Object3D;
  private tongueShow: THREE.Object3D;
  private chestMesh: THREE.Object3D;
  /** the chest's own proportions; breathing scales it from these (the model's chest bone is 1, 1, 1) */
  private chestBase = new THREE.Vector3(1, 1.05, 0.95);
  private collar: THREE.MeshLambertMaterial;
  private harness: THREE.Object3D = new THREE.Group();
  private harnessMain: THREE.MeshLambertMaterial;
  private harnessSecond: THREE.MeshLambertMaterial;
  private pack: THREE.Object3D = new THREE.Group();
  private bandana: THREE.Object3D;
  private bandanaMat: THREE.MeshLambertMaterial;
  private eyesOpen: THREE.Object3D[] = [];
  private eyesShut: THREE.Object3D[] = [];
  /** the game's material for each palette role the MeshCraft model is painted with */
  private roles: Record<string, THREE.Material> = {};
  /** true once the MeshCraft model (public/models/rs_koda.glb) is in */
  modelled = false;
  private zzz: THREE.Group;
  private t = Math.random() * 10;
  private wag = 0;
  private tilt = 0;
  private tiltT = 2;
  private lastBodyY = 0.5;
  private lastVy = 0;
  private readonly jEarL = new Jiggle(80, 4);
  private readonly jEarR = new Jiggle(160, 9);
  private readonly jHead = new Jiggle(120, 9);

  constructor() {
    const grey = facet(GREY);
    const white = facet(WHITE);
    const dark = facet(DARK);
    this.group.add(this.body);
    this.body.position.y = 0.5;
    this.body.add(this.front, this.rear);
    // barrel: grey back over a white belly, the chest and ruff up front, the haunches behind
    const back = gem(0.3, grey, 0, 0.07, 0.02, 1);
    back.scale.set(0.92, 0.8, 1.45);
    const belly = gem(0.27, white, 0, -0.04, 0.02, 1);
    belly.scale.set(0.86, 0.74, 1.4);
    this.body.add(back, belly);
    this.chestMesh = gem(0.25, white, 0, 0.0, -0.33, 1);
    this.chestMesh.scale.set(1, 1.05, 0.95);
    const ruff = gem(0.27, grey, 0, 0.15, -0.3, 1);
    ruff.scale.set(1.06, 0.88, 0.82);
    this.front.add(this.chestMesh, ruff);
    const haunch = gem(0.25, grey, 0, 0.06, 0.34, 1);
    haunch.scale.set(1, 0.95, 1.05);
    const rump = gem(0.2, white, 0, -0.05, 0.4, 0);
    this.rear.add(haunch, rump);
    // legs: shoulder/hip, then elbow/hock, then a big snowshoe paw
    for (const [x, z, front] of [
      [-0.15, -0.34, true],
      [0.15, -0.34, true],
      [-0.15, 0.38, false],
      [0.15, 0.38, false],
    ] as const) {
      const upper = new THREE.Group();
      upper.position.set(x, -0.04, z);
      const uLen = front ? 0.23 : 0.24;
      upper.add(seg(front ? 0.08 : 0.1, 0.06, uLen + 0.04, front ? white : grey));
      if (!front) {
        const thigh = gem(0.11, grey, 0, -0.06, 0.01, 0);
        thigh.scale.set(0.8, 1.2, 1.1);
        upper.add(thigh);
      }
      const lower = new THREE.Group();
      lower.position.y = -uLen;
      lower.add(seg(0.058, 0.05, 0.22, white));
      const paw = gem(0.07, white, 0, -0.225, -0.03, 0);
      paw.scale.set(1, 0.58, 1.35);
      lower.add(paw);
      upper.add(lower);
      this.legs.push({ upper, lower, front, side: Math.sign(x) });
      (front ? this.front : this.rear).add(upper);
    }
    // head: grey cap and mask, white face, a long muzzle with a dark nose
    this.head.position.set(0, 0.3, -0.5);
    this.front.add(this.head);
    const skull = gem(0.2, grey, 0, 0.04, 0, 1);
    skull.scale.set(1, 0.88, 1.05);
    const face = gem(0.17, white, 0, -0.03, -0.08, 1);
    face.scale.set(1.06, 0.85, 1);
    const muzzle = gem(0.11, white, 0, -0.06, -0.25, 1);
    muzzle.scale.set(0.92, 0.72, 1.45);
    const nose = gem(0.045, facet(0x15171a), 0, -0.015, -0.4, 0);
    nose.scale.set(1.1, 0.8, 0.9);
    // the mask: a grey blaze over the eyes down the bridge of the nose
    const mask = gem(0.07, grey, 0, 0.06, -0.19, 0);
    mask.scale.set(0.75, 0.5, 2);
    mask.rotation.x = 0.3;
    // the jaw opens on a hinge; the tongue lolls out of it
    this.jaw.position.set(0, -0.11, -0.16);
    const jawMesh = gem(0.08, white, 0, -0.01, -0.08, 0);
    jawMesh.scale.set(0.95, 0.4, 1.4);
    this.tongue = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.015, 0.13).translate(0, 0, -0.065), facet(0xe86a7a));
    this.tongue.position.set(0, 0.012, -0.08);
    this.tongue.visible = false;
    this.tongueShow = this.tongue;
    this.jaw.add(jawMesh, this.tongue);
    for (const s of [-1, 1]) {
      const eye = gem(0.036, facet(0x8fd0f0), s * 0.085, 0.06, -0.165, 0);
      const pupil = gem(0.019, facet(0x101418), s * 0.088, 0.06, -0.196, 0);
      const shut = box(0.07, 0.012, 0.02, dark, s * 0.085, 0.06, -0.175);
      shut.visible = false;
      this.eyesOpen.push(eye, pupil);
      this.eyesShut.push(shut);
      this.head.add(eye, pupil, shut);
    }
    // ears: right stands tall, left flops over (always has)
    const ear = (g: THREE.Object3D, s: number) => {
      const e = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.19, 4), grey);
      e.position.y = 0.09;
      const inner = new THREE.Mesh(new THREE.ConeGeometry(0.048, 0.13, 4), facet(0xe8b4a8));
      inner.position.set(0, 0.075, -0.027);
      g.add(e, inner);
      g.position.set(s * 0.11, 0.16, 0.02);
      this.head.add(g);
    };
    ear(this.earL, -1);
    ear(this.earR, 1);
    this.earL.rotation.set(0.3, 0, 1.9);
    this.earR.rotation.set(0.05, 0, -0.15);
    this.head.add(skull, face, muzzle, nose, mask, this.jaw);
    // tail: a plume of four links, grey to a white tip
    let parent: THREE.Object3D = this.rear;
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      if (i === 0) g.position.set(0, 0.16, 0.5);
      else g.position.y = 0.1;
      const r = 0.075 - i * 0.004;
      const tuft = gem(r, i === 3 ? white : grey, 0, 0.055, 0, 0);
      tuft.scale.set(1, 1.35, 1);
      g.add(tuft);
      parent.add(g);
      parent = g;
      this.tail.push(g);
    }
    // gear
    this.collar = facetPaint(0xd8382a);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.03, 4, 10), this.collar);
    collar.rotation.x = Math.PI / 2 - 0.5;
    collar.position.set(0, 0.18, -0.43);
    const tag = gem(0.03, facet(0xf2c230), 0, 0.08, -0.55, 0);
    this.front.add(collar, tag);
    this.harnessMain = facetPaint(0xd8382a);
    this.harnessSecond = facetPaint(0xf3efe6);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.035, 4, 12), this.harnessMain);
    strap.position.set(0, 0.04, -0.14);
    const saddle = box(0.36, 0.06, 0.32, this.harnessMain, 0, 0.31, -0.05);
    const cross = box(0.37, 0.065, 0.08, this.harnessSecond, 0, 0.31, -0.05);
    const cross2 = box(0.08, 0.066, 0.2, this.harnessSecond, 0, 0.31, -0.05);
    this.harness.add(strap, saddle, cross, cross2);
    for (const s of [-1, 1]) this.pack.add(box(0.12, 0.2, 0.28, this.harnessSecond, s * 0.29, 0.12, 0.02));
    this.harness.add(this.pack);
    this.harness.visible = false;
    this.body.add(this.harness);
    this.bandanaMat = facetPaint(0xd8382a);
    this.roles = {
      grey,
      white,
      dark,
      noseBlack: facet(0x15171a),
      iris: facet(0x8fd0f0),
      pupil: facet(0x101418),
      earInner: facet(0xe8b4a8),
      tongue: facet(0xe86a7a),
      tag: facet(0xf2c230),
      collar: this.collar,
      harnessMain: this.harnessMain,
      harnessSecond: this.harnessSecond,
      bandana: this.bandanaMat,
    };
    this.bandana = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.2, 3), this.bandanaMat);
    this.bandana.rotation.set(Math.PI + 0.4, 0, 0);
    this.bandana.position.set(0, 0.02, -0.5);
    this.bandana.visible = false;
    this.front.add(this.bandana);
    // sleeping zs
    this.zzz = new THREE.Group();
    for (let i = 0; i < 3; i++) this.zzz.add(box(0.08 + i * 0.03, 0.02, 0.02, facet(0xffffff), 0, i * 0.18, 0));
    this.zzz.position.set(0.2, 0.9, -0.5);
    this.zzz.visible = false;
    this.group.add(this.zzz);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = true;
    });
  }

  /**
   * Swap the code-built Koda for the MeshCraft model (public/models/rs_koda.glb): a skinned mesh on a
   * skeleton whose bones are Koda's joints (same names, pivots and zero rest pose), so the animation
   * below drives the bones exactly as it drove the groups. Eyes open and shut, the tongue, harness,
   * saddlebags and bandana are separate meshes the same toggles show and hide. All or nothing: if the
   * model is unusable nothing changes and false is returned.
   */
  useModel(source: THREE.Object3D | undefined): boolean {
    if (!source) return false;
    const root = cloneSkinned(source);
    const legNames = ['FL', 'FR', 'RL', 'RR'];
    const bones = ['body', 'front', 'rear', 'chest', 'head', 'jaw', 'tongue', 'ear_L', 'ear_R', 'tail_0', 'tail_1', 'tail_2', 'tail_3'];
    for (const l of legNames) bones.push(`leg_${l}_upper`, `leg_${l}_lower`);
    const parts = ['koda_body', 'koda_eyes_open', 'koda_eyes_shut', 'koda_tongue', 'koda_harness', 'koda_harness_pack', 'koda_bandana'];
    const n = dressModel(root, [...bones, ...parts], this.roles);
    if (!n) return false;
    // one sphere that holds every pose, from a stretched gallop to a jump
    cullAsCharacter(root, new THREE.Vector3(0, 0.5, -0.1), 1.3);
    // every joint picks up where the code-built one is now (the ears' set, the current pose)
    const pairs: [THREE.Object3D, THREE.Object3D][] = [
      [this.body, n.body],
      [this.front, n.front],
      [this.rear, n.rear],
      [this.head, n.head],
      [this.jaw, n.jaw],
      [this.tongue, n.tongue],
      [this.earL, n.ear_L],
      [this.earR, n.ear_R],
      ...this.tail.map((t, i) => [t, n[`tail_${i}`]] as [THREE.Object3D, THREE.Object3D]),
      ...this.legs.flatMap((l, i) => [
        [l.upper, n[`leg_${legNames[i]}_upper`]],
        [l.lower, n[`leg_${legNames[i]}_lower`]],
      ] as [THREE.Object3D, THREE.Object3D][]),
    ];
    for (const [a, b] of pairs) {
      b.position.copy(a.position);
      b.rotation.copy(a.rotation);
      b.scale.copy(a.scale);
    }
    // the chest's offset too (its scale differs: the model has the chest's proportions in its geometry)
    n.chest.position.copy(this.chestMesh.position);
    const vis = { harness: this.harness.visible, pack: this.pack.visible, bandana: this.bandana.visible, tongue: this.tongueShow.visible, eyes: this.eyesOpen[0]?.visible ?? true };
    retire([this.body]);
    this.group.add(root);
    this.body = n.body;
    this.front = n.front;
    this.rear = n.rear;
    this.head = n.head;
    this.jaw = n.jaw;
    this.earL = n.ear_L;
    this.earR = n.ear_R;
    this.tail = [n.tail_0, n.tail_1, n.tail_2, n.tail_3];
    this.legs.forEach((l, i) => {
      l.upper = n[`leg_${legNames[i]}_upper`];
      l.lower = n[`leg_${legNames[i]}_lower`];
    });
    this.chestMesh = n.chest;
    this.chestBase.set(1, 1, 1);
    this.tongue = n.tongue;
    this.tongueShow = n.koda_tongue;
    this.eyesOpen = [n.koda_eyes_open];
    this.eyesShut = [n.koda_eyes_shut];
    this.harness = n.koda_harness;
    this.pack = n.koda_harness_pack;
    this.bandana = n.koda_bandana;
    this.harness.visible = vis.harness;
    // the saddlebags hang off the harness in the code; here they are their own mesh
    this.pack.visible = vis.harness && vis.pack;
    this.bandana.visible = vis.bandana;
    this.tongueShow.visible = vis.tongue;
    this.eyesOpen[0].visible = vis.eyes;
    this.eyesShut[0].visible = !vis.eyes;
    this.modelled = true;
    return true;
  }

  setGear(collar: number, harness: { main: number; second: number; pack: boolean } | null, bandana: number | null) {
    repaint(this.collar, collar);
    this.harness.visible = !!harness;
    if (harness) {
      repaint(this.harnessMain, harness.main);
      repaint(this.harnessSecond, harness.second);
    }
    // (inside the harness in the code-built Koda, its own mesh in the model's)
    this.pack.visible = !!harness && harness.pack;
    this.bandana.visible = bandana !== null;
    if (bandana !== null) repaint(this.bandanaMat, bandana);
  }

  animate(anim: DogAnim, stride: number, dt: number) {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    const t = this.t;
    let bodyY = 0.5;
    let bodyX = 0;
    let bodyZ = 0;
    let flex = 0;
    let headX = 0;
    let headY = 0;
    let headZ = 0;
    // tail: how far it leans back from upright, how much each link curls forward, the wag
    let tailBase = 0.55;
    let tailCurl = -0.55;
    let wagSpeed = 6;
    let wagAmp = 0.25;
    // per leg (FL, FR, RL, RR): swing at the shoulder/hip and bend at the elbow/hock
    const up = [0, 0, 0.22, 0.22];
    const lo = [0, 0, -0.42, -0.42];
    let mouth = 0;
    let eyes = true;
    let breathe = 1;
    this.zzz.visible = false;
    switch (anim) {
      case 'trot':
      case 'run': {
        const run = anim === 'run';
        const ph = (stride * (run ? 2.6 : 4.2)) / TAU;
        const amp = run ? 0.85 : 0.5;
        const fold = run ? 1.25 : 0.8;
        // a trot moves diagonal pairs; a run is a rotary gallop with the spine gathering and reaching
        const off = run ? [0, 0.12, 0.52, 0.64] : [0, 0.5, 0.5, 0];
        for (let i = 0; i < 4; i++) {
          const p = TAU * (ph + off[i]);
          const swing = Math.sin(p) * amp;
          const lift = Math.max(0, Math.cos(p));
          up[i] += swing;
          lo[i] += this.legs[i].front ? -lift * fold : -lift * fold * 0.6;
        }
        if (run) {
          const g = Math.sin(TAU * (ph + 0.3));
          flex = g * 0.2;
          bodyX = g * 0.06;
          bodyY += Math.abs(Math.sin(TAU * ph)) * 0.09 - 0.03;
          headX = 0.15 - g * 0.12;
          tailBase = 1.25 + g * 0.1;
          tailCurl = -0.08;
          wagAmp = 0.1;
          wagSpeed = 5;
          mouth = 1;
        } else {
          bodyY += Math.abs(Math.sin(TAU * ph * 2)) * 0.025;
          bodyZ = Math.sin(TAU * ph) * 0.04;
          headX = Math.sin(TAU * ph * 2) * 0.05;
          headY = Math.sin(TAU * ph) * 0.06;
          tailBase = 0.65;
          tailCurl = -0.45;
          wagAmp = 0.22;
          wagSpeed = 7;
          mouth = 0.55;
        }
        break;
      }
      case 'sit':
        up[0] = up[1] = -0.38;
        lo[0] = lo[1] = 0.12;
        up[2] = up[3] = 1.25;
        lo[2] = lo[3] = -1.75;
        bodyX = 0.5;
        flex = -0.12;
        bodyY = 0.44;
        headX = 0.3;
        mouth = 0.5;
        wagAmp = 0.18;
        wagSpeed = 4;
        tailBase = 1.6;
        tailCurl = -0.2;
        break;
      case 'ride':
        up[0] = up[1] = -0.35;
        lo[0] = lo[1] = 0.1;
        up[2] = up[3] = 1.2;
        lo[2] = lo[3] = -1.7;
        bodyX = 0.45;
        bodyY = 0.42;
        headX = 0.2;
        headY = Math.sin(t * 0.7) * 0.45;
        // ears and tongue in the wind
        mouth = 1;
        wagAmp = 0.12;
        tailBase = 1.5;
        tailCurl = -0.15;
        break;
      case 'lie':
        up[0] = up[1] = 1.45;
        lo[0] = lo[1] = -0.1;
        up[2] = up[3] = -1.3;
        lo[2] = lo[3] = 0.3;
        bodyY = 0.26;
        headX = -0.1;
        headY = Math.sin(t * 0.3) * 0.35;
        wagAmp = 0.06;
        wagSpeed = 2;
        tailBase = 1.9;
        tailCurl = -0.05;
        breathe = 1.4;
        mouth = 0.4;
        break;
      case 'sleep':
        up[0] = up[1] = 1.45;
        lo[0] = lo[1] = -0.1;
        up[2] = up[3] = -1.3;
        lo[2] = lo[3] = 0.3;
        bodyY = 0.24;
        bodyZ = 0.15;
        headX = -0.5;
        headY = 0.6;
        eyes = false;
        wagAmp = 0;
        tailBase = 1.9;
        tailCurl = -0.3;
        breathe = 0.8;
        this.zzz.visible = true;
        this.zzz.position.y = 0.6 + ((t * 0.3) % 0.4);
        bodyY += Math.sin(t * 1.2) * 0.01;
        break;
      case 'sniff':
        headX = -0.7 + Math.sin(t * 11) * 0.06;
        headY = Math.sin(t * 1.3) * 0.35;
        up[0] = 0.2 + Math.max(0, Math.sin(t * 2.2)) * 0.25;
        lo[0] = -Math.max(0, Math.sin(t * 2.2)) * 0.5;
        bodyX = -0.1;
        flex = -0.08;
        wagAmp = 0.4;
        wagSpeed = 9;
        tailBase = 0.4;
        break;
      case 'happy': {
        // bouncing on the front paws, the whole back end wagging
        const b = Math.abs(Math.sin(t * 8));
        bodyY += b * 0.08;
        up[0] = up[1] = -0.2 + b * 0.35;
        lo[0] = lo[1] = -b * 0.6;
        bodyX = -0.06 + Math.sin(t * 8) * 0.05;
        bodyZ = Math.sin(t * 9) * 0.06;
        flex = Math.sin(t * 9) * 0.08;
        headX = 0.3;
        headY = Math.sin(t * 6) * 0.2;
        headZ = Math.sin(t * 4) * 0.15;
        mouth = 1;
        wagAmp = 0.7;
        wagSpeed = 20;
        tailBase = 0.3;
        tailCurl = -0.4;
        break;
      }
      case 'bark': {
        const b = Math.max(0, Math.sin(t * 7));
        headX = 0.25 + b * 0.25;
        mouth = b;
        up[0] = up[1] = -0.2;
        bodyX = -0.06 - b * 0.06;
        bodyY -= b * 0.03;
        if (b > 0.95) this.jHead.kick(-1.2);
        wagAmp = 0.45;
        wagSpeed = 11;
        tailBase = 0.25;
        break;
      }
      default: {
        // standing about: looking round, panting, the odd curious head tilt
        headY = Math.sin(t * 0.4) * 0.4;
        mouth = 0.6;
        wagAmp = 0.22;
        wagSpeed = 4;
        breathe = 1.6;
        this.tiltT -= dt;
        if (this.tiltT < 0) {
          this.tiltT = 2 + Math.random() * 4;
          this.tilt = Math.random() < 0.5 ? 0 : (Math.random() < 0.5 ? -1 : 1) * 0.35;
        }
        headZ = this.tilt;
      }
    }
    const k = Math.min(1, dt * 12);
    const L = (a: number, b: number) => a + (b - a) * k;
    this.body.position.y = L(this.body.position.y, bodyY);
    this.body.rotation.x = L(this.body.rotation.x, bodyX);
    this.body.rotation.z = L(this.body.rotation.z, bodyZ);
    this.front.rotation.x = L(this.front.rotation.x, flex);
    this.rear.rotation.x = L(this.rear.rotation.x, -flex);
    const nod = this.jHead.step(0, dt);
    this.head.rotation.x = L(this.head.rotation.x, headX - bodyX - flex) + nod * 0.15;
    this.head.rotation.y = L(this.head.rotation.y, headY);
    this.head.rotation.z = L(this.head.rotation.z, headZ);
    this.legs.forEach((l, i) => {
      l.upper.rotation.x = L(l.upper.rotation.x, up[i] - (l.front ? flex : -flex) * 0.5);
      l.lower.rotation.x = L(l.lower.rotation.x, lo[i]);
    });
    // breathing: the chest swells, faster when panting
    const br = 1 + Math.sin(t * (2 + breathe * 2)) * 0.025 * breathe;
    this.chestMesh.scale.set(br * this.chestBase.x, br * this.chestBase.y, this.chestBase.z);
    // the tail wags in a wave down its length
    this.wag += dt * wagSpeed;
    this.tail.forEach((g, i) => {
      g.rotation.x = L(g.rotation.x, i === 0 ? tailBase : tailCurl);
      g.rotation.z = Math.sin(this.wag - i * 0.7) * wagAmp * (0.6 + i * 0.35);
    });
    this.jaw.rotation.x = L(this.jaw.rotation.x, mouth * 0.4);
    this.tongueShow.visible = mouth > 0.4;
    this.tongue.rotation.x = 0.25 + Math.sin(t * 9) * 0.12 * mouth;
    for (const e of this.eyesOpen) e.visible = eyes;
    for (const e of this.eyesShut) e.visible = !eyes;
    // the ears bounce with every jolt; the floppy one a lot
    const vy = (this.body.position.y - this.lastBodyY) / Math.max(dt, 1e-3);
    const ay = clamp((vy - this.lastVy) / Math.max(dt, 1e-3), -30, 30);
    this.lastBodyY = this.body.position.y;
    this.lastVy = vy;
    this.jEarL.kick(ay * 0.02);
    this.jEarR.kick(ay * 0.006);
    const wind = anim === 'ride' || anim === 'run' ? 0.5 : 0;
    this.earL.rotation.z = 1.9 + clamp(this.jEarL.step(0, dt), -0.6, 0.6);
    this.earL.rotation.x = 0.3 + wind * 0.6;
    this.earR.rotation.x = 0.05 + wind + clamp(this.jEarR.step(0, dt), -0.3, 0.3);
  }
}
