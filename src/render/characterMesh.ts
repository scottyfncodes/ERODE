import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ball, box, cyl, mat, paint, PAL, repaint } from './kit';
import { ANKLE, cycleLength, footAt, legIK, LEG, pelvisBob, runBlend, SHIN, Spring, THIGH, type Foot, type LegAngles } from './gait';

export type Pose = 'idle' | 'walk' | 'run' | 'ride' | 'ski' | 'pilot' | 'work' | 'pet' | 'carry' | 'sleep';

const SKIN = 0xf2c9a8;
const TAU = Math.PI * 2;

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

/** A rounded limb segment hanging down from its joint (length `len`, radii top and bottom). */
function limb(rTop: number, rBot: number, len: number, color: number | THREE.Material): THREE.Mesh {
  const g = new THREE.CapsuleGeometry((rTop + rBot) / 2, Math.max(0.01, len - (rTop + rBot)), 4, 10);
  g.translate(0, -len / 2, 0);
  // taper: scale each vertex's radius from top to bottom
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const avg = (rTop + rBot) / 2;
  for (let i = 0; i < p.count; i++) {
    const t = Math.min(1, Math.max(0, -p.getY(i) / len));
    const k = (rTop + (rBot - rTop) * t) / avg;
    p.setX(i, p.getX(i) * k);
    p.setZ(i, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return new THREE.Mesh(g, color instanceof THREE.Material ? color : mat(color));
}

interface Side {
  hip: THREE.Group;
  knee: THREE.Group;
  ankle: THREE.Group;
  shoulder: THREE.Group;
  elbow: THREE.Group;
  s: Record<'hip' | 'hipRoll' | 'knee' | 'ankle' | 'arm' | 'armRoll' | 'elbow', Spring>;
}

const springs = () => ({ hip: new Spring(), hipRoll: new Spring(), knee: new Spring(), ankle: new Spring(), arm: new Spring(), armRoll: new Spring(), elbow: new Spring() });

/**
 * The patroller, and everyone else in the valley: a jointed figure (pelvis, two-piece spine,
 * neck, shoulders, elbows, hips, knees, ankles) in a tailored double-breasted alpine tunic. Feet
 * are placed by a two-bone solver and stay planted while the body passes over them; every joint
 * moves through a damped spring, so poses blend instead of snapping. Forward is -z.
 */
export class PatrollerMesh {
  readonly group = new THREE.Group();
  /** leans with turns, inside the group the game places */
  private body = new THREE.Group();
  private pelvis = new THREE.Group();
  private spine = new THREE.Group();
  private chest = new THREE.Group();
  private neck = new THREE.Group();
  private head = new THREE.Group();
  private L: Side;
  private R: Side;
  private jacket: THREE.MeshLambertMaterial;
  private trim: THREE.MeshLambertMaterial;
  private hatMain: THREE.MeshLambertMaterial;
  private hatSecond: THREE.MeshLambertMaterial;
  private lens: THREE.MeshLambertMaterial;
  private hats: Record<string, THREE.Group> = {};
  private skisOnBack = new THREE.Group();
  private feetSkis: THREE.Group[] = [];
  private poles: THREE.Group[] = [];
  private skiMat: THREE.MeshLambertMaterial;
  private held = new THREE.Group();
  private t = 0;
  private phase = 0;
  private lastStride = 0;
  private lastYaw = 0;
  private lastSpeed = 0;
  private lastPose: Pose = 'idle';
  private blend = 0;
  private eyes: THREE.Object3D[] = [];
  private blinkT = 2;
  private glanceT = 3;
  private glance = 0;
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
  };
  private readonly ik: LegAngles = { hip: 0, knee: 0 };
  private readonly fL: Foot = { fwd: 0, lift: 0, pitch: 0, planted: true };
  private readonly fR: Foot = { fwd: 0, lift: 0, pitch: 0, planted: true };

  constructor(civilian = false) {
    this.jacket = paint(PAL.red);
    this.trim = paint(PAL.white);
    this.hatMain = paint(PAL.red);
    this.hatSecond = paint(PAL.white);
    this.lens = new THREE.MeshLambertMaterial({ color: 0xf2a33a, emissive: 0x3a2000 });
    this.skiMat = paint(PAL.wood);
    const trousers = mat(PAL.trousers);
    const boot = mat(PAL.boot);
    const sock = mat(PAL.sock);
    const mitt = mat(PAL.mitt);
    const brass = mat(PAL.brass);

    this.group.add(this.body);
    this.body.add(this.pelvis);
    this.pelvis.position.y = LEG - 0.03;

    // ---- legs: thigh, shin, a tall laced boot with a turned-down sock
    const side = (x: number): Side => {
      const s: Side = { hip: new THREE.Group(), knee: new THREE.Group(), ankle: new THREE.Group(), shoulder: new THREE.Group(), elbow: new THREE.Group(), s: springs() };
      s.hip.position.set(x, 0, 0);
      s.hip.add(limb(0.105, 0.085, THIGH + 0.04, trousers));
      s.knee.position.y = -THIGH;
      s.knee.add(limb(0.082, 0.07, SHIN, trousers));
      s.knee.add(cyl(0.085, 0.085, 0.07, 10, sock, 0, -SHIN + 0.2, 0));
      s.knee.add(cyl(0.078, 0.072, 0.18, 10, boot, 0, -SHIN + 0.08, 0));
      s.ankle.position.y = -SHIN;
      const sole = box(0.13, 0.08, 0.3, boot, 0, -ANKLE + 0.04, -0.07);
      const toe = ball(0.066, boot, 0, -ANKLE + 0.05, -0.2, 8);
      toe.scale.set(1, 0.75, 1);
      s.ankle.add(sole, toe, box(0.14, 0.02, 0.31, mat(0x2a1d1a), 0, -ANKLE + 0.005, -0.07));
      s.knee.add(s.ankle);
      s.hip.add(s.knee);
      this.pelvis.add(s.hip);
      return s;
    };
    this.L = side(-0.11);
    this.R = side(0.11);

    // ---- the tunic: hips and skirt on the pelvis, chest above a two-piece spine
    const seat = cyl(0.2, 0.215, 0.2, 14, trousers, 0, 0.02, 0);
    seat.scale.z = 0.78;
    const skirt = cyl(0.225, 0.27, 0.2, 14, this.jacket, 0, -0.02, 0);
    skirt.scale.z = 0.8;
    const belt = cyl(0.232, 0.232, 0.06, 14, mat(PAL.dark), 0, 0.1, 0);
    belt.scale.z = 0.8;
    const buckle = box(0.07, 0.06, 0.02, brass, 0, 0.1, -0.188);
    this.pelvis.add(seat, skirt, belt, buckle);
    this.pelvis.add(this.spine);
    this.spine.position.y = 0.12;
    const waist = cyl(0.2, 0.22, 0.2, 14, this.jacket, 0, 0.08, 0);
    waist.scale.z = 0.78;
    this.spine.add(waist);
    this.spine.add(this.chest);
    this.chest.position.y = 0.18;
    const torso = cyl(0.25, 0.205, 0.38, 14, this.jacket, 0, 0.17, 0);
    torso.scale.z = 0.76;
    const shoulders = ball(0.25, this.jacket, 0, 0.34, 0, 14);
    shoulders.scale.set(1, 0.34, 0.76);
    // double-breasted: two rows of brass buttons, a cream collar and a placket
    const placket = box(0.13, 0.36, 0.01, this.trim, 0, 0.17, -0.183);
    placket.rotation.x = 0.1;
    for (let i = 0; i < 3; i++)
      for (const bx of [-0.045, 0.045]) this.chest.add(ball(0.016, brass, bx, 0.28 - i * 0.09, -0.19 + i * 0.006, 6));
    const collar = cyl(0.12, 0.15, 0.08, 12, this.trim, 0, 0.4, 0);
    this.chest.add(torso, shoulders, placket, collar);
    if (!civilian) {
      // epaulettes, the pack with the patrol cross, skis A-framed on it
      for (const ex of [-0.19, 0.19]) this.chest.add(box(0.11, 0.025, 0.14, this.trim, ex, 0.4, 0));
      const pack = box(0.36, 0.42, 0.17, mat(PAL.pack), 0, 0.17, 0.25);
      const flap = box(0.37, 0.12, 0.18, mat(PAL.packDark), 0, 0.33, 0.25);
      const crossBg = box(0.22, 0.22, 0.012, this.trim, 0, 0.15, 0.338);
      const crossV = box(0.06, 0.17, 0.014, this.jacket, 0, 0.15, 0.342);
      const crossH = box(0.17, 0.06, 0.014, this.jacket, 0, 0.15, 0.342);
      this.chest.add(pack, flap, crossBg, crossV, crossH);
      for (const s of [-1, 1]) {
        const sk = box(0.07, 1.5, 0.03, this.skiMat, s * 0.09, 0.42, 0.36);
        sk.rotation.z = s * -0.05;
        this.skisOnBack.add(sk);
      }
      this.chest.add(this.skisOnBack);
    }

    // ---- arms: upper arm, forearm with a cuff, a mitten
    for (const [s, x] of [
      [this.L, -0.26],
      [this.R, 0.26],
    ] as const) {
      s.shoulder.position.set(x, 0.31, 0);
      s.shoulder.add(limb(0.078, 0.066, 0.3, this.jacket));
      s.elbow.position.y = -0.29;
      s.elbow.add(limb(0.066, 0.058, 0.26, this.jacket));
      s.elbow.add(cyl(0.064, 0.064, 0.05, 10, this.trim, 0, -0.24, 0));
      const hand = ball(0.07, mitt, 0, -0.31, -0.01, 8);
      hand.scale.set(0.9, 1.1, 1);
      s.elbow.add(hand);
      s.shoulder.add(s.elbow);
      this.chest.add(s.shoulder);
    }

    // ---- neck and head: a neat, deadpan face
    this.neck.position.y = 0.4;
    this.chest.add(this.neck);
    this.neck.add(cyl(0.065, 0.07, 0.12, 10, SKIN, 0, 0.05, 0));
    this.head.position.y = 0.13;
    this.neck.add(this.head);
    const face = ball(0.165, SKIN, 0, 0.12, 0, 16);
    face.scale.set(0.95, 1.08, 1);
    const hair = ball(0.168, PAL.hair, 0, 0.15, 0.025, 16);
    hair.scale.set(1, 1.02, 1);
    const nose = ball(0.032, 0xe3a283, 0, 0.1, -0.165, 8);
    nose.scale.set(0.9, 1.2, 1);
    const eyeL = ball(0.019, 0x1d1d1d, -0.058, 0.145, -0.148, 6);
    const eyeR = ball(0.019, 0x1d1d1d, 0.058, 0.145, -0.148, 6);
    this.eyes = [eyeL, eyeR];
    const browL = box(0.06, 0.012, 0.01, PAL.hair, -0.058, 0.185, -0.152);
    const browR = box(0.06, 0.012, 0.01, PAL.hair, 0.058, 0.185, -0.152);
    const cheekL = ball(0.028, 0xeea295, -0.095, 0.085, -0.13, 6);
    const cheekR = ball(0.028, 0xeea295, 0.095, 0.085, -0.13, 6);
    const earL = ball(0.035, SKIN, -0.16, 0.12, 0, 6);
    const earR = ball(0.035, SKIN, 0.16, 0.12, 0, 6);
    this.head.add(hair, face, nose, eyeL, eyeR, browL, browR, cheekL, cheekR, earL, earR);
    // goggles pushed up on the brow
    const strap = cyl(0.172, 0.172, 0.04, 16, mat(PAL.dark), 0, 0.22, 0);
    const frame = box(0.24, 0.085, 0.05, mat(PAL.dark), 0, 0.225, -0.15);
    const goggle = box(0.215, 0.065, 0.06, this.lens, 0, 0.225, -0.155);
    this.head.add(strap, frame, goggle);
    // hats (the same four, cut for the new head)
    const H = 0.178;
    const beanie = new THREE.Group();
    const dome = ball(H, this.hatMain, 0, 0.2, 0.01, 14);
    dome.scale.set(1, 0.92, 1);
    beanie.add(dome, cyl(H + 0.006, H + 0.01, 0.075, 14, this.hatSecond, 0, 0.2, 0.01));
    const helmet = new THREE.Group();
    const shell = ball(H + 0.02, this.hatMain, 0, 0.19, 0.01, 16);
    shell.scale.set(1, 0.95, 1.06);
    helmet.add(shell, box(0.05, 0.04, 0.26, this.hatSecond, 0, 0.375, 0.01), box(0.08, 0.08, 0.015, this.hatSecond, 0, 0.24, 0.205));
    const trapper = new THREE.Group();
    const cap = ball(H + 0.006, this.hatMain, 0, 0.2, 0.01, 14);
    cap.scale.set(1, 0.9, 1);
    trapper.add(cap, cyl(H + 0.012, H + 0.012, 0.075, 14, this.hatSecond, 0, 0.19, 0.01));
    trapper.add(box(0.05, 0.17, 0.13, this.hatSecond, -0.175, 0.1, 0.01), box(0.05, 0.17, 0.13, this.hatSecond, 0.175, 0.1, 0.01));
    const bobble = new THREE.Group();
    const bd = ball(H, this.hatMain, 0, 0.22, 0.01, 14);
    bd.scale.set(1, 1.12, 1);
    bobble.add(bd, cyl(H + 0.006, H + 0.01, 0.065, 14, this.hatSecond, 0, 0.19, 0.01), ball(0.08, this.hatSecond, 0, 0.43, 0.01, 10));
    this.hats = { 'hat-beanie': beanie, 'hat-helmet': helmet, 'hat-trapper': trapper, 'hat-bobble': bobble };
    for (const h of Object.values(this.hats)) {
      h.visible = false;
      this.head.add(h);
    }
    beanie.visible = true;

    // ---- skis on the boots, poles in the mitts
    for (const s of [this.L, this.R]) {
      const g = new THREE.Group();
      g.position.set(0, -ANKLE - 0.01, -0.07);
      const ski = box(0.085, 0.03, 1.65, this.skiMat, 0, 0, -0.05);
      const tip = box(0.085, 0.03, 0.2, this.skiMat, 0, 0.035, -0.95);
      tip.rotation.x = 0.45;
      g.add(ski, tip, box(0.1, 0.04, 0.16, mat(PAL.dark), 0, 0.03, 0.03));
      g.visible = false;
      s.ankle.add(g);
      this.feetSkis.push(g);
      const p = new THREE.Group();
      p.add(cyl(0.012, 0.012, 1.2, 5, mat(PAL.metal), 0, -0.85, -0.04), cyl(0.05, 0.05, 0.015, 8, mat(PAL.dark), 0, -1.38, -0.04));
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
    if (pose !== this.lastPose) {
      // a change of pose: everything eases across for a moment
      this.blend = 0.35;
      this.lastPose = pose;
    }
    this.blend = Math.max(0, this.blend - dt);
    const slow = this.blend > 0;
    // how fast we are turning and speeding up, for banking and leaning
    const yaw = new THREE.Euler().setFromQuaternion(this.group.quaternion, 'YXZ').y;
    let dyaw = yaw - this.lastYaw;
    while (dyaw > Math.PI) dyaw -= TAU;
    while (dyaw < -Math.PI) dyaw += TAU;
    this.lastYaw = yaw;
    const turn = Math.max(-3, Math.min(3, dyaw / Math.max(dt, 1e-3)));
    const accel = Math.max(-12, Math.min(12, (speed - this.lastSpeed) / Math.max(dt, 1e-3)));
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
    const leg = { L: { hip: 0, hipRoll: 0, knee: 0, ankle: 0 }, R: { hip: 0, hipRoll: 0, knee: 0, ankle: 0 } };
    const arm = { L: { arm: 0.05, roll: -0.12, elbow: 0.2 }, R: { arm: 0.05, roll: 0.12, elbow: 0.2 } };
    let ik = false;
    let fwdL = 0;
    let fwdR = 0;
    let liftL = 0;
    let liftR = 0;
    let pitchL = 0;
    let pitchR = 0;

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
      // weight over the planted foot, the free hip dropping a little, hips and shoulders counter-turning
      // normalised by the stance's full sweep, so the hips turn smoothly through the crossing
      const span = Math.max(0.1, cycleLength(v) * 0.6);
      const diff = Math.max(-1, Math.min(1, (fwdL - fwdR) / span));
      sway = -Math.cos(TAU * (ph - 0.3)) * (0.028 - r * 0.012) * k;
      roll = sway * 1.4;
      pyaw = -diff * (0.13 + r * 0.05) * k;
      chestYaw = -pyaw * 1.5;
      // lean into speed, into acceleration and up a hill
      spine = -(0.05 + r * 0.2) * k - accel * 0.012 - slope * 0.35;
      chest = -0.03 * k + Math.sin(TAU * ph * 2) * 0.02 * r;
      headX = -(spine + chest) * 0.85;
      // arms follow the opposite foot; a run pumps them bent
      const swingA = (0.55 + r * 0.25) * k;
      for (const [a, f, s] of [
        [arm.L, fwdR, -1],
        [arm.R, fwdL, 1],
      ] as const) {
        const sw = (f / Math.max(0.1, span / 2)) * swingA * 0.5;
        a.arm = sw + r * 0.15;
        a.roll = s * (0.1 + r * 0.06);
        a.elbow = 0.25 + Math.max(0, sw) * 0.55 + r * 1.05;
      }
      if (pose === 'carry') {
        // Pepper held to the chest
        arm.L = { arm: 0.75, roll: 0.35, elbow: 1.45 };
        arm.R = { arm: 0.75, roll: -0.35, elbow: 1.45 };
        chestYaw *= 0.3;
      }
      // bank into turns
      bank = -turn * Math.min(1, v / 3) * (0.06 + r * 0.06);
    } else if (pose === 'ski') {
      const crouch = Math.min(1, speed / 14);
      y = LEG - 0.12 - crouch * 0.16;
      ik = true;
      fwdL = 0.06;
      fwdR = -0.06;
      // skis stay flat on the snow
      pitchL = pitchR = 0;
      spine = -0.32 - crouch * 0.2;
      chest = -0.05;
      headX = -(spine + chest) * 0.9;
      spineRoll = -lean * 0.3;
      bank = -lean * 0.12;
      arm.L = { arm: 0.5, roll: -0.35, elbow: 0.5 };
      arm.R = { arm: 0.5, roll: 0.35, elbow: 0.5 };
      if (speed < 3 && speed > 0.3) {
        // poling along
        this.phase = (this.phase + ds / 2.2) % 1;
        const s = Math.sin(TAU * this.phase);
        arm.L.arm = 0.35 + s * 0.6;
        arm.R.arm = 0.35 - s * 0.6;
        spine += Math.abs(s) * -0.08;
      }
    } else if (pose === 'ride' || pose === 'pilot') {
      y = pose === 'ride' ? 0.62 : 0.5;
      leg.L = { hip: 1.45, hipRoll: -0.08, knee: -1.5, ankle: 0.05 };
      leg.R = { hip: 1.45, hipRoll: 0.08, knee: -1.5, ankle: 0.05 };
      spine = pose === 'ride' ? -0.25 - Math.min(0.15, speed * 0.01) : -0.05;
      spineRoll = -lean * 0.3;
      headX = -spine * 0.8;
      headY = -lean * 0.25;
      arm.L = { arm: 1.05, roll: -0.25, elbow: 0.45 };
      arm.R = { arm: 1.05, roll: 0.25, elbow: 0.45 };
      // a jolt of the body over the bumps at speed
      y += Math.sin(t * 17) * Math.min(0.012, speed * 0.0008);
    } else if (pose === 'work' || pose === 'pet') {
      // down on one knee
      y = 0.56;
      leg.L = { hip: 1.5, hipRoll: -0.1, knee: -1.55, ankle: 0.05 };
      leg.R = { hip: -0.05, hipRoll: 0.06, knee: -1.6, ankle: -0.6 };
      spine = -0.42;
      chest = -0.1;
      headX = 0.05;
      if (pose === 'work') {
        const k = Math.sin(t * 9);
        arm.L = { arm: 1.1 + k * 0.25, roll: -0.05, elbow: 0.6 - k * 0.2 };
        arm.R = { arm: 1.1 - k * 0.25, roll: 0.05, elbow: 0.6 + k * 0.2 };
        chestYaw = k * 0.06;
      } else {
        const k = Math.sin(t * 6);
        arm.L = { arm: 0.25, roll: -0.2, elbow: 0.4 };
        arm.R = { arm: 0.85 + k * 0.2, roll: 0.1, elbow: 0.55 - k * 0.25 };
        headX = 0.15;
        headY = -0.2;
      }
    } else if (pose === 'sleep') {
      y = 0.3;
      spine = -1.4;
      headX = 0.3;
    } else {
      // standing: breathing, a slow weight shift, now and then a look around
      ik = true;
      const w = Math.sin(t * 0.55);
      sway = w * 0.022;
      roll = w * 0.03;
      fwdL = 0.05;
      fwdR = -0.03;
      y = LEG - 0.035 - Math.abs(w) * 0.006 + Math.sin(t * 1.7) * 0.004;
      chest = Math.sin(t * 1.7) * 0.012;
      spineRoll = -w * 0.03;
      arm.L = { arm: 0.04 + Math.sin(t * 1.7 + 1) * 0.015, roll: -0.1, elbow: 0.18 };
      arm.R = { arm: 0.04 + Math.sin(t * 1.7 + 1.4) * 0.015, roll: 0.1, elbow: 0.2 };
      this.glanceT -= dt;
      if (this.glanceT < 0) {
        this.glanceT = 2.5 + Math.random() * 4;
        this.glance = Math.random() < 0.35 ? 0 : (Math.random() - 0.5) * 1.2;
      }
      headY = this.glance;
      headX = Math.sin(t * 0.4) * 0.04;
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
    this.chest.rotation.y = S.chestYaw.step(chestYaw, dt, 0.08);
    this.head.rotation.x = S.headX.step(headX, dt, 0.18);
    this.head.rotation.y = S.headY.step(headY, dt, 0.35);

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
