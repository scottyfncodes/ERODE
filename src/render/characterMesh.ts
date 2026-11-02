import * as THREE from 'three';
import { ball, box, cyl, mat, paint, PAL } from './kit';

export type Pose = 'idle' | 'walk' | 'run' | 'ride' | 'ski' | 'pilot' | 'work' | 'pet' | 'carry' | 'sleep';

const SKIN = 0xf0c4a0;

/**
 * The patroller: a chunky, warm little figure in a patrol jacket with a white cross on the back
 * of the pack, a hat of your choosing, goggles on the brow and big mitts. Two-part legs so they
 * can sit a sled, crouch on skis and kneel at work. Forward is -z.
 */
export class PatrollerMesh {
  readonly group = new THREE.Group();
  private hips = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private legL = { hip: new THREE.Group(), knee: new THREE.Group() };
  private legR = { hip: new THREE.Group(), knee: new THREE.Group() };
  private jacket: THREE.MeshLambertMaterial;
  private trim: THREE.MeshLambertMaterial;
  private hatMain: THREE.MeshLambertMaterial;
  private hatSecond: THREE.MeshLambertMaterial;
  private lens: THREE.MeshLambertMaterial;
  private hats: Record<string, THREE.Group> = {};
  private skisOnBack = new THREE.Group();
  private skisOnFeet = new THREE.Group();
  private poles = new THREE.Group();
  private skiMat: THREE.MeshLambertMaterial;
  private held = new THREE.Group();
  private t = 0;

  constructor(civilian = false) {
    this.jacket = paint(PAL.red);
    this.trim = paint(PAL.white);
    this.hatMain = paint(PAL.red);
    this.hatSecond = paint(PAL.white);
    this.lens = new THREE.MeshLambertMaterial({ color: 0xf2a33a, emissive: 0x3a2000 });
    this.skiMat = paint(PAL.wood);
    const pants = mat(0x2b3440);
    const boot = mat(0x3a2a20);
    const mitt = mat(0x2b3440);

    this.group.add(this.hips);
    this.hips.position.y = 0.92;
    // legs: thigh from the hip, shin from the knee, a big boot
    for (const [leg, x] of [
      [this.legL, -0.17],
      [this.legR, 0.17],
    ] as const) {
      leg.hip.position.set(x, 0, 0);
      const thigh = cyl(0.13, 0.12, 0.46, 8, pants, 0, -0.23, 0);
      leg.knee.position.y = -0.46;
      const shin = cyl(0.12, 0.11, 0.38, 8, pants, 0, -0.19, 0);
      const b = box(0.24, 0.16, 0.36, boot, 0, -0.4, -0.06);
      const cuff = cyl(0.135, 0.135, 0.1, 8, mat(0xe8dcc8), 0, -0.3, 0);
      leg.knee.add(shin, b, cuff);
      leg.hip.add(thigh, leg.knee);
      this.hips.add(leg.hip);
    }
    // torso: a rounded jacket, a white band, the gaiter
    this.hips.add(this.torso);
    const body = ball(0.36, this.jacket, 0, 0.32, 0, 14);
    body.scale.set(1, 1.25, 0.82);
    const hem = cyl(0.33, 0.35, 0.16, 14, this.jacket, 0, 0.02, 0);
    const band = cyl(0.365, 0.365, 0.09, 14, this.trim, 0, 0.36, 0);
    band.scale.z = 0.84;
    const zip = box(0.03, 0.5, 0.03, mat(0x222222), 0, 0.35, -0.3);
    const gaiter = cyl(0.17, 0.2, 0.14, 12, this.trim, 0, 0.73, 0);
    // pack with the patrol cross
    const pack = box(0.46, 0.5, 0.22, mat(0x2b3440), 0, 0.38, 0.33);
    const crossV = box(0.08, 0.26, 0.02, this.jacket, 0, 0.42, 0.45);
    const crossH = box(0.26, 0.08, 0.02, this.jacket, 0, 0.42, 0.45);
    const crossBg = box(0.32, 0.32, 0.015, this.trim, 0, 0.42, 0.443);
    this.torso.add(body, hem, band, zip, gaiter);
    if (!civilian) this.torso.add(pack, crossBg, crossV, crossH);
    // skis carried A-frame on the pack
    for (const s of [-1, 1]) {
      const sk = box(0.08, 1.45, 0.03, this.skiMat, s * 0.11, 0.62, 0.47);
      sk.rotation.z = s * -0.05;
      this.skisOnBack.add(sk);
    }
    if (!civilian) this.torso.add(this.skisOnBack);
    // arms
    for (const [arm, x] of [
      [this.armL, -0.4],
      [this.armR, 0.4],
    ] as const) {
      arm.position.set(x, 0.58, 0);
      const sleeve = cyl(0.1, 0.11, 0.52, 8, this.jacket, 0, -0.26, 0);
      const cuff = cyl(0.115, 0.115, 0.07, 8, this.trim, 0, -0.46, 0);
      const hand = ball(0.12, mitt, 0, -0.56, 0, 8);
      arm.add(sleeve, cuff, hand);
      this.torso.add(arm);
    }
    this.armL.rotation.z = -0.18;
    this.armR.rotation.z = 0.18;
    // head
    this.head.position.y = 0.95;
    this.torso.add(this.head);
    const face = ball(0.27, SKIN, 0, 0, 0, 16);
    const nose = ball(0.06, 0xe6a37f, 0, -0.02, -0.27, 8);
    const eyeL = ball(0.035, 0x1d1d1d, -0.1, 0.05, -0.24, 6);
    const eyeR = ball(0.035, 0x1d1d1d, 0.1, 0.05, -0.24, 6);
    const cheekL = ball(0.05, 0xf29a8a, -0.16, -0.06, -0.2, 6);
    const cheekR = ball(0.05, 0xf29a8a, 0.16, -0.06, -0.2, 6);
    const hair = ball(0.275, 0x6b4428, 0, 0.04, 0.03, 14);
    hair.scale.set(1.02, 0.95, 1);
    // goggles on the brow
    const strap = cyl(0.285, 0.285, 0.07, 16, mat(0x222222), 0, 0.14, 0);
    const goggle = box(0.36, 0.12, 0.08, this.lens, 0, 0.15, -0.25);
    const frame = box(0.4, 0.15, 0.06, mat(0x222222), 0, 0.15, -0.23);
    this.head.add(hair, face, nose, eyeL, eyeR, cheekL, cheekR, strap, frame, goggle);
    // hats
    const beanie = new THREE.Group();
    const dome = ball(0.29, this.hatMain, 0, 0.1, 0.02, 14);
    dome.scale.set(1, 0.85, 1);
    beanie.add(dome, cyl(0.295, 0.3, 0.12, 14, this.hatSecond, 0, 0.12, 0.02));
    beanie.add(ball(0.09, this.hatSecond, 0, 0.36, 0.02, 8));
    const helmet = new THREE.Group();
    const shell = ball(0.31, this.hatMain, 0, 0.09, 0.02, 16);
    shell.scale.set(1, 0.9, 1.05);
    helmet.add(shell, box(0.08, 0.06, 0.4, this.hatSecond, 0, 0.36, 0.02));
    helmet.add(box(0.12, 0.12, 0.02, this.hatSecond, 0, 0.18, 0.33));
    const trapper = new THREE.Group();
    const cap = ball(0.3, this.hatMain, 0, 0.1, 0.02, 14);
    cap.scale.set(1, 0.85, 1);
    const fur = cyl(0.31, 0.31, 0.12, 14, this.hatSecond, 0, 0.08, 0.02);
    const flapL = box(0.08, 0.26, 0.2, this.hatSecond, -0.29, -0.06, 0.02);
    const flapR = box(0.08, 0.26, 0.2, this.hatSecond, 0.29, -0.06, 0.02);
    trapper.add(cap, fur, flapL, flapR);
    const bobble = new THREE.Group();
    const bd = ball(0.29, this.hatMain, 0, 0.12, 0.02, 14);
    bd.scale.set(1, 1.05, 1);
    bobble.add(bd, cyl(0.295, 0.3, 0.1, 14, this.hatSecond, 0, 0.08, 0.02), ball(0.13, this.hatSecond, 0, 0.45, 0.02, 10));
    this.hats = { 'hat-beanie': beanie, 'hat-helmet': helmet, 'hat-trapper': trapper, 'hat-bobble': bobble };
    for (const h of Object.values(this.hats)) {
      h.visible = false;
      this.head.add(h);
    }
    beanie.visible = true;

    // skis and poles for skiing
    for (const s of [-1, 1]) {
      const sk = box(0.1, 0.04, 1.7, this.skiMat, 0, -0.02, -0.1);
      const tip = box(0.1, 0.04, 0.22, this.skiMat, 0, 0.02, -1.0);
      tip.rotation.x = 0.45;
      const g = new THREE.Group();
      g.position.y = -0.48;
      g.add(sk, tip);
      g.userData.side = s;
      this.skisOnFeet.add(g);
    }
    this.legL.knee.add(this.skisOnFeet.children[0]);
    this.legR.knee.add(this.skisOnFeet.children[0]);
    for (const arm of [this.armL, this.armR]) {
      const pole = cyl(0.018, 0.018, 1.25, 5, mat(0x9aa3ab), 0, -0.9, -0.1);
      const basket = cyl(0.07, 0.07, 0.02, 8, mat(0x222222), 0, -1.4, -0.1);
      const p = new THREE.Group();
      p.add(pole, basket);
      p.visible = false;
      arm.add(p);
      this.poles.add(new THREE.Object3D());
      (this.poles.userData.list ??= [] as THREE.Group[]).push(p);
    }
    this.armR.add(this.held);
    this.held.position.set(-0.25, -0.55, -0.25);
    this.setSkis(false);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = true;
    });
  }

  setLook(jacket: number, trim: number, hatId: string, hatMain: number, hatSecond: number, lens: number, skis: number) {
    this.jacket.color.setHex(jacket);
    this.trim.color.setHex(trim);
    this.hatMain.color.setHex(hatMain);
    this.hatSecond.color.setHex(hatSecond);
    this.lens.color.setHex(lens);
    this.skiMat.color.setHex(skis);
    for (const [k, h] of Object.entries(this.hats)) h.visible = k === hatId;
  }

  /** Skis on the feet (skiing) or on the back. */
  setSkis(onFeet: boolean) {
    this.skisOnBack.visible = !onFeet;
    for (const c of [this.legL.knee, this.legR.knee]) for (const ch of c.children) if (ch.userData.side) ch.visible = onFeet;
    for (const p of this.poles.userData.list as THREE.Group[]) p.visible = onFeet;
  }

  /** Skis strapped to the pack (hidden while riding, when they would poke the passenger). */
  backSkis(on: boolean) {
    if (!this.skisOnFeetVisible) this.skisOnBack.visible = on;
  }

  private get skisOnFeetVisible() {
    return (this.poles.userData.list as THREE.Group[])[0].visible;
  }

  /** Something in the arms (Pepper the cat). */
  hold(obj: THREE.Object3D | null) {
    this.held.clear();
    if (obj) this.held.add(obj);
  }

  /**
   * Pose and animate. `stride`: distance walked (drives the step cycle); `speed` m/s;
   * `lean` -1..1 into a turn.
   */
  animate(pose: Pose, stride: number, speed: number, lean: number, dt: number) {
    this.t += dt;
    const t = this.t;
    const L = this.legL;
    const R = this.legR;
    let hipY = 0.92;
    let torsoX = 0;
    let torsoZ = 0;
    let headX = 0;
    let aL = { x: 0, z: -0.18 };
    let aR = { x: 0, z: 0.18 };
    let lL = { hip: 0, knee: 0 };
    let lR = { hip: 0, knee: 0 };
    switch (pose) {
      case 'walk':
      case 'run': {
        const run = pose === 'run';
        const ph = stride * (run ? 1.45 : 2.2);
        const amp = run ? 0.95 : 0.55;
        const s = Math.sin(ph);
        lL = { hip: s * amp, knee: -Math.max(0, -Math.cos(ph)) * amp * 1.3 };
        lR = { hip: -s * amp, knee: -Math.max(0, Math.cos(ph)) * amp * 1.3 };
        aL = { x: -s * amp * 0.9, z: -0.22 };
        aR = { x: s * amp * 0.9, z: 0.22 };
        hipY += Math.abs(Math.cos(ph)) * (run ? 0.09 : 0.04) - (run ? 0.05 : 0);
        torsoX = run ? -0.22 : -0.06;
        break;
      }
      case 'ride':
        lL = { hip: 1.35, knee: -1.45 };
        lR = { hip: 1.35, knee: -1.45 };
        aL = { x: 1.15, z: -0.3 };
        aR = { x: 1.15, z: 0.3 };
        torsoX = -0.28;
        torsoZ = -lean * 0.25;
        hipY = 0.62;
        break;
      case 'pilot':
        lL = { hip: 1.4, knee: -1.4 };
        lR = { hip: 1.4, knee: -1.4 };
        aL = { x: 0.8, z: -0.2 };
        aR = { x: 0.9, z: 0.2 };
        hipY = 0.5;
        break;
      case 'ski': {
        const crouch = Math.min(1, speed / 14);
        lL = { hip: 0.4 + crouch * 0.3, knee: -0.7 - crouch * 0.45 };
        lR = { hip: 0.4 + crouch * 0.3, knee: -0.7 - crouch * 0.45 };
        aL = { x: 0.55, z: -0.4 };
        aR = { x: 0.55, z: 0.4 };
        torsoX = -0.35 - crouch * 0.15;
        torsoZ = -lean * 0.35;
        hipY = 0.82 - crouch * 0.14;
        if (speed < 3 && speed > 0.3) {
          // poling along
          const ph = stride * 1.6;
          aL.x = 0.4 + Math.sin(ph) * 0.6;
          aR.x = 0.4 - Math.sin(ph) * 0.6;
        }
        break;
      }
      case 'work': {
        lL = { hip: 1.45, knee: -1.5 };
        lR = { hip: -0.15, knee: -1.55 };
        hipY = 0.55;
        torsoX = -0.4;
        const k = Math.sin(t * 9);
        aL = { x: 1.2 + k * 0.25, z: -0.1 };
        aR = { x: 1.2 - k * 0.25, z: 0.1 };
        headX = -0.25;
        break;
      }
      case 'pet':
        lL = { hip: 1.45, knee: -1.5 };
        lR = { hip: -0.15, knee: -1.55 };
        hipY = 0.55;
        torsoX = -0.35;
        aL = { x: 0.3, z: -0.2 };
        aR = { x: 0.9 + Math.sin(t * 7) * 0.25, z: 0.15 };
        headX = -0.3;
        break;
      case 'carry':
        aL = { x: 1.0, z: 0.35 };
        aR = { x: 1.0, z: -0.35 };
        {
          const ph = stride * 2.2;
          const s = Math.sin(ph);
          lL = { hip: s * 0.5 * Math.min(1, speed), knee: -Math.max(0, -Math.cos(ph)) * 0.6 * Math.min(1, speed) };
          lR = { hip: -s * 0.5 * Math.min(1, speed), knee: -Math.max(0, Math.cos(ph)) * 0.6 * Math.min(1, speed) };
        }
        break;
      case 'sleep':
        lL = { hip: 0, knee: 0 };
        lR = { hip: 0, knee: 0 };
        hipY = 0.3;
        torsoX = -1.5;
        break;
      default: {
        // breathing, a weight shift now and then
        const b = Math.sin(t * 1.6);
        hipY += b * 0.008;
        aL = { x: 0.04 * b, z: -0.16 };
        aR = { x: -0.04 * b, z: 0.16 };
        headX = Math.sin(t * 0.37) * 0.06;
        this.head.rotation.y = Math.sin(t * 0.23) * 0.35;
      }
    }
    if (pose !== 'idle') this.head.rotation.y *= 0.9;
    const k = Math.min(1, dt * 14);
    const lerp = (a: number, b: number) => a + (b - a) * k;
    this.hips.position.y = lerp(this.hips.position.y, hipY);
    this.torso.rotation.x = lerp(this.torso.rotation.x, torsoX);
    this.torso.rotation.z = lerp(this.torso.rotation.z, torsoZ);
    this.head.rotation.x = lerp(this.head.rotation.x, headX - torsoX * 0.6);
    this.armL.rotation.x = lerp(this.armL.rotation.x, aL.x);
    this.armL.rotation.z = lerp(this.armL.rotation.z, aL.z);
    this.armR.rotation.x = lerp(this.armR.rotation.x, aR.x);
    this.armR.rotation.z = lerp(this.armR.rotation.z, aR.z);
    // legs counter the torso lean so the feet stay under you
    L.hip.rotation.x = lerp(L.hip.rotation.x, lL.hip);
    R.hip.rotation.x = lerp(R.hip.rotation.x, lR.hip);
    L.knee.rotation.x = lerp(L.knee.rotation.x, lL.knee);
    R.knee.rotation.x = lerp(R.knee.rotation.x, lR.knee);
    // keep skis flat on the snow whatever the knee does
    for (const leg of [L, R])
      for (const ch of leg.knee.children)
        if (ch.userData.side) ch.rotation.x = -(leg.hip.rotation.x + leg.knee.rotation.x);
  }
}
