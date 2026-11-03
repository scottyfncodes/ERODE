import * as THREE from 'three';
import type { DogAnim } from '../actors/husky';
import { ball, box, cyl, mat, paint, repaint } from './kit';

const GREY = 0x5f6873;
const DARK = 0x3a4048;
const WHITE = 0xf4f2ee;

/**
 * Koda: grey saddle and mask over a white belly and face, pale blue eyes, a curled plume of a
 * tail, and the left ear that has never once stood up. Forward is -z.
 */
export class HuskyMesh {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private head = new THREE.Group();
  private tail = new THREE.Group();
  private legs: { g: THREE.Group; front: boolean; side: number }[] = [];
  private earL = new THREE.Group();
  private earR = new THREE.Group();
  private jaw: THREE.Mesh;
  private tongue: THREE.Mesh;
  private collar: THREE.MeshLambertMaterial;
  private harness = new THREE.Group();
  private harnessMain: THREE.MeshLambertMaterial;
  private harnessSecond: THREE.MeshLambertMaterial;
  private pack = new THREE.Group();
  private bandana: THREE.Mesh;
  private bandanaMat: THREE.MeshLambertMaterial;
  private eyesOpen: THREE.Mesh[] = [];
  private eyesShut: THREE.Mesh[] = [];
  private zzz: THREE.Group;
  private t = Math.random() * 10;
  private wag = 0;

  constructor() {
    const grey = mat(GREY);
    const white = mat(WHITE);
    const dark = mat(DARK);
    this.group.add(this.body);
    this.body.position.y = 0.5;
    // barrel: grey back, white belly
    const back = ball(0.3, grey, 0, 0.06, 0, 14);
    back.scale.set(0.95, 0.85, 1.75);
    const belly = ball(0.28, white, 0, -0.04, 0.02, 14);
    belly.scale.set(0.9, 0.8, 1.6);
    const chest = ball(0.25, white, 0, 0.0, -0.36, 12);
    const ruff = ball(0.27, grey, 0, 0.14, -0.32, 12);
    ruff.scale.set(1.05, 0.9, 0.8);
    this.body.add(back, belly, chest, ruff);
    // legs
    for (const [x, z, front] of [
      [-0.15, -0.35, true],
      [0.15, -0.35, true],
      [-0.15, 0.36, false],
      [0.15, 0.36, false],
    ] as const) {
      const g = new THREE.Group();
      g.position.set(x, -0.08, z);
      const upper = cyl(0.075, 0.065, 0.3, 8, front ? white : grey, 0, -0.15, 0);
      const lower = cyl(0.06, 0.055, 0.22, 8, white, 0, -0.36, 0);
      const paw = ball(0.07, white, 0, -0.46, -0.03, 8);
      paw.scale.set(1, 0.6, 1.3);
      g.add(upper, lower, paw);
      this.legs.push({ g, front, side: Math.sign(x) });
      this.body.add(g);
    }
    // head: grey cap and mask, white face, a long muzzle with a dark nose
    this.head.position.set(0, 0.28, -0.52);
    this.body.add(this.head);
    const skull = ball(0.2, grey, 0, 0.04, 0, 14);
    skull.scale.set(1, 0.9, 1.05);
    const face = ball(0.17, white, 0, -0.03, -0.08, 12);
    face.scale.set(1.05, 0.85, 1);
    const muzzle = ball(0.11, white, 0, -0.06, -0.25, 10);
    muzzle.scale.set(0.95, 0.75, 1.4);
    const nose = ball(0.045, 0x15171a, 0, -0.01, -0.39, 8);
    // the mask: a grey band over the eyes down to the nose
    const mask = box(0.07, 0.04, 0.24, grey, 0, 0.07, -0.18);
    mask.rotation.x = 0.35;
    this.jaw = box(0.12, 0.04, 0.16, white, 0, -0.13, -0.24);
    this.tongue = box(0.06, 0.015, 0.1, mat(0xe86a7a), 0, -0.12, -0.3);
    this.tongue.visible = false;
    for (const s of [-1, 1]) {
      const eye = ball(0.035, 0x8fd0f0, s * 0.085, 0.06, -0.165, 8);
      const pupil = ball(0.018, 0x101418, s * 0.088, 0.06, -0.195, 6);
      const shut = box(0.07, 0.012, 0.02, dark, s * 0.085, 0.06, -0.175);
      shut.visible = false;
      this.eyesOpen.push(eye, pupil);
      this.eyesShut.push(shut);
      this.head.add(eye, pupil, shut);
    }
    // ears: right stands tall, left flops over (always has)
    const ear = (g: THREE.Group, s: number) => {
      const e = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.17, 4), grey);
      e.position.y = 0.08;
      const inner = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.12, 4), mat(0xe8b4a8));
      inner.position.set(0, 0.07, -0.025);
      g.add(e, inner);
      g.position.set(s * 0.11, 0.16, 0.02);
      this.head.add(g);
    };
    ear(this.earL, -1);
    ear(this.earR, 1);
    this.earL.rotation.set(0.3, 0, 1.9);
    this.earR.rotation.set(0.05, 0, -0.15);
    this.head.add(skull, face, muzzle, nose, mask, this.jaw, this.tongue);
    // tail: a curled plume over the back
    const plume = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.07, 6, 10, Math.PI * 1.3), grey);
    plume.rotation.set(0, Math.PI / 2, 0);
    plume.position.set(0, 0.12, 0.05);
    const tip = ball(0.075, white, 0, 0.18, -0.12, 8);
    this.tail.add(plume, tip);
    this.tail.position.set(0, 0.18, 0.5);
    this.body.add(this.tail);
    // gear
    this.collar = paint(0xd8382a);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.03, 6, 14), this.collar);
    collar.rotation.x = Math.PI / 2 - 0.5;
    collar.position.set(0, 0.16, -0.44);
    const tag = ball(0.03, 0xf2c230, 0, 0.06, -0.55, 6);
    this.body.add(collar, tag);
    this.harnessMain = paint(0xd8382a);
    this.harnessSecond = paint(0xf3efe6);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.035, 6, 16), this.harnessMain);
    strap.position.set(0, 0.04, -0.12);
    const saddle = box(0.36, 0.06, 0.32, this.harnessMain, 0, 0.32, -0.05);
    const cross = box(0.37, 0.065, 0.08, this.harnessSecond, 0, 0.32, -0.05);
    const cross2 = box(0.08, 0.066, 0.2, this.harnessSecond, 0, 0.32, -0.05);
    this.harness.add(strap, saddle, cross, cross2);
    for (const s of [-1, 1]) this.pack.add(box(0.12, 0.2, 0.28, this.harnessSecond, s * 0.3, 0.12, 0.02));
    this.harness.add(this.pack);
    this.harness.visible = false;
    this.body.add(this.harness);
    this.bandanaMat = paint(0xd8382a);
    this.bandana = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.2, 3), this.bandanaMat);
    this.bandana.rotation.set(Math.PI + 0.4, 0, 0);
    this.bandana.position.set(0, 0.0, -0.5);
    this.bandana.visible = false;
    this.body.add(this.bandana);
    // sleeping zs
    this.zzz = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const z = box(0.08 + i * 0.03, 0.02, 0.02, mat(0xffffff), 0, i * 0.18, 0);
      this.zzz.add(z);
    }
    this.zzz.position.set(0.2, 0.9, -0.5);
    this.zzz.visible = false;
    this.group.add(this.zzz);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = true;
    });
  }

  setGear(collar: number, harness: { main: number; second: number; pack: boolean } | null, bandana: number | null) {
    repaint(this.collar, collar);
    this.harness.visible = !!harness;
    if (harness) {
      repaint(this.harnessMain, harness.main);
      repaint(this.harnessSecond, harness.second);
      this.pack.visible = harness.pack;
    }
    this.bandana.visible = bandana !== null;
    if (bandana !== null) repaint(this.bandanaMat, bandana);
  }

  animate(anim: DogAnim, stride: number, dt: number) {
    this.t += dt;
    const t = this.t;
    let bodyY = 0.5;
    let bodyX = 0;
    let headX = 0;
    let headY = 0;
    let tailX = 0;
    let wagSpeed = 6;
    let wagAmp = 0.25;
    const legRot = [0, 0, 0, 0];
    let mouth = 0;
    let eyes = true;
    this.zzz.visible = false;
    switch (anim) {
      case 'trot':
      case 'run': {
        const run = anim === 'run';
        const ph = stride * (run ? 2.6 : 4.2);
        const a = run ? 0.9 : 0.55;
        // a trot: diagonal pairs; a run: a bounding gallop
        if (run) {
          legRot[0] = legRot[1] = Math.sin(ph) * a;
          legRot[2] = legRot[3] = -Math.sin(ph + 0.6) * a;
          bodyX = Math.sin(ph) * 0.08;
          bodyY += Math.abs(Math.sin(ph)) * 0.08;
        } else {
          legRot[0] = legRot[3] = Math.sin(ph) * a;
          legRot[1] = legRot[2] = -Math.sin(ph) * a;
          bodyY += Math.abs(Math.sin(ph * 2)) * 0.02;
        }
        mouth = run ? 1 : 0.5;
        tailX = run ? -0.4 : 0;
        wagSpeed = 4;
        wagAmp = 0.12;
        headX = run ? 0.1 : 0;
        break;
      }
      case 'sit':
        legRot[0] = legRot[1] = -0.5;
        legRot[2] = legRot[3] = 1.0;
        bodyX = 0.5;
        bodyY = 0.42;
        headX = 0.35;
        mouth = 0.5;
        wagAmp = 0.15;
        wagSpeed = 3;
        break;
      case 'ride':
        legRot[0] = legRot[1] = -0.45;
        legRot[2] = legRot[3] = 1.0;
        bodyX = 0.45;
        bodyY = 0.4;
        headX = 0.25;
        headY = Math.sin(t * 0.7) * 0.4;
        mouth = 1;
        wagAmp = 0.1;
        break;
      case 'lie':
        legRot[0] = legRot[1] = 1.45;
        legRot[2] = legRot[3] = -1.45;
        bodyY = 0.24;
        headX = -0.1;
        headY = Math.sin(t * 0.3) * 0.3;
        wagAmp = 0.05;
        wagSpeed = 2;
        break;
      case 'sleep':
        legRot[0] = legRot[1] = 1.45;
        legRot[2] = legRot[3] = -1.45;
        bodyY = 0.22;
        headX = -0.5;
        headY = 0.6;
        eyes = false;
        wagAmp = 0;
        this.zzz.visible = true;
        this.zzz.position.y = 0.6 + ((t * 0.3) % 0.4);
        bodyY += Math.sin(t * 1.2) * 0.01;
        break;
      case 'sniff':
        headX = -0.65 + Math.sin(t * 9) * 0.05;
        headY = Math.sin(t * 1.3) * 0.3;
        legRot[0] = 0.15;
        wagAmp = 0.35;
        wagSpeed = 8;
        break;
      case 'happy':
        bodyY += Math.abs(Math.sin(t * 8)) * 0.07;
        headX = 0.3;
        headY = Math.sin(t * 6) * 0.2;
        mouth = 1;
        wagAmp = 0.6;
        wagSpeed = 18;
        bodyX = Math.sin(t * 8) * 0.04;
        break;
      case 'bark': {
        const b = Math.max(0, Math.sin(t * 7));
        headX = 0.2 + b * 0.25;
        mouth = b;
        legRot[0] = legRot[1] = -0.15;
        wagAmp = 0.4;
        wagSpeed = 10;
        break;
      }
      default:
        headY = Math.sin(t * 0.4) * 0.35;
        mouth = 0.6;
        wagAmp = 0.2;
        wagSpeed = 4;
    }
    const k = Math.min(1, dt * 12);
    const L = (a: number, b: number) => a + (b - a) * k;
    this.body.position.y = L(this.body.position.y, bodyY);
    this.body.rotation.x = L(this.body.rotation.x, bodyX);
    this.head.rotation.x = L(this.head.rotation.x, headX - bodyX);
    this.head.rotation.y = L(this.head.rotation.y, headY);
    this.legs.forEach((l, i) => (l.g.rotation.x = L(l.g.rotation.x, legRot[i])));
    this.wag += dt * wagSpeed;
    this.tail.rotation.z = Math.sin(this.wag) * wagAmp;
    this.tail.rotation.x = L(this.tail.rotation.x, tailX);
    this.jaw.rotation.x = mouth * 0.35;
    this.tongue.visible = mouth > 0.4;
    for (const e of this.eyesOpen) e.visible = eyes;
    for (const e of this.eyesShut) e.visible = !eyes;
    // the floppy ear bounces
    this.earL.rotation.z = 1.9 + Math.sin(t * 5 + stride * 3) * 0.12;
  }
}
