import { BufferAttribute, BufferGeometry, Color, Group, Mesh, ShaderMaterial, UniformsLib, UniformsUtils, Vector3 } from 'three';
import type { LevelData, WaterBody } from '../sim/levelData';
import { bedAt } from '../sim/levelData';
import { pathPointAt } from '../sim/geom';
import { shared } from './materials';

const vert = /* glsl */ `
  attribute float aDepth;
  attribute float aSteep;
  varying float vSteep;
  varying vec2 vUv;
  varying float vDepth;
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vDepth = aDepth;
    vSteep = aSteep;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const frag = /* glsl */ `
  uniform float uTime;
  uniform float uFlow;
  uniform float uWidth;
  uniform float uReveal;
  uniform float uLength;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uSky;
  uniform vec3 uSunDir;
  uniform float uRill;
  varying vec2 vUv;
  varying float vDepth;
  varying vec3 vWorld;
  varying float vSteep;
  #include <fog_pars_fragment>
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
  float wave(vec2 p) { return n(p) * 0.55 + n(p * 2.3 + 4.0) * 0.3 + n(p * 5.1 + 9.0) * 0.15; }
  void main() {
    float along = vUv.y;
    if (along > uReveal * uLength) discard;
    vec2 p = vec2(vUv.x * uWidth * 0.9, along * 0.9 - uTime * uFlow);
    vec2 p2 = vec2(vUv.x * uWidth * 1.7 + 3.0, along * 1.6 - uTime * uFlow * 1.6);
    float e = 0.15;
    float w0 = wave(p) + wave(p2) * 0.5;
    float wx = wave(p + vec2(e, 0.0)) + wave(p2 + vec2(e, 0.0)) * 0.5;
    float wy = wave(p + vec2(0.0, e)) + wave(p2 + vec2(0.0, e)) * 0.5;
    vec3 N = normalize(vec3(-(wx - w0) * 1.6, 1.0, -(wy - w0) * 1.6));
    vec3 V = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    float depthT = clamp(vDepth / 1.2, 0.0, 1.0);
    vec3 col = mix(uShallow, uDeep, depthT);
    col = mix(col, uSky, 0.15 + fres * 0.6);
    vec3 H = normalize(uSunDir + V);
    col += vec3(1.0, 0.92, 0.75) * pow(max(dot(N, H), 0.0), 120.0) * 1.6;
    // foam: shallow edges and turbulent streaks
    float edge = 1.0 - smoothstep(0.05, 0.35, vDepth);
    float streak = smoothstep(0.62, 0.8, wave(vec2(vUv.x * uWidth * 2.2, along * 0.6 - uTime * uFlow * 1.3)));
    float foam = clamp(edge * (0.5 + 0.5 * streak) + streak * 0.25 * (uRill + 0.3), 0.0, 1.0);
    // white water: falls and steep rapids churn to foam
    float churn = smoothstep(0.05, 0.6, vSteep);
    foam = max(foam, churn * (0.65 + 0.35 * wave(vec2(vUv.x * uWidth * 3.0, along * 2.0 - uTime * uFlow * 3.0))));
    col = mix(col, vec3(0.93, 0.95, 0.95), foam * 0.7);
    float alpha = mix(0.35, 0.9, depthT) + foam * 0.3 + fres * 0.1;
    alpha *= smoothstep(0.0, 0.08, vDepth + 0.04);
    // springs rise out of the ground rather than starting at a hard edge
    alpha *= smoothstep(0.0, 8.0, along);
    // fade the leading edge as water runs in
    alpha *= smoothstep(uReveal * uLength, uReveal * uLength - 2.0, along);
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.95));
    #include <fog_fragment>
  }
`;

export interface WaterView {
  group: Group;
  meshes: Map<string, { mesh: Mesh; mat: ShaderMaterial; reveal: number; target: number }>;
  setActive(ids: Set<string>, instant?: boolean): void;
  update(dt: number): void;
  /** points along running water for ambient sound */
  soundPoints(): Vector3[];
}

function ribbon(data: LevelData, w: WaterBody): BufferGeometry {
  const isStream = w.spec.kind === 'stream';
  const width = isStream ? w.spec.width + 4 : w.spec.width;
  const across = isStream ? 12 : 5;
  const step = isStream ? 1.0 : 0.75;
  const n = Math.max(2, Math.ceil(w.pl.length / step) + 1);
  const pos: number[] = [];
  const uv: number[] = [];
  const depth: number[] = [];
  const steep: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = (i / (n - 1)) * w.pl.length;
    const slope = Math.max(0, (bedAt(w, Math.max(0, s - 1.5)) - bedAt(w, Math.min(w.pl.length, s + 1.5))) / 3);
    const pt = pathPointAt(w.pl, s);
    const nx = -pt.tz,
      nz = pt.tx;
    const surface = bedAt(w, s) + w.spec.depth;
    for (let j = 0; j < across; j++) {
      const u = j / (across - 1);
      const o = (u - 0.5) * width;
      const x = pt.x + nx * o,
        z = pt.z + nz * o;
      const ground = data.heightAt(x, z);
      let y: number;
      let d: number;
      if (isStream) {
        y = surface;
        d = surface - ground;
      } else {
        // a thin sheet of water hugging the gully floor
        const centre = 1 - Math.abs(u - 0.5) * 2;
        y = ground + 0.07 + centre * 0.05;
        d = 0.05 + centre * 0.3;
      }
      pos.push(x, y, z);
      uv.push(u, s);
      depth.push(d);
      steep.push(slope);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++)
    for (let j = 0; j < across - 1; j++) {
      const a = i * across + j,
        b = a + 1,
        c = a + across,
        d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('aDepth', new BufferAttribute(new Float32Array(depth), 1));
  g.setAttribute('aSteep', new BufferAttribute(new Float32Array(steep), 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function buildWater(data: LevelData, sunDir: Vector3, sky: Color): WaterView {
  const group = new Group();
  const meshes: WaterView['meshes'] = new Map();
  for (const w of data.water) {
    const isStream = w.spec.kind === 'stream';
    const mat = new ShaderMaterial({
      uniforms: UniformsUtils.merge([
        UniformsLib.fog,
        {
          uTime: { value: 0 },
          uFlow: { value: w.spec.flowSpeed * 0.5 },
          uWidth: { value: isStream ? w.spec.width + 4 : w.spec.width },
          uReveal: { value: 1 },
          uLength: { value: w.pl.length },
          uDeep: { value: new Color(0.06, 0.2, 0.22) },
          uShallow: { value: new Color(0.32, 0.42, 0.36) },
          uSky: { value: sky.clone() },
          uSunDir: { value: sunDir.clone() },
          uRill: { value: isStream ? 0 : 1 },
        },
      ]),
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    mat.uniforms.uTime = shared.time;
    const mesh = new Mesh(ribbon(data, w), mat);
    mesh.renderOrder = 2;
    mesh.name = `water:${w.spec.id}`;
    group.add(mesh);
    meshes.set(w.spec.id, { mesh, mat, reveal: 1, target: 1 });
  }
  return {
    group,
    meshes,
    setActive(ids, instant) {
      for (const [id, m] of meshes) {
        m.target = ids.has(id) ? 1 : 0;
        if (instant) m.reveal = m.target;
      }
    },
    update(dt) {
      for (const m of meshes.values()) {
        // water runs in down the gully; drains away faster
        const speed = m.target > m.reveal ? 0.35 : 1.2;
        if (m.reveal < m.target) m.reveal = Math.min(m.target, m.reveal + dt * speed);
        else if (m.reveal > m.target) m.reveal = Math.max(m.target, m.reveal - dt * speed);
        m.mat.uniforms.uReveal.value = m.reveal;
        m.mesh.visible = m.reveal > 0.001;
      }
    },
    soundPoints() {
      const pts: Vector3[] = [];
      for (const w of data.water) {
        const m = meshes.get(w.spec.id)!;
        if (m.target < 0.5) continue;
        for (let s = 0; s < w.pl.length; s += 8) {
          const p = pathPointAt(w.pl, s);
          pts.push(new Vector3(p.x, bedAt(w, s) + w.spec.depth, p.z));
        }
      }
      return pts;
    },
  };
}
