import * as THREE from 'three';
import { ball, box, cyl, glow, mat, paint, PAL, repaint } from './kit';
import { dressModel, mountAtPivot, retire } from './patrolModels';

/**
 * The patrol snowmobile: a rounded cowl, a tall screen, two skis up front, a lugged track
 * under a long tunnel, and a rack at the back where Koda rides. Forward is -z.
 */
export class SledMesh {
  readonly group = new THREE.Group();
  /** the body leans and pitches inside the group */
  readonly body = new THREE.Group();
  private main: THREE.MeshLambertMaterial;
  private second: THREE.MeshLambertMaterial;
  private glass: THREE.MeshLambertMaterial;
  /** the code-built shape, until (unless) the MeshCraft model replaces it */
  private shell: THREE.Object3D[] = [];
  /** true once the MeshCraft model is in */
  modelled = false;
  private skis: THREE.Group[] = [];
  private track: THREE.Mesh;
  private trackTex = 0;
  readonly headlight: THREE.SpotLight;
  private lamp: THREE.Mesh;
  /** where the rider sits (body space) */
  readonly seat = new THREE.Vector3(0, 0.95, 0.25);
  /** where Koda sits */
  readonly rack = new THREE.Vector3(0, 1.0, 1.45);
  /** the crate, when carrying one */
  readonly crate: THREE.Group;

  constructor() {
    this.group.add(this.body);
    this.main = paint(PAL.red);
    this.second = paint(PAL.white);
    const dark = mat(0x25282c);
    const metal = mat(PAL.metal);
    const glass = (this.glass = new THREE.MeshLambertMaterial({ color: 0x9ad2ea, transparent: true, opacity: 0.55, emissive: 0x153848 }));
    const b = this.body;

    // cowl: a stretched, squashed sphere, with a white belly pan
    const cowl = ball(0.75, this.main, 0, 0.62, -0.9, 16);
    cowl.scale.set(0.95, 0.62, 1.35);
    const pan = box(1.15, 0.28, 2.1, this.second, 0, 0.32, -0.55);
    const hood = box(1.0, 0.18, 0.9, this.main, 0, 0.78, -0.2);
    hood.rotation.x = -0.18;
    const stripe = box(1.18, 0.1, 2.12, mat(0xffd23f), 0, 0.5, -0.55);
    // screen
    const screen = box(0.92, 0.55, 0.05, glass, 0, 1.15, -0.62);
    screen.rotation.x = -0.45;
    // bars
    const bar = cyl(0.04, 0.04, 1.0, 6, dark, 0, 1.05, -0.32);
    bar.rotation.z = Math.PI / 2;
    const stem = cyl(0.05, 0.05, 0.35, 6, dark, 0, 0.92, -0.38);
    const grips = [-0.5, 0.5].map((x) => {
      const g = cyl(0.055, 0.055, 0.16, 6, mat(0x111111), x, 1.05, -0.32);
      g.rotation.z = Math.PI / 2;
      return g;
    });
    // seat and tunnel
    const seat = box(0.62, 0.22, 1.25, dark, 0, 0.85, 0.45);
    const seatBack = box(0.62, 0.32, 0.15, dark, 0, 1.0, 1.05);
    const tunnel = box(0.95, 0.34, 2.2, this.second, 0, 0.6, 0.75);
    const tunnelSide = box(0.98, 0.1, 2.2, this.main, 0, 0.75, 0.75);
    // track
    this.track = box(0.72, 0.42, 2.4, dark, 0, 0.26, 0.8);
    const lugs = new THREE.Group();
    for (let i = 0; i < 10; i++) lugs.add(box(0.74, 0.06, 0.08, mat(0x3a3e44), 0, 0.05, -0.35 + i * 0.27));
    lugs.position.z = 0.75;
    for (const z of [-0.2, 1.8]) {
      const w = cyl(0.21, 0.21, 0.76, 10, metal, 0, 0.26, z);
      w.rotation.z = Math.PI / 2;
      b.add(w);
      this.shell.push(w);
    }
    // rack and taillight
    const rack = new THREE.Group();
    rack.add(box(0.85, 0.05, 0.9, metal, 0, 0, 0));
    for (const x of [-0.42, 0.42]) rack.add(box(0.05, 0.25, 0.9, metal, x, 0.12, 0));
    rack.add(box(0.85, 0.25, 0.05, metal, 0, 0.12, 0.45));
    rack.position.set(0, 0.82, 1.5);
    const tail = box(0.5, 0.1, 0.06, glow(0xff3020), 0, 0.68, 1.9);
    // the headlight
    this.lamp = box(0.42, 0.16, 0.08, glow(0xfff4d6), 0, 0.72, -1.55);
    this.lamp.rotation.x = -0.3;
    this.headlight = new THREE.SpotLight(0xfff0cc, 0, 60, 0.55, 0.6, 1.4);
    this.headlight.position.set(0, 0.8, -1.5);
    this.headlight.target.position.set(0, 0, -14);
    // skis on short arms
    for (const s of [-1, 1]) {
      const ski = new THREE.Group();
      const plank = box(0.18, 0.06, 1.5, dark, 0, 0, 0);
      const tip = box(0.18, 0.06, 0.4, dark, 0, 0.1, -0.88);
      tip.rotation.x = 0.55;
      ski.add(plank, tip);
      ski.position.set(s * 0.55, 0.04, -1.0);
      const arm = box(0.08, 0.08, 0.6, metal, s * 0.45, 0.35, -0.85);
      arm.rotation.z = s * 0.4;
      const spindle = cyl(0.05, 0.05, 0.4, 6, metal, s * 0.55, 0.22, -1.0);
      this.skis.push(ski);
      b.add(ski, arm, spindle);
      this.shell.push(plank, tip, arm, spindle);
    }
    // the crate, for deliveries
    this.crate = new THREE.Group();
    this.crate.add(box(0.8, 0.55, 0.75, PAL.wood, 0, 0.28, 0));
    this.crate.add(box(0.84, 0.08, 0.79, PAL.logDark, 0, 0.5, 0));
    this.crate.add(box(0.84, 0.08, 0.79, PAL.logDark, 0, 0.08, 0));
    this.crate.position.set(0, 0.85, 1.5);
    this.crate.visible = false;

    b.add(cowl, pan, hood, stripe, screen, bar, stem, ...grips, seat, seatBack, tunnel, tunnelSide, this.track, lugs, rack, tail, this.lamp, this.headlight, this.headlight.target, this.crate);
    this.shell.push(cowl, pan, hood, stripe, screen, bar, stem, ...grips, seat, seatBack, tunnel, tunnelSide, this.track, lugs, rack);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = true;
    });
  }

  /**
   * Swap the code-built shape for the MeshCraft model (public/models/rs_sled.glb). Same size, same
   * place, same pivots: the skis still steer, the paint still changes, the lamps, headlight and crate
   * are the code's own. Returns false, leaving the code-built sled, if the model is unusable.
   */
  useModel(scene: THREE.Object3D | undefined): boolean {
    const n = dressModel(scene, ['sled_body', 'sled_ski_L', 'sled_ski_R'], {
      main: this.main,
      second: this.second,
      glass: this.glass,
      dark: mat(0x25282c),
      metal: mat(PAL.metal),
      stripe: mat(0xffd23f),
      grip: mat(0x111111),
      lug: mat(0x3a3e44),
      cross: mat(PAL.white),
    });
    if (!n) return false;
    retire(this.shell);
    this.shell = [];
    this.body.add(n.sled_body);
    // the model's ski nodes sit on the same pivots as the steering groups
    mountAtPivot(n.sled_ski_L, this.skis[0]);
    mountAtPivot(n.sled_ski_R, this.skis[1]);
    this.modelled = true;
    return true;
  }

  setPaint(main: number, second: number) {
    repaint(this.main, main);
    repaint(this.second, second);
  }

  setHeadlight(on: boolean) {
    this.headlight.intensity = on ? 40 : 0;
  }

  /** Place on the ground following its normal; `lean` banks into turns. */
  sync(x: number, y: number, z: number, yaw: number, nx: number, ny: number, nz: number, lean: number, speed: number, steer: number, dt: number) {
    this.group.position.set(x, y, z);
    // align up with the ground normal, keep the heading
    const up = new THREE.Vector3(nx, ny, nz);
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    fwd.addScaledVector(up, -fwd.dot(up)).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
    const m = new THREE.Matrix4().makeBasis(right, up, fwd.clone().negate());
    this.group.quaternion.setFromRotationMatrix(m);
    this.body.rotation.set(0, 0, -lean * 0.22);
    for (const s of this.skis) s.rotation.y = -steer * 0.35;
    this.trackTex += speed * dt;
  }
}
