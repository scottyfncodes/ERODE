/**
 * Gait lab (dev only, not shipped): the patroller on a measured floor, driven exactly as the game
 * drives it (stride from distance travelled, speed in m/s), filmed from the side. Used to inspect the
 * walk and run frame by frame and to measure foot slide. Open /tools/gaitlab/ on the dev server.
 *
 * Query: ?speed=5.8 (constant) or ?profile=ramp (stand, walk, jog, run, stop); ?cam=side|front|follow.
 * window.lab: advance(seconds), metrics(), setSpeed(v), shot() for scripted capture.
 */
import * as THREE from 'three';
import { PatrollerMesh } from '../../src/render/characterMesh';
import { loadPatrolModels } from '../../src/render/patrolModels';
import { ACCEL, BRAKE } from '../../src/actors/walker';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const hud = document.getElementById('hud')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdfe6ea);
const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(4, 8, 3);
scene.add(sun);
// a floor marked every 0.5 m, so stride length and any foot slide can be read off the picture
const floor = new THREE.Mesh(new THREE.PlaneGeometry(4, 400), new THREE.MeshLambertMaterial({ color: 0xf3efe6 }));
floor.rotation.x = -Math.PI / 2;
floor.position.z = -190;
scene.add(floor);
const ticks = new THREE.Group();
for (let z = 10; z > -390; z -= 0.5) {
  const t = new THREE.Mesh(new THREE.BoxGeometry(z % 1 === 0 ? 1.2 : 0.5, 0.002, 0.012), new THREE.MeshBasicMaterial({ color: z % 5 === 0 ? 0xb03a2e : 0x8a8f99 }));
  t.position.set(0.9, 0.001, z);
  ticks.add(t);
}
scene.add(ticks);

const mesh = new PatrollerMesh(false, { hair: 0xd9b26a, long: true });
scene.add(mesh.group);
// planted-foot prints: a dot wherever an ankle is on the ground
const prints = new THREE.InstancedMesh(new THREE.CircleGeometry(0.03, 8).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x2a6fb0 }), 4000);
prints.count = 0;
scene.add(prints);

const state = { t: 0, z: 0, v: 0, stride: 0, target: Number(q.get('speed') ?? 0) };
const profile = q.get('profile');
// the game's own speed response (walker.ts): what the stick asks for, eased in
const ramp = (t: number) => (t < 1 ? 0 : t < 4 ? 1.4 : t < 7 ? 2.6 : t < 10 ? 4.2 : t < 14 ? 5.8 : t < 17 ? 2.6 : 0);
const L = (mesh as unknown as { L: { ankle: THREE.Object3D } }).L;
const R = (mesh as unknown as { R: { ankle: THREE.Object3D } }).R;
const w = new THREE.Vector3();
const mk = () => ({ on: false, x0: 0, z0: 0 });
const slide: Record<string, { on: boolean; x0: number; z0: number }> = { Lball: mk(), Lheel: mk(), Rball: mk(), Rheel: mk() };
// the boot's contact points in the ankle's frame (gait.ts: ANKLE above the sole, TOE to the ball)
const BALL = new THREE.Vector3(0, -0.08, -0.17);
const HEEL = new THREE.Vector3(0, -0.08, 0.05);
let lowest = 9;
const detail: Record<string, number> = {};
const worst = { L: 0, R: 0 };
let stepper: ((dt: number) => number) | null = null;

function advance(seconds: number, dt = 1 / 60) {
  for (let s = 0; s < seconds - 1e-6; s += dt) {
    state.t += dt;
    const want = stepper ? stepper(state.t) : profile === 'ramp' ? ramp(state.t) : state.target;
    // the walker's own acceleration (game: walker.ts)
    state.v = stepSpeed(state.v, want, dt);
    const d = state.v * dt;
    state.z -= d;
    state.stride += d;
    mesh.group.position.set(0, 0, state.z);
    mesh.animate(state.v > 4 ? 'run' : state.v > 0.3 ? 'walk' : 'idle', state.stride, state.v, 0, dt);
    mesh.group.updateMatrixWorld(true);
    // the boot touches the snow at the heel and the ball of the foot: each, while down, must not move
    for (const [k, a] of [['L', L.ankle], ['R', R.ankle]] as const) {
      for (const [pt, local] of [['ball', BALL], ['heel', HEEL]] as const) {
        w.copy(local);
        a.localToWorld(w);
        const sl = slide[`${k}${pt}`];
        const planted = w.y < 0.012;
        if (planted && !sl.on) {
          sl.on = true;
          sl.x0 = w.x;
          sl.z0 = w.z;
          if (pt === 'ball' && prints.count < 4000) {
            prints.setMatrixAt(prints.count++, new THREE.Matrix4().makeTranslation(w.x, 0.002, w.z));
            prints.instanceMatrix.needsUpdate = true;
          }
        } else if (planted) {
          const d = Math.hypot(w.x - sl.x0, w.z - sl.z0);
          if (state.v > 0.5) worst[k] = Math.max(worst[k], d);
          if (state.v > 0.5 && d > (detail[`${k}${pt}`] ?? 0)) detail[`${k}${pt}`] = d;
        } else sl.on = false;
      }
      a.getWorldPosition(w);
      lowest = Math.min(lowest, w.y);
    }
  }
}

/** The walker's response in a straight line (src/actors/walker.ts). */
let stepSpeed = (v: number, want: number, dt: number) => {
  const d = (want - v) * Math.min(1, dt * (want > 0 ? 9 : 12));
  const lim = (want > v ? ACCEL : BRAKE) * dt;
  return v + Math.max(-lim, Math.min(lim, d));
};

function frame() {
  const view = q.get('cam') ?? 'side';
  const w2 = canvas.clientWidth;
  const h2 = canvas.clientHeight;
  renderer.setSize(w2, h2, false);
  cam.aspect = w2 / h2;
  cam.updateProjectionMatrix();
  const z = state.z;
  if (view === 'front') cam.position.set(0.6, 1.1, z - 6);
  else if (view === 'follow') cam.position.set(1.8, 2.4, z + 5.6);
  else cam.position.set(6.5, 1.0, z);
  cam.lookAt(0, 0.9, z);
  renderer.render(scene, cam);
  hud.textContent = `t ${state.t.toFixed(2)} s   speed ${state.v.toFixed(2)} m/s   stride ${state.stride.toFixed(2)} m\nworst stance slide  L ${(worst.L * 100).toFixed(1)} cm  R ${(worst.R * 100).toFixed(1)} cm`;
}

const lab = {
  ready: false,
  advance: (s: number) => {
    advance(s);
    frame();
  },
  setSpeed: (v: number) => (state.target = v),
  setStepper: (f: string) => (stepper = new Function('t', `return (${f})`) as (t: number) => number),
  metrics: () => ({ t: state.t, v: state.v, stride: state.stride, slideL: worst.L, slideR: worst.R, lowestAnkle: lowest, detail }),
  resetMetrics: () => {
    worst.L = worst.R = 0;
    lowest = 9;
    for (const k in detail) delete detail[k];
  },
  setStepSpeed: (f: (v: number, want: number, dt: number) => number) => (stepSpeed = f),
};
(window as unknown as { lab: typeof lab }).lab = lab;

loadPatrolModels('/models/').then((m) => {
  mesh.useModel(m.rs_patroller);
  lab.ready = true;
  if (!q.has('manual')) {
    let last = performance.now();
    const loop = (now: number) => {
      advance(Math.min(0.1, (now - last) / 1000));
      last = now;
      frame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  } else frame();
});
