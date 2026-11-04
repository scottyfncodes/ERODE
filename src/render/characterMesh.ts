import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ball, box, cyl, facet, facetPaint, gem, PAL, repaint } from './kit';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { cullAsCharacter, dressModel, retire } from './patrolModels';
import { ANKLE, cycleLength, footAt, legIK, LEG, pelvisBob, runBlend, SHIN, Spring, THIGH, type Foot, type LegAngles } from './gait';

export type Pose = 'idle' | 'walk' | 'run' | 'ride' | 'ski' | 'pilot' | 'work' | 'pet' | 'carry' | 'sleep';

const SKIN = 0xf2c9a8;
const TAU = Math.PI * 2;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * An underdamped spring for the loose things (scarf tails, the pom-pom, the pack, the body's
 * squash): it overshoots and wobbles back, which is what makes them read as soft. Sub-stepped so
 * it stays stable at any frame rate.
 */
export class Jiggle {
  x = 0;
  v = 0;
  constructor(
    private k = 110,
    private c = 9,
  ) {}
  step(target: number, dt: number): number {
    let left = dt;
    while (left > 1e-5) {
      const h = Math.min(left, 1 / 120);
      this.v += (this.k * (target - this.x) - this.c * this.v) * h;
      this.x += this.v * h;
      left -= h;
    }
    return this.x;
  }
  kick(v: number) {
    this.v += v;
  }
}

/**
 * Fewer draw calls: inside each joint, pieces that share a material become one mesh (they move
 * together anyway). Sub-groups (the next joint, hats, skis) are left alone and merged in turn;
 * anything marked `userData.keep` (the eyes, which blink) stays its own mesh.
 */
function mergeJoints(root: THREE.Object3D) {
  const groups: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) groups.push(o);
  });
  for (const g of groups) {
    const byMat = new Map<THREE.Material, THREE.Mesh[]>();
    for (const c of g.children) {
      const m = c as THREE.Mesh;
      if (!m.isMesh || m.userData.keep || Array.isArray(m.material) || m.children.length) continue;
      const list = byMat.get(m.material as THREE.Material) ?? [];
      list.push(m);
      byMat.set(m.material as THREE.Material, list);
    }
    for (const [material, list] of byMat) {
      if (list.length < 2) continue;
      const geos = list.map((m) => {
        m.updateMatrix();
        let geo = m.geometry.clone().applyMatrix4(m.matrix);
        if (geo.index) geo = geo.toNonIndexed();
        for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
        return geo;
      });
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      for (const m of list) g.remove(m);
      const one = new THREE.Mesh(merged, material);
      one.castShadow = true;
      g.add(one);
    }
  }
}

/**
 * A faceted limb segment hanging down from its joint (length `len`, radii top and bottom): a
 * seven-sided capsule, tapered, flat shaded, so arms and legs read as cut polygons like the slopes.
 */
function limb(rTop: number, rBot: number, len: number, m: THREE.Material): THREE.Mesh {
  const g = new THREE.CapsuleGeometry((rTop + rBot) / 2, Math.max(0.01, len - (rTop + rBot)), 2, 7);
  g.translate(0, -len / 2, 0);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const avg = (rTop + rBot) / 2;
  for (let i = 0; i < p.count; i++) {
    const t = Math.min(1, Math.max(0, -p.getY(i) / len));
    const k = (rTop + (rBot - rTop) * t) / avg;
    p.setX(i, p.getX(i) * k);
    p.setZ(i, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return new THREE.Mesh(g, m);
}

/** A tapered ribbon segment hanging down from its pivot (the scarf's tails). */
function ribbon(w0: number, w1: number, len: number, m: THREE.Material, y = 0): THREE.Mesh {
  const g = new THREE.CylinderGeometry(w0, w1, len, 4, 1);
  g.rotateY(Math.PI / 4);
  g.scale(1, 1, 0.28);
  g.translate(0, -len / 2 + y, 0);
  return new THREE.Mesh(g, m);
}

interface Side {
  hip: THREE.Object3D;
  knee: THREE.Object3D;
  ankle: THREE.Object3D;
  shoulder: THREE.Object3D;
  elbow: THREE.Object3D;
  s: Record<'hip' | 'hipRoll' | 'knee' | 'ankle' | 'arm' | 'armRoll' | 'elbow', Spring>;
}

const springs = () => ({ hip: new Spring(), hipRoll: new Spring(), knee: new Spring(), ankle: new Spring(), arm: new Spring(), armRoll: new Spring(), elbow: new Spring() });

type Fidget = 'none' | 'rub' | 'stomp' | 'stretch' | 'look';
const CIVVY_SCARVES = [PAL.mint, PAL.powder, PAL.lavender, PAL.blush, PAL.mustard];

/**
 * The patroller, and everyone else in the valley: a jointed, faceted figure (pelvis, two-piece
 * spine, neck, shoulders, elbows, hips, knees, ankles) in a patrol shell jacket, pack and a
 * knitted scarf. Feet are placed by a two-bone solver and stay planted while the body passes over
 * them; every joint moves through a damped spring, so poses blend instead of snapping, and the
 * loose things (scarf tails, pom-pom, pack) ride on wobbly springs of their own. Forward is -z.
 */
export class PatrollerMesh {
  readonly group = new THREE.Group();
  /** leans with turns, inside the group the game places */
  private body: THREE.Object3D = new THREE.Group();
  private pelvis: THREE.Object3D = new THREE.Group();
  private spine: THREE.Object3D = new THREE.Group();
  private chest: THREE.Object3D = new THREE.Group();
  private neck: THREE.Object3D = new THREE.Group();
  private head: THREE.Object3D = new THREE.Group();
  private L: Side;
  private R: Side;
  private jacket: THREE.MeshLambertMaterial;
  private trim: THREE.MeshLambertMaterial;
  private hatMain: THREE.MeshLambertMaterial;
  private hatSecond: THREE.MeshLambertMaterial;
  private lens: THREE.MeshLambertMaterial;
  /** the game's material for each palette role the MeshCraft model is painted with */
  private roles: Record<string, THREE.Material> = {};
  /** true once the MeshCraft model (public/models/rs_patroller.glb) is in */
  modelled = false;
  private readonly civilian: boolean;
  private hats: Record<string, THREE.Object3D> = {};
  private poms: THREE.Object3D[] = [];
  private skisOnBack: THREE.Object3D = new THREE.Group();
  private feetSkis: THREE.Object3D[] = [];
  private poles: THREE.Object3D[] = [];
  private skiMat: THREE.MeshLambertMaterial;
  private held = new THREE.Group();
  private pack: THREE.Object3D = new THREE.Group();
  private tails: { a: THREE.Object3D; b: THREE.Object3D; ja: Jiggle; jb: Jiggle; off: number }[] = [];
  private t = 0;
  private phase = 0;
  private lastStride = 0;
  private lastYaw = 0;
  private lastSpeed = 0;
  private lastPose: Pose = 'idle';
  private lastPy = LEG - 0.03;
  private lastVy = 0;
  private lastTy = LEG - 0.03;
  private lastTvy = 0;
  private blend = 0;
  private eyes: THREE.Object3D[] = [];
  private blinkT = 2;
  private glanceT = 3;
  private glance = 0;
  private fidget: Fidget = 'none';
  private fidgetT = 0;
  private fidgetLen = 0;
  private fidgetWait = 3 + Math.random() * 3;
  private readonly sp = {
    y: new Spring(LEG - 0.03),
    sway: new Spring(),
    roll: new Spring(),
    yaw: new Spring(),
    bank: new Spring(),
    spine: new Spring(),
    spineRoll: new Spring(),
    chest: new Spring(),
    chestYaw: new Spring(),
    headX: new Spring(),
    headY: new Spring(),
    headZ: new Spring(),
  };
  /** the soft things */
  private readonly jg = {
    squash: new Jiggle(160, 11),
    pack: new Jiggle(140, 8),
    pomX: new Jiggle(90, 5),
    pomZ: new Jiggle(90, 5),
    head: new Jiggle(120, 10),
  };
  private readonly ik: LegAngles = { hip: 0, knee: 0 };
  private readonly fL: Foot = { fwd: 0, lift: 0, pitch: 0, planted: true };
  private readonly fR: Foot = { fwd: 0, lift: 0, pitch: 0, planted: true };

  constructor(civilian = false) {
    this.civilian = civilian;
    this.jacket = facetPaint(PAL.red);
    this.trim = facetPaint(PAL.white);
    this.hatMain = facetPaint(PAL.red);
    this.hatSecond = facetPaint(PAL.white);
    this.lens = new THREE.MeshLambertMaterial({ color: 0xf2a33a, emissive: 0x3a2000, flatShading: true });
    this.skiMat = facetPaint(PAL.wood);
    const trousers = facet(PAL.trousers);
    const boot = facet(PAL.boot);
    const sole = facet(0x2a1d1a);
    const gaiter = facet(0x2c2840);
    const glove = facet(0x33303c);
    const strapMat = facet(0x2b2f38);
    const dark = facet(PAL.dark);
    const skin = facet(SKIN);
    const hair = facet(PAL.hair);
    const scarf = facet(civilian ? CIVVY_SCARVES[Math.floor(Math.random() * CIVVY_SCARVES.length)] : PAL.green);
    this.roles = {
      jacket: this.jacket,
      trim: this.trim,
      hatMain: this.hatMain,
      hatSecond: this.hatSecond,
      lens: this.lens,
      ski: this.skiMat,
      trousers,
      boot,
      sole,
      gaiter,
      glove,
      strap: strapMat,
      dark,
      skin,
      hair,
      scarf,
      patchWhite: facet(PAL.white),
      patchRed: facet(PAL.red),
      pack: facet(PAL.pack),
      packDark: facet(PAL.packDark),
      nose: facet(0xe3a283),
      eye: facet(0x1d1d1d),
      cheek: facet(0xeea295),
      smile: facet(0x8e3f4c),
      metal: facet(PAL.metal),
    };

    this.group.add(this.body);
    this.body.add(this.pelvis);
    this.pelvis.position.y = LEG - 0.03;

    // ---- legs: thigh, shin, a cargo pocket, a chunky boot under a gaiter
    const side = (x: number): Side => {
      const s: Side = { hip: new THREE.Group(), knee: new THREE.Group(), ankle: new THREE.Group(), shoulder: new THREE.Group(), elbow: new THREE.Group(), s: springs() };
      s.hip.position.set(x, 0, 0);
      s.hip.add(limb(0.11, 0.088, THIGH + 0.04, trousers));
      const pocket = gem(0.06, gaiter, Math.sign(x) * 0.095, -0.24, 0, 0);
      pocket.scale.set(0.45, 1.2, 0.9);
      s.hip.add(pocket);
      s.knee.position.y = -THIGH;
      s.knee.add(limb(0.086, 0.072, SHIN, trousers));
      s.knee.add(cyl(0.097, 0.094, 0.07, 7, gaiter, 0, -SHIN + 0.2, 0));
      s.knee.add(cyl(0.09, 0.08, 0.2, 7, boot, 0, -SHIN + 0.09, 0));
      s.ankle.position.y = -SHIN;
      const foot = gem(0.088, boot, 0, -ANKLE + 0.05, -0.075, 0);
      foot.scale.set(0.92, 0.62, 1.85);
      const tread = gem(0.09, sole, 0, -ANKLE + 0.022, -0.075, 0);
      tread.scale.set(0.96, 0.3, 1.9);
      s.ankle.add(foot, tread);
      s.knee.add(s.ankle);
      s.hip.add(s.knee);
      this.pelvis.add(s.hip);
      return s;
    };
    this.L = side(-0.11);
    this.R = side(0.11);

    // ---- a hip-length patrol shell over insulated trousers: charcoal shoulders, a zip, the cross
    const seat = cyl(0.2, 0.215, 0.2, 8, trousers, 0, 0.02, 0);
    seat.scale.z = 0.78;
    const hem = cyl(0.225, 0.242, 0.17, 8, this.jacket, 0, 0.0, 0);
    hem.scale.z = 0.8;
    const hemBand = cyl(0.245, 0.245, 0.035, 8, this.trim, 0, -0.08, 0);
    hemBand.scale.z = 0.8;
    this.pelvis.add(seat, hem, hemBand);
    this.pelvis.add(this.spine);
    this.spine.position.y = 0.12;
    const waist = cyl(0.205, 0.225, 0.2, 8, this.jacket, 0, 0.08, 0);
    waist.scale.z = 0.78;
    this.spine.add(waist);
    this.spine.add(this.chest);
    this.chest.position.y = 0.18;
    const torso = cyl(0.26, 0.205, 0.38, 8, this.jacket, 0, 0.17, 0);
    torso.scale.z = 0.76;
    // the shoulder yoke in the jacket's second colour
    const shoulders = gem(0.27, this.trim, 0, 0.33, 0, 1);
    shoulders.scale.set(1, 0.36, 0.78);
    const zip = box(0.022, 0.4, 0.012, this.trim, 0, 0.16, -0.19);
    zip.rotation.x = 0.1;
    // the patrol cross on the chest
    const patch = box(0.085, 0.085, 0.012, PAL.white, -0.11, 0.24, -0.185);
    patch.rotation.x = 0.1;
    const pv = box(0.022, 0.06, 0.014, PAL.red, -0.11, 0.24, -0.19);
    const ph = box(0.06, 0.022, 0.014, PAL.red, -0.11, 0.24, -0.19);
    pv.rotation.x = ph.rotation.x = 0.1;
    // a stand-up collar and the hood rolled behind it
    const collar = cyl(0.13, 0.155, 0.1, 8, this.jacket, 0, 0.41, 0);
    const hood = gem(0.12, this.jacket, 0, 0.43, 0.13, 0);
    hood.scale.set(1.3, 0.6, 0.8);
    this.chest.add(torso, shoulders, zip, hood);
    if (!civilian) this.chest.add(patch, pv, ph);
    // a thick knitted scarf wound twice round the neck
    const wrap = cyl(0.135, 0.165, 0.075, 8, scarf, 0, 0.425, 0.005);
    const wrap2 = cyl(0.125, 0.145, 0.06, 8, scarf, 0, 0.475, 0.01);
    wrap2.rotation.z = 0.12;
    this.chest.add(collar, wrap, wrap2);
    // ...and its two tails, which stream out behind
    for (const [x, off, len] of [
      [-0.03, 0, 0.2],
      [0.035, 1.7, 0.17],
    ] as const) {
      const a = new THREE.Group();
      a.position.set(x, 0.46, 0.13);
      a.add(ribbon(0.04, 0.036, len, scarf));
      const b = new THREE.Group();
      b.position.y = -len;
      b.add(ribbon(0.036, 0.032, len * 0.85, scarf), ribbon(0.034, 0.042, 0.035, this.trim, -len * 0.85));
      a.add(b);
      this.chest.add(a);
      this.tails.push({ a, b, ja: new Jiggle(70, 4.5), jb: new Jiggle(60, 3.5), off });
    }
    if (!civilian) {
      // pack straps over the shoulders, a radio clipped to one, the pack with the patrol cross
      for (const sx of [-1, 1]) {
        const strap = box(0.055, 0.3, 0.02, strapMat, sx * 0.13, 0.2, -0.19);
        strap.rotation.x = 0.1;
        const over = box(0.055, 0.02, 0.36, strapMat, sx * 0.13, 0.38, 0.0);
        this.chest.add(strap, over);
      }
      this.chest.add(box(0.06, 0.1, 0.04, strapMat, 0.13, 0.26, -0.215), cyl(0.007, 0.007, 0.1, 4, strapMat, 0.145, 0.35, -0.215));
      const packMain = gem(0.215, facet(PAL.pack), 0, 0.15, 0.25, 1);
      packMain.scale.set(0.86, 1.02, 0.42);
      const flap = gem(0.2, facet(PAL.packDark), 0, 0.3, 0.255, 1);
      flap.scale.set(0.92, 0.38, 0.46);
      const crossBg = cyl(0.115, 0.115, 0.012, 8, this.trim, 0, 0.13, 0.348);
      crossBg.rotation.x = Math.PI / 2;
      const crossV = box(0.055, 0.15, 0.014, this.jacket, 0, 0.13, 0.356);
      const crossH = box(0.15, 0.055, 0.014, this.jacket, 0, 0.13, 0.356);
      for (const s of [-1, 1]) {
        const pocket = gem(0.07, facet(PAL.packDark), s * 0.19, 0.06, 0.25, 0);
        pocket.scale.set(0.6, 1.1, 1);
        this.pack.add(pocket);
      }
      this.pack.add(packMain, flap, crossBg, crossV, crossH);
      for (const s of [-1, 1]) {
        // A-framed: the tips meet behind the head instead of splaying out like antlers
        const sk = box(0.065, 1.3, 0.03, this.skiMat, s * 0.1, 0.26, 0.37);
        sk.rotation.z = s * 0.065;
        this.skisOnBack.add(sk);
      }
      this.pack.add(this.skisOnBack);
      this.chest.add(this.pack);
    }

    // ---- arms: upper arm, forearm with a cuff, a big glove with a thumb
    for (const [s, x] of [
      [this.L, -0.27],
      [this.R, 0.27],
    ] as const) {
      s.shoulder.position.set(x, 0.31, 0);
      s.shoulder.add(limb(0.08, 0.066, 0.3, this.jacket));
      s.elbow.position.y = -0.29;
      s.elbow.add(limb(0.068, 0.058, 0.26, this.jacket));
      s.elbow.add(cyl(0.07, 0.07, 0.05, 7, this.trim, 0, -0.24, 0));
      const hand = gem(0.074, glove, 0, -0.31, -0.01, 1);
      hand.scale.set(0.88, 1.12, 1);
      const thumb = gem(0.032, glove, -Math.sign(x) * 0.055, -0.29, -0.045, 0);
      s.elbow.add(hand, thumb);
      s.shoulder.add(s.elbow);
      this.chest.add(s.shoulder);
    }

    // ---- neck and head: a big, friendly, faceted head
    this.neck.position.y = 0.4;
    this.chest.add(this.neck);
    this.neck.add(cyl(0.065, 0.07, 0.12, 7, skin, 0, 0.05, 0));
    this.head.position.y = 0.13;
    this.neck.add(this.head);
    const face = gem(0.185, skin, 0, 0.13, 0, 1);
    face.scale.set(0.95, 1.06, 1);
    const hairCap = gem(0.19, hair, 0, 0.165, 0.035, 1);
    const nose = gem(0.037, facet(0xe3a283), 0, 0.105, -0.185, 0);
    nose.scale.set(0.9, 1.1, 1.15);
    const eyeL = gem(0.022, facet(0x1d1d1d), -0.064, 0.15, -0.165, 0);
    const eyeR = gem(0.022, facet(0x1d1d1d), 0.064, 0.15, -0.165, 0);
    this.eyes = [eyeL, eyeR];
    const browL = box(0.065, 0.014, 0.012, hair, -0.064, 0.193, -0.168);
    const browR = box(0.065, 0.014, 0.012, hair, 0.064, 0.193, -0.168);
    browL.rotation.z = -0.12;
    browR.rotation.z = 0.12;
    const cheekL = gem(0.03, facet(0xeea295), -0.1, 0.09, -0.145, 0);
    const cheekR = gem(0.03, facet(0xeea295), 0.1, 0.09, -0.145, 0);
    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.008, 3, 6, Math.PI), facet(0x8e3f4c));
    smile.rotation.z = Math.PI;
    smile.position.set(0, 0.07, -0.172);
    const earL = gem(0.04, skin, -0.178, 0.125, 0, 0);
    const earR = gem(0.04, skin, 0.178, 0.125, 0, 0);
    this.head.add(hairCap, face, nose, eyeL, eyeR, browL, browR, cheekL, cheekR, smile, earL, earR);
    // goggles pushed up on the brow
    const strap = cyl(0.19, 0.19, 0.04, 9, dark, 0, 0.225, 0.01);
    const frame = box(0.25, 0.085, 0.05, dark, 0, 0.232, -0.165);
    const goggle = box(0.225, 0.065, 0.06, this.lens, 0, 0.232, -0.17);
    this.head.add(strap, frame, goggle);
    // hats: a pom-pom on its own spring where there is one
    const H = 0.195;
    const pom = (r: number, y: number) => {
      const g = new THREE.Group();
      g.position.set(0, y, 0.01);
      g.add(gem(r, this.hatSecond, 0, r * 0.75, 0, 1));
      this.poms.push(g);
      return g;
    };
    const beanie = new THREE.Group();
    const dome = ball(H, this.hatMain, 0, 0.21, 0.01, 9);
    dome.scale.set(1, 0.92, 1);
    beanie.add(dome, cyl(H + 0.008, H + 0.012, 0.08, 9, this.hatSecond, 0, 0.205, 0.01), pom(0.05, 0.21 + H * 0.88));
    const helmet = new THREE.Group();
    const shell = ball(H + 0.02, this.hatMain, 0, 0.195, 0.01, 10);
    shell.scale.set(1, 0.95, 1.06);
    helmet.add(shell, box(0.05, 0.04, 0.27, this.hatSecond, 0, 0.39, 0.01), box(0.08, 0.08, 0.015, this.hatSecond, 0, 0.245, 0.215));
    const trapper = new THREE.Group();
    const cap = ball(H + 0.006, this.hatMain, 0, 0.205, 0.01, 9);
    cap.scale.set(1, 0.9, 1);
    trapper.add(cap, cyl(H + 0.014, H + 0.014, 0.08, 9, this.hatSecond, 0, 0.195, 0.01));
    for (const s of [-1, 1]) {
      const flap = gem(0.09, this.hatSecond, s * 0.185, 0.1, 0.01, 0);
      flap.scale.set(0.42, 1, 0.8);
      trapper.add(flap);
    }
    const bobble = new THREE.Group();
    const bd = ball(H, this.hatMain, 0, 0.225, 0.01, 9);
    bd.scale.set(1, 1.14, 1);
    bobble.add(bd, cyl(H + 0.008, H + 0.012, 0.07, 9, this.hatSecond, 0, 0.195, 0.01), pom(0.085, 0.225 + H * 1.08));
    this.hats = { 'hat-beanie': beanie, 'hat-helmet': helmet, 'hat-trapper': trapper, 'hat-bobble': bobble };
    for (const h of Object.values(this.hats)) {
      h.visible = false;
      this.head.add(h);
    }
    beanie.visible = true;

    // ---- skis on the boots, poles in the gloves
    for (const s of [this.L, this.R]) {
      const g = new THREE.Group();
      g.position.set(0, -ANKLE - 0.01, -0.07);
      const ski = box(0.085, 0.03, 1.65, this.skiMat, 0, 0, -0.05);
      const tip = box(0.085, 0.03, 0.2, this.skiMat, 0, 0.035, -0.95);
      tip.rotation.x = 0.45;
      g.add(ski, tip, box(0.1, 0.04, 0.16, dark, 0, 0.03, 0.03));
      g.visible = false;
      s.ankle.add(g);
      this.feetSkis.push(g);
      const p = new THREE.Group();
      p.add(cyl(0.012, 0.012, 1.2, 5, facet(PAL.metal), 0, -0.85, -0.04), cyl(0.05, 0.05, 0.015, 6, dark, 0, -1.38, -0.04));
      p.position.y = -0.31;
      p.visible = false;
      s.elbow.add(p);
      this.poles.push(p);
    }
    this.R.elbow.add(this.held);
    this.held.position.set(-0.2, -0.3, -0.2);
    for (const e of this.eyes) e.userData.keep = true;
    mergeJoints(this.group);
    this.setSkis(false);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = true;
    });
  }

  /**
   * Swap the code-built figure for the MeshCraft model (public/models/rs_patroller.glb): a skinned
   * mesh on a skeleton whose bones are this figure's joints (same names, pivots and zero rest pose),
   * so every line of the animation below drives the bones exactly as it drove the groups. Hats, skis,
   * poles and the patrol gear are separate meshes the same toggles show and hide. The whole figure
   * changes at once; if the model is unusable nothing changes and false is returned.
   */
  useModel(source: THREE.Object3D | undefined): boolean {
    if (!source) return false;
    const root = cloneSkinned(source);
    const bones = ['body', 'pelvis', 'spine', 'chest', 'neck', 'head', 'pack', 'eye_L', 'eye_R', 'pom_beanie', 'pom_bobble'];
    for (const s of ['L', 'R']) bones.push(`hip_${s}`, `knee_${s}`, `ankle_${s}`, `shoulder_${s}`, `elbow_${s}`);
    for (const i of [0, 1]) bones.push(`scarf_a_${i}`, `scarf_b_${i}`);
    const parts = ['pat_body', 'pat_gear', 'pat_skis_back', 'pat_ski_L', 'pat_ski_R', 'pat_pole_L', 'pat_pole_R', 'pat_hat_beanie', 'pat_hat_helmet', 'pat_hat_trapper', 'pat_hat_bobble'];
    const n = dressModel(root, [...bones, ...parts], this.roles);
    if (!n) return false;
    // one sphere that holds every pose: the poles, swung while skiing, reach furthest (~2 m)
    cullAsCharacter(root, new THREE.Vector3(0, 0.9, 0), 2.3);
    // carry the current look across
    const hat = Object.entries(this.hats).find(([, h]) => h.visible)?.[0] ?? 'hat-beanie';
    const onFeet = this.feetSkis[0]?.visible ?? false;
    const backOn = this.skisOnBack.visible;
    // every joint picks up exactly where the code-built one is (its offset in full precision, its pose)
    const pairs: [THREE.Object3D, string][] = [
      [this.body, 'body'],
      [this.pelvis, 'pelvis'],
      [this.spine, 'spine'],
      [this.chest, 'chest'],
      [this.neck, 'neck'],
      [this.head, 'head'],
      [this.pack, 'pack'],
      [this.poms[0], 'pom_beanie'],
      [this.poms[1], 'pom_bobble'],
      [this.tails[0].a, 'scarf_a_0'],
      [this.tails[0].b, 'scarf_b_0'],
      [this.tails[1].a, 'scarf_a_1'],
      [this.tails[1].b, 'scarf_b_1'],
    ];
    for (const [side, s] of [
      [this.L, 'L'],
      [this.R, 'R'],
    ] as const)
      for (const j of ['hip', 'knee', 'ankle', 'shoulder', 'elbow'] as const) pairs.push([side[j], `${j}_${s}`]);
    for (const [a, name] of pairs) {
      const b = n[name];
      b.position.copy(a.position);
      b.rotation.copy(a.rotation);
      b.scale.copy(a.scale);
    }
    // the model's eyes sit lower on its face (clear of the hat band) and blink about their own
    // centres, so their bones keep the model's pivots and only take the current blink
    n.eye_L.scale.copy(this.eyes[0].scale);
    n.eye_R.scale.copy(this.eyes[1].scale);
    // the cat (or whatever is held) stays in the right glove
    n.elbow_R.add(this.held);
    retire([this.body]);
    this.group.add(root);
    this.body = n.body;
    this.pelvis = n.pelvis;
    this.spine = n.spine;
    this.chest = n.chest;
    this.neck = n.neck;
    this.head = n.head;
    this.pack = n.pack;
    for (const [side, s] of [
      [this.L, 'L'],
      [this.R, 'R'],
    ] as const) {
      side.hip = n[`hip_${s}`];
      side.knee = n[`knee_${s}`];
      side.ankle = n[`ankle_${s}`];
      side.shoulder = n[`shoulder_${s}`];
      side.elbow = n[`elbow_${s}`];
    }
    this.eyes = [n.eye_L, n.eye_R];
    this.poms = [n.pom_beanie, n.pom_bobble];
    this.tails[0].a = n.scarf_a_0;
    this.tails[0].b = n.scarf_b_0;
    this.tails[1].a = n.scarf_a_1;
    this.tails[1].b = n.scarf_b_1;
    this.hats = { 'hat-beanie': n.pat_hat_beanie, 'hat-helmet': n.pat_hat_helmet, 'hat-trapper': n.pat_hat_trapper, 'hat-bobble': n.pat_hat_bobble };
    for (const [k, h] of Object.entries(this.hats)) h.visible = k === hat;
    this.feetSkis = [n.pat_ski_L, n.pat_ski_R];
    this.poles = [n.pat_pole_L, n.pat_pole_R];
    if (this.civilian) {
      // the villagers carry no pack, straps or cross (and so no skis on their backs)
      retire([n.pat_gear, n.pat_skis_back]);
      this.skisOnBack = new THREE.Group();
    } else this.skisOnBack = n.pat_skis_back;
    this.setSkis(onFeet);
    if (!onFeet) this.backSkis(backOn);
    this.modelled = true;
    return true;
  }

  setLook(jacket: number, trim: number, hatId: string, hatMain: number, hatSecond: number, lens: number, skis: number) {
    repaint(this.jacket, jacket);
    repaint(this.trim, trim);
    repaint(this.hatMain, hatMain);
    repaint(this.hatSecond, hatSecond);
    repaint(this.lens, lens);
    repaint(this.skiMat, skis);
    for (const [k, h] of Object.entries(this.hats)) h.visible = k === hatId;
  }

  /** Skis on the feet (skiing) or on the back. */
  setSkis(onFeet: boolean) {
    this.skisOnBack.visible = !onFeet;
    for (const g of this.feetSkis) g.visible = onFeet;
    for (const p of this.poles) p.visible = onFeet;
  }

  /** Skis strapped to the pack (hidden while riding, when they would poke the passenger). */
  backSkis(on: boolean) {
    if (!this.poles[0].visible) this.skisOnBack.visible = on;
  }

  /** Something in the arms (Pepper the cat). */
  hold(obj: THREE.Object3D | null) {
    this.held.clear();
    if (obj) this.held.add(obj);
  }

  /**
   * Pose and animate. `stride`: distance walked (drives the step cycle); `speed` m/s;
   * `lean` -1..1 into a turn (vehicles); `slope`: rise per metre ahead (on foot).
   */
  animate(pose: Pose, stride: number, speed: number, lean: number, dt: number, slope = 0) {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    const t = this.t;
    const moving = (p: Pose) => p === 'walk' || p === 'run' || p === 'carry';
    if (pose !== this.lastPose) {
      // a change of pose: everything eases across for a moment. Walk, run and carry are one gait
      // (it blends with speed), so going between them must not soften the legs and let feet skate.
      if (!(moving(pose) && moving(this.lastPose))) {
        this.blend = 0.35;
        this.jg.squash.kick(-0.35);
      }
      this.lastPose = pose;
      this.fidget = 'none';
    }
    this.blend = Math.max(0, this.blend - dt);
    const slow = this.blend > 0;
    // how fast we are turning and speeding up, for banking and leaning
    const yaw = new THREE.Euler().setFromQuaternion(this.group.quaternion, 'YXZ').y;
    let dyaw = yaw - this.lastYaw;
    while (dyaw > Math.PI) dyaw -= TAU;
    while (dyaw < -Math.PI) dyaw += TAU;
    this.lastYaw = yaw;
    const turn = clamp(dyaw / Math.max(dt, 1e-3), -3, 3);
    const accel = clamp((speed - this.lastSpeed) / Math.max(dt, 1e-3), -12, 12);
    this.lastSpeed = speed;
    // the step cycle runs on distance, so planted feet never skate
    let ds = stride - this.lastStride;
    this.lastStride = stride;
    if (ds < 0 || ds > 3) ds = 0;

    // targets, filled per pose (radians; metres for the pelvis)
    let y = LEG - 0.03;
    let sway = 0;
    let roll = 0;
    let pyaw = 0;
    let bank = 0;
    let spine = 0;
    let spineRoll = 0;
    let chest = 0;
    let chestYaw = 0;
    let headX = 0;
    let headY = 0;
    let headZ = 0;
    const leg = { L: { hip: 0, hipRoll: 0, knee: 0, ankle: 0 }, R: { hip: 0, hipRoll: 0, knee: 0, ankle: 0 } };
    const arm = { L: { arm: 0.05, roll: -0.14, elbow: 0.25 }, R: { arm: 0.05, roll: 0.14, elbow: 0.25 } };
    let ik = false;
    let fwdL = 0;
    let fwdR = 0;
    let liftL = 0;
    let liftR = 0;
    let pitchL = 0;
    let pitchR = 0;
    // how hard the wind of moving catches the scarf, 0..1
    let blow = 0;

    const locomotion = pose === 'walk' || pose === 'run' || pose === 'carry';
    if (locomotion) {
      const v = Math.max(0, speed);
      const r = runBlend(v);
      const k = Math.min(1, v / 0.8);
      this.phase = (this.phase + ds / cycleLength(v)) % 1;
      const ph = this.phase;
      y = LEG - 0.02 + pelvisBob(ph, v);
      // the stride the leg can cover from the top of the bob: fixed for the whole stride, so the
      // planted foot's path is a straight line
      const top = LEG - 0.02 + Math.max(pelvisBob(0, v), pelvisBob(0.25, v));
      const reach = Math.sqrt(Math.max(0, (THIGH + SHIN) ** 2 * 0.985 - (top - ANKLE - 0.04) ** 2));
      footAt(ph, v, reach, this.fL);
      footAt(ph + 0.5, v, reach, this.fR);
      fwdL = this.fL.fwd * k;
      fwdR = this.fR.fwd * k;
      liftL = this.fL.lift;
      liftR = this.fR.lift;
      pitchL = this.fL.pitch * k;
      pitchR = this.fR.pitch * k;
      ik = true;
      // Everything above the legs runs on smooth curves of the gait phase, a beat behind the feet:
      // driving it straight off the foot positions (linear in stance, a snap in swing) is what
      // made the old walk look like a wind-up toy.
      // the cycle: left heel strikes at 0, right at 0.5
      const c = Math.cos(TAU * ph);
      const lag = Math.cos(TAU * (ph - 0.06));
      // weight over the planted foot; the hip drops a touch on the swinging side
      sway = -Math.cos(TAU * (ph - 0.3)) * (0.022 - r * 0.01) * k;
      roll = sway * 1.2;
      // the pelvis turns with the forward leg; the shoulders counter-turn, less than the hips
      pyaw = -c * (0.09 + r * 0.05) * k;
      chestYaw = -pyaw * 1.25;
      // a little forward lean walking, more running; into acceleration and up a hill
      spine = -(0.04 + r * 0.22) * k - accel * 0.012 - slope * 0.35;
      chest = -0.02 * k - r * 0.05 + Math.cos(TAU * ph * 2) * (0.012 + 0.025 * r) * k;
      // the head stays level (it counters the bob) and leads into turns
      headX = -(spine + chest) * 0.9 - Math.cos(TAU * ph * 2) * 0.015 * k;
      headY = clamp(turn * 0.2, -0.4, 0.4) - chestYaw * 0.5;
      headZ = -roll * 0.5;
      // arms swing from the shoulder with the opposite leg: a relaxed pendulum walking, a bent
      // pump running. The forearm trails the upper arm and bends more as it comes forward.
      const fwdSwing = (0.32 + r * 0.45) * k;
      const backSwing = (0.22 + r * 0.4) * k;
      for (const [a, sgn, s] of [
        [arm.L, 1, -1],
        [arm.R, -1, 1],
      ] as const) {
        const w = -sgn * lag; // +1 = this arm fully forward
        a.arm = (w > 0 ? w * fwdSwing : w * backSwing) + 0.04 + r * 0.25;
        a.roll = s * (0.1 + r * 0.06);
        a.elbow = 0.22 + Math.max(0, w) * (0.28 + r * 0.4) + r * 1.15;
      }
      if (pose === 'carry') {
        // Pepper held to the chest
        arm.L = { arm: 0.75, roll: 0.35, elbow: 1.45 };
        arm.R = { arm: 0.75, roll: -0.35, elbow: 1.45 };
        chestYaw *= 0.3;
      }
      // bank into turns
      bank = -turn * Math.min(1, v / 3) * (0.08 + r * 0.1);
      blow = Math.min(1, v / 6);
      // a running footfall (the hips bottoming out) jolts the soft things; a walk is too gentle to
      const tvy = (y - this.lastTy) / Math.max(dt, 1e-3);
      if (r > 0.3 && this.lastTvy < 0 && tvy >= 0) this.jg.squash.kick(-0.3 * r);
      this.lastTy = y;
      this.lastTvy = tvy;
    } else if (pose === 'ski') {
      const crouch = Math.min(1, speed / 14);
      y = LEG - 0.12 - crouch * 0.18;
      ik = true;
      // carving: the feet stagger with the turn and the hips angulate over them
      fwdL = 0.06 + lean * 0.06;
      fwdR = -0.06 - lean * 0.06;
      pitchL = pitchR = 0;
      spine = -0.34 - crouch * 0.24;
      chest = -0.05;
      headX = -(spine + chest) * 0.9;
      headY = lean * 0.2;
      spineRoll = -lean * 0.42;
      pyaw = lean * 0.22;
      chestYaw = -lean * 0.3;
      sway = lean * 0.05;
      bank = -lean * 0.2;
      arm.L = { arm: 0.6, roll: -0.45 + lean * 0.15, elbow: 0.55 };
      arm.R = { arm: 0.6, roll: 0.45 + lean * 0.15, elbow: 0.55 };
      blow = Math.min(1, speed / 9);
      if (speed < 3 && speed > 0.3) {
        // poling along: a real push, the body dipping into each plant
        this.phase = (this.phase + ds / 2.2) % 1;
        const s = Math.sin(TAU * this.phase);
        arm.L.arm = 0.45 + s * 0.8;
        arm.R.arm = 0.45 - s * 0.8;
        arm.L.elbow = 0.5 + Math.max(0, s) * 0.5;
        arm.R.elbow = 0.5 + Math.max(0, -s) * 0.5;
        spine += Math.abs(s) * -0.14;
      } else if (speed >= 3) {
        // a little pole flick on the inside of the turn, in time with the carve
        const flick = Math.max(0, Math.sin(t * 2.4)) * 0.25;
        if (lean > 0.2) arm.R.arm += flick;
        else if (lean < -0.2) arm.L.arm += flick;
      }
    } else if (pose === 'ride' || pose === 'pilot') {
      y = pose === 'ride' ? 0.62 : 0.5;
      leg.L = { hip: 1.45, hipRoll: -0.1, knee: -1.5, ankle: 0.05 };
      leg.R = { hip: 1.45, hipRoll: 0.1, knee: -1.5, ankle: 0.05 };
      if (pose === 'ride') {
        // the rider works the sled: hangs off the inside of a turn, tucks at speed
        spine = -0.3 - Math.min(0.2, speed * 0.012);
        spineRoll = -lean * 0.55;
        bank = -lean * 0.12;
        sway = lean * 0.07;
        headX = -spine * 0.8;
        headY = -lean * 0.3;
        headZ = lean * 0.15;
        arm.L = { arm: 1.1, roll: -0.3, elbow: 0.5 + Math.max(0, lean) * 0.4 };
        arm.R = { arm: 1.1, roll: 0.3, elbow: 0.5 + Math.max(0, -lean) * 0.4 };
        blow = Math.min(1, speed / 12);
        // the body soaks up the bumps at speed
        const bump = Math.sin(t * 17) * Math.sin(t * 5.3);
        y += bump * Math.min(0.02, speed * 0.0012);
        if (speed > 4 && Math.random() < dt * 1.5) this.jg.squash.kick(-0.4);
      } else {
        spine = -0.05;
        spineRoll = -lean * 0.3;
        headX = -spine * 0.8;
        headY = -lean * 0.25 + Math.sin(t * 0.5) * 0.25;
        arm.L = { arm: 1.05, roll: -0.25, elbow: 0.45 };
        arm.R = { arm: 1.05, roll: 0.25, elbow: 0.45 };
      }
    } else if (pose === 'work' || pose === 'pet') {
      // down on one knee
      y = 0.56;
      leg.L = { hip: 1.5, hipRoll: -0.1, knee: -1.55, ankle: 0.05 };
      leg.R = { hip: -0.05, hipRoll: 0.06, knee: -1.6, ankle: -0.6 };
      spine = -0.42;
      chest = -0.1;
      headX = 0.05;
      if (pose === 'work') {
        // put the shoulders into it
        const k = Math.sin(t * 9);
        arm.L = { arm: 1.15 + k * 0.35, roll: -0.05, elbow: 0.6 - k * 0.3 };
        arm.R = { arm: 1.15 - k * 0.35, roll: 0.05, elbow: 0.6 + k * 0.3 };
        chestYaw = k * 0.12;
        spine += Math.abs(k) * -0.06;
        headY = k * 0.06;
      } else {
        const k = Math.sin(t * 6);
        arm.L = { arm: 0.25, roll: -0.2, elbow: 0.4 };
        arm.R = { arm: 0.85 + k * 0.25, roll: 0.1, elbow: 0.55 - k * 0.3 };
        headX = 0.15;
        headY = -0.2;
        // a fond tilt of the head
        headZ = 0.18 + Math.sin(t * 1.3) * 0.05;
      }
    } else if (pose === 'sleep') {
      y = 0.3;
      spine = -1.4;
      headX = 0.3;
    } else {
      // standing: breathing, a slow weight shift, and the fidgets of someone out in the cold
      ik = true;
      const w = Math.sin(t * 0.55);
      sway = w * 0.026;
      roll = w * 0.035;
      fwdL = 0.06;
      fwdR = -0.04;
      y = LEG - 0.035 - Math.abs(w) * 0.008 + Math.sin(t * 1.7) * 0.005;
      chest = Math.sin(t * 1.7) * 0.016;
      spineRoll = -w * 0.035;
      headZ = w * 0.04;
      arm.L = { arm: 0.04 + Math.sin(t * 1.7 + 1) * 0.02, roll: -0.12, elbow: 0.22 };
      arm.R = { arm: 0.04 + Math.sin(t * 1.7 + 1.4) * 0.02, roll: 0.12, elbow: 0.24 };
      this.glanceT -= dt;
      if (this.glanceT < 0) {
        this.glanceT = 2.5 + Math.random() * 4;
        this.glance = Math.random() < 0.35 ? 0 : (Math.random() - 0.5) * 1.3;
      }
      headY = this.glance;
      headX = Math.sin(t * 0.4) * 0.05;
      // now and then: rub the mitts together, stamp the cold out of the feet, stretch, look round
      if (this.fidget === 'none') {
        this.fidgetWait -= dt;
        if (this.fidgetWait < 0) {
          const all: Fidget[] = ['rub', 'stomp', 'stretch', 'look'];
          this.fidget = all[Math.floor(Math.random() * all.length)];
          this.fidgetT = 0;
          this.fidgetLen = this.fidget === 'stomp' ? 1.7 : this.fidget === 'look' ? 2.6 : 2.3;
        }
      } else {
        this.fidgetT += dt;
        const f = this.fidgetT;
        const e = clamp(Math.min(f / 0.35, (this.fidgetLen - f) / 0.35), 0, 1);
        if (f >= this.fidgetLen) {
          this.fidget = 'none';
          this.fidgetWait = 4 + Math.random() * 5;
        } else if (this.fidget === 'rub') {
          const k = Math.sin(f * 16);
          arm.L = { arm: mix(arm.L.arm, 0.9, e), roll: mix(arm.L.roll, 0.5, e), elbow: mix(arm.L.elbow, 1.75 + k * 0.12, e) };
          arm.R = { arm: mix(arm.R.arm, 0.9, e), roll: mix(arm.R.roll, -0.5, e), elbow: mix(arm.R.elbow, 1.75 - k * 0.12, e) };
          headX += 0.18 * e;
          headY *= 1 - e;
          spine -= 0.06 * e;
          // a shiver
          sway += Math.sin(f * 30) * 0.006 * e;
        } else if (this.fidget === 'stomp') {
          const p = f / this.fidgetLen;
          const up = Math.max(0, Math.sin(p * TAU * 2));
          if (p < 0.5) liftL = up * 0.13;
          else liftR = up * 0.13;
          arm.L.roll -= 0.15 * e;
          arm.R.roll += 0.15 * e;
          headX += 0.12 * e;
        } else if (this.fidget === 'stretch') {
          arm.L = { arm: mix(arm.L.arm, 2.7, e), roll: mix(arm.L.roll, -0.25, e), elbow: mix(arm.L.elbow, 0.35, e) };
          arm.R = { arm: mix(arm.R.arm, 2.7, e), roll: mix(arm.R.roll, 0.25, e), elbow: mix(arm.R.elbow, 0.35, e) };
          spine += 0.14 * e;
          chest += 0.08 * e;
          headX -= 0.3 * e;
          headY *= 1 - e;
        } else {
          // a proper look round, the shoulders following the head
          const s = Math.sin((f / this.fidgetLen) * TAU);
          headY = s * 1.0 * e;
          chestYaw = s * 0.28 * e;
          headX -= 0.06 * e;
        }
      }
    }

    // ---- springs: quick when walking (so the feet stay true), soft when changing pose
    const tPose = slow ? 0.22 : 0.07;
    const S = this.sp;
    const py = S.y.step(y, dt, slow ? 0.25 : ik ? 0.05 : 0.12);
    this.pelvis.position.y = py;
    this.pelvis.position.x = S.sway.step(sway, dt, 0.12);
    this.pelvis.rotation.z = S.roll.step(roll, dt, 0.12);
    this.pelvis.rotation.y = S.yaw.step(pyaw, dt, 0.08);
    this.body.rotation.z = S.bank.step(bank, dt, 0.25);
    this.spine.rotation.x = S.spine.step(spine, dt, slow ? 0.3 : 0.14);
    this.spine.rotation.z = S.spineRoll.step(spineRoll, dt, 0.18);
    this.chest.rotation.x = S.chest.step(chest, dt, 0.12);
    this.chest.rotation.y = S.chestYaw.step(chestYaw, dt, 0.1);
    // the head lags the body a beat (follow-through) and nods with every jolt
    const nod = this.jg.head.step(0, dt);
    this.head.rotation.x = S.headX.step(headX, dt, 0.18) + nod;
    this.head.rotation.y = S.headY.step(headY, dt, 0.3);
    this.head.rotation.z = S.headZ.step(headZ, dt, 0.25);

    // ---- the soft things: squash on a landing, the pack bouncing, the pom-pom and scarf flying
    const vy = (py - this.lastPy) / Math.max(dt, 1e-3);
    const ay = clamp((vy - this.lastVy) / Math.max(dt, 1e-3), -40, 40);
    this.lastPy = py;
    this.lastVy = vy;
    const sq = clamp(this.jg.squash.step(0, dt), -0.07, 0.07);
    this.spine.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);
    this.jg.head.kick(clamp(-ay * 0.0012, -0.08, 0.08));
    this.jg.pack.kick(clamp(-ay * 0.0009, -0.06, 0.06));
    this.pack.position.y = clamp(this.jg.pack.step(0, dt), -0.03, 0.03);
    this.pack.rotation.x = this.pack.position.y * 2.5;
    this.jg.pomX.kick(clamp(ay * 0.006 + accel * 0.02, -0.5, 0.5));
    this.jg.pomZ.kick(clamp(-turn * 0.06 * dt * 60, -0.4, 0.4));
    const pomX = clamp(this.jg.pomX.step(blow * 0.7, dt), -1.1, 1.1);
    const pomZ = clamp(this.jg.pomZ.step(0, dt), -0.9, 0.9);
    for (const p of this.poms) {
      p.rotation.x = pomX;
      p.rotation.z = pomZ;
    }
    // the scarf: hangs over the pack at rest, streams out behind and flutters as you go faster
    for (const tl of this.tails) {
      const flutter = Math.sin(t * (9 + blow * 8) + tl.off) * (0.05 + blow * 0.22);
      const flutter2 = Math.sin(t * (11 + blow * 9) + tl.off + 1.2) * (0.08 + blow * 0.35);
      tl.ja.kick(clamp(ay * 0.004, -0.4, 0.4));
      tl.jb.kick(clamp(ay * 0.006, -0.5, 0.5));
      tl.a.rotation.x = tl.ja.step(-1.15 - blow * 0.45 + flutter + accel * 0.03, dt);
      tl.b.rotation.x = tl.jb.step(mix(0.75, 0.1, blow) + flutter2, dt);
      tl.a.rotation.z = Math.sin(t * 3 + tl.off) * 0.08 * (0.3 + blow) - turn * 0.05;
    }

    if (ik) {
      // feet from where they should be on the ground, under the pelvis as it actually is
      for (const [s, fwd, lift, pitch] of [
        [this.L, fwdL, liftL, pitchL],
        [this.R, fwdR, liftR, pitchR],
      ] as const) {
        const down = py - ANKLE - lift - slope * fwd;
        legIK(fwd, down, this.ik);
        const tgt = s === this.L ? leg.L : leg.R;
        tgt.hip = this.ik.hip;
        tgt.knee = this.ik.knee;
        tgt.ankle = -(this.ik.hip + this.ik.knee) + pitch + Math.atan(slope);
        // the pelvis rolls and sways over the planted foot: the legs tilt back so the feet stay put
        tgt.hipRoll = -this.pelvis.rotation.z - this.pelvis.position.x / Math.max(0.3, py);
      }
    }
    const legTime = slow ? tPose : ik ? 0.025 : 0.1;
    for (const [s, l, a] of [
      [this.L, leg.L, arm.L],
      [this.R, leg.R, arm.R],
    ] as const) {
      if (ik && !slow) {
        // on the ground the solver is the truth: no lag, so a planted foot stays planted
        s.s.hip.set(l.hip);
        s.s.hipRoll.set(l.hipRoll);
        s.s.knee.set(l.knee);
        s.s.ankle.set(l.ankle);
      }
      s.hip.rotation.x = s.s.hip.step(l.hip, dt, legTime);
      s.hip.rotation.z = s.s.hipRoll.step(l.hipRoll, dt, legTime);
      s.knee.rotation.x = s.s.knee.step(l.knee, dt, legTime);
      s.ankle.rotation.x = s.s.ankle.step(l.ankle, dt, legTime);
      // arms trail a little behind the body: follow-through
      s.shoulder.rotation.x = s.s.arm.step(a.arm, dt, slow ? 0.25 : 0.11);
      s.shoulder.rotation.z = s.s.armRoll.step(a.roll, dt, 0.15);
      s.elbow.rotation.x = s.s.elbow.step(a.elbow, dt, slow ? 0.25 : 0.13);
    }

    // blink
    this.blinkT -= dt;
    const shut = this.blinkT < 0.09;
    if (this.blinkT < 0) this.blinkT = 2 + Math.random() * 3.5;
    for (const e of this.eyes) e.scale.y = shut ? 0.15 : 1;
  }
}
