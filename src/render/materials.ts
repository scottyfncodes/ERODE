import {
  BackSide,
  Color,
  DoubleSide,
  MeshStandardMaterial,
  ShaderMaterial,
  type WebGLProgramParametersWithUniforms,
  type IUniform,
} from 'three';
import { NOISE_GLSL } from './shaderChunks';

export const shared = {
  time: { value: 0 } as IUniform<number>,
  wind: { value: 1 } as IUniform<number>,
  /** foliage and trunks closer to the camera than this fade out (start, end in metres), so trees never block the view */
  nearFade: { value: [7, 15] } as IUniform<number[]>,
  /** the boulder (xyz) and a radius (w): whatever stands between it and the camera is cut away; w = 0 turns it off */
  occluder: { value: [0, 0, 0, 0] } as IUniform<number[]>,
};

/** dithered fade of whatever is too close to the camera, or in the way of the boulder */
const CAMERA_FADE = /* glsl */ `
  {
    float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float camD = length(vViewPosition);
    if (camD < uNearFade.y && smoothstep(uNearFade.x, uNearFade.y, camD) < n) discard;
    if (uOccluder.w > 0.0) {
      vec3 ab = uOccluder.xyz - cameraPosition;
      float t = clamp(dot(vFadeWP - cameraPosition, ab) / dot(ab, ab), 0.0, 1.0);
      if (t < 0.9) {
        float r = uOccluder.w * (0.45 + 0.75 * t);
        float d = length(vFadeWP - (cameraPosition + ab * t));
        if (smoothstep(r * 0.55, r, d) < n) discard;
      }
    }
  }
`;
/** patch a standard material so it fades near the camera and clears the line of sight to the boulder */
export function cameraFade(shader: WebGLProgramParametersWithUniforms) {
  shader.uniforms.uNearFade = shared.nearFade;
  shader.uniforms.uOccluder = shared.occluder;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vFadeWP;')
    .replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      {
        vec4 fw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fw = instanceMatrix * fw;
        #endif
        vFadeWP = (modelMatrix * fw).xyz;
      }`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform vec2 uNearFade;\nuniform vec4 uOccluder;\nvarying vec3 vFadeWP;')
    .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${CAMERA_FADE}`);
}

/** Cartoon look: light falls into a few soft bands and colours get a little punchier. */
export const TOON_GLSL = /* glsl */ `
  {
    float lumE = dot(outgoingLight, vec3(0.299, 0.587, 0.114));
    float bands = 3.0;
    float x = lumE * bands;
    float lq = (floor(x) + smoothstep(0.3, 0.7, fract(x))) / bands;
    // a hint of banding, mostly natural light
    lq = mix(lq, lumE, 0.7);
    outgoingLight *= lq / max(lumE, 0.0005);
    float l2 = dot(outgoingLight, vec3(0.299, 0.587, 0.114));
    outgoingLight = mix(vec3(l2), outgoingLight, 1.12);
  }
`;

function inject(shader: WebGLProgramParametersWithUniforms, vertexDecl: string, vertexBody: string, fragDecl: string) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${vertexDecl}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${vertexBody}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${NOISE_GLSL}\n${fragDecl}`)
    .replace('#include <opaque_fragment>', `${TOON_GLSL}\n#include <opaque_fragment>`);
}

/** Granite. Pattern lives in the original boulder's material space, so fragments match. */
export interface RockUniforms {
  uSmooth: IUniform<number>;
  uRadius: IUniform<number>;
  /** stone colour, speckle colour and glassiness: what the rock is made of */
  uBase?: IUniform<Color>;
  uSpeck?: IUniform<Color>;
  uGloss?: IUniform<number>;
}

export interface RockLook {
  tint: [number, number, number];
  speck: [number, number, number];
  gloss: number;
}

export const ROCK_LOOKS: Record<string, RockLook> = {
  granite: { tint: [0.47, 0.41, 0.365], speck: [0.72, 0.58, 0.5], gloss: 0.05 },
  sandstone: { tint: [0.66, 0.4, 0.25], speck: [0.85, 0.62, 0.42], gloss: 0 },
  basalt: { tint: [0.17, 0.17, 0.18], speck: [0.3, 0.29, 0.3], gloss: 0.12 },
  obsidian: { tint: [0.06, 0.05, 0.07], speck: [0.2, 0.17, 0.26], gloss: 0.9 },
  limestone: { tint: [0.74, 0.72, 0.64], speck: [0.88, 0.86, 0.78], gloss: 0.04 },
  ice: { tint: [0.62, 0.78, 0.9], speck: [0.86, 0.94, 1.0], gloss: 0.7 },
};

export function rockUniforms(look: RockLook = ROCK_LOOKS.granite): Required<RockUniforms> {
  return {
    uSmooth: { value: 0 },
    uRadius: { value: 1 },
    uBase: { value: new Color(...look.tint) },
    uSpeck: { value: new Color(...look.speck) },
    uGloss: { value: look.gloss },
  };
}

export function setRockLook(u: RockUniforms, look: RockLook) {
  u.uBase?.value.setRGB(...look.tint);
  u.uSpeck?.value.setRGB(...look.speck);
  if (u.uGloss) u.uGloss.value = look.gloss;
}

/**
 * Granite. Pattern lives in the original boulder's material space, so fragments match.
 * `uSmooth` (0..1) wears it into a rounded, polished river pebble.
 */
export function createRockMaterial(opts: { tint?: Color; scale?: number; uniforms?: RockUniforms } = {}): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color: opts.tint ?? new Color(1, 1, 1), roughness: 0.9, metalness: 0 });
  const scale = (opts.scale ?? 1).toFixed(3);
  const u = opts.uniforms ?? rockUniforms();
  u.uBase ??= { value: new Color(...ROCK_LOOKS.granite.tint) };
  u.uSpeck ??= { value: new Color(...ROCK_LOOKS.granite.speck) };
  u.uGloss ??= { value: ROCK_LOOKS.granite.gloss };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSmooth = u.uSmooth;
    shader.uniforms.uRadius = u.uRadius;
    shader.uniforms.uBase = u.uBase!;
    shader.uniforms.uSpeck = u.uSpeck!;
    shader.uniforms.uGloss = u.uGloss!;
    inject(
      shader,
      'attribute vec3 rockPos; attribute float fresh; varying vec3 vRockPos; varying float vFresh; uniform float uSmooth; uniform float uRadius; varying float vSmooth;',
      `vRockPos = rockPos; vFresh = fresh; vSmooth = uSmooth;
      // wear: pull every point toward a rounded pebble of the same size
      float sm = uSmooth * 0.8;
      vec3 round = normalize(position) * uRadius * vec3(1.08, 0.82, 1.0);
      transformed = mix(transformed, round, sm);`,
      'varying vec3 vRockPos; varying float vFresh; varying float vSmooth; uniform vec3 uBase; uniform vec3 uSpeck; uniform float uGloss;',
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      `#include <beginnormal_vertex>
      objectNormal = normalize(mix(objectNormal, normalize(position * vec3(0.93, 1.22, 1.0)), uSmooth * 0.8));`,
    );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 rp = vRockPos * ${scale};
        float n1 = eFbm3(rp * 0.8);
        float n2 = eNoise3(rp * 8.0);
        float n3 = eNoise3(rp * 21.0 + 3.1);
        float n4 = eNoise3(rp * 15.0 + 7.7);
        vec3 base = mix(uBase * vec3(0.81, 0.85, 0.9), uBase * vec3(1.19, 1.15, 1.1), smoothstep(0.35, 0.65, n1));
        base = mix(base, uSpeck, smoothstep(0.55, 0.62, n2) * 0.3);
        base = mix(base, uBase * 0.6, smoothstep(0.86, 0.9, n3) * 0.45);
        float lich = smoothstep(0.52, 0.68, eFbm3(rp * 1.6 + 3.0)) * (1.0 - uGloss);
        vec3 weathered = base * vec3(0.74, 0.73, 0.70);
        weathered = mix(weathered, vec3(0.60, 0.60, 0.46), lich * 0.5);
        weathered = mix(weathered, vec3(0.72, 0.46, 0.20), smoothstep(0.72, 0.86, eFbm3(rp * 3.0 + 9.0)) * 0.55 * (1.0 - uGloss));
        weathered *= 0.85 + 0.3 * eFbm3(rp * 0.4 + 11.0);
        vec3 freshCol = base * vec3(1.12, 1.08, 1.05);
        vec3 rockCol = mix(weathered, freshCol, vFresh);
        // polished pebble: lichen gone, even tone, faint banding
        vec3 polished = mix(uBase * 1.05, uSpeck * 0.95, n1) * (0.92 + 0.08 * sin(rp.y * 9.0 + n2 * 3.0));
        polished = mix(polished, base * 1.05, 0.35);
        diffuseColor.rgb *= mix(rockCol, polished, smoothstep(0.15, 0.9, vSmooth));
        `,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        float hb = eFbm3(vRockPos * ${scale} * 1.6) * 0.8 + eNoise3(vRockPos * ${scale} * 7.0) * 0.08;
        normal = ePerturbNormal(-vViewPosition, normal, hb, mix(0.55, 0.25, vFresh) * (1.0 - vSmooth * 0.9));
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(mix(mix(0.95, 0.72, vFresh) - n3 * 0.08, 0.42, vSmooth), 0.12 + n3 * 0.1, uGloss);
        `,
      );
  };
  m.customProgramCacheKey = () => `rock-${scale}`;
  return m;
}

/** Ground: vertex colours set the material, shader noise adds grain at close range. */
export function createTerrainMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    inject(
      shader,
      'varying vec3 vWorldPos2;',
      'vWorldPos2 = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      'varying vec3 vWorldPos2;',
    );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 wp = vWorldPos2.xz;
        float d1 = eFbm2(wp * 0.21);
        float d2 = eNoise2(wp * 2.3);
        float d3 = eNoise2(wp * 9.0);
        diffuseColor.rgb *= (0.8 + 0.34 * d1) * (0.9 + 0.16 * d2) * (0.94 + 0.1 * d3);
        `,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        float th = eFbm2(vWorldPos2.xz * 0.6) * 0.6 + eNoise2(vWorldPos2.xz * 3.0) * 0.15;
        normal = ePerturbNormal(-vViewPosition, normal, th, 0.18);
        `,
      );
  };
  m.customProgramCacheKey = () => 'terrain';
  return m;
}

/** Bark: furrows along the trunk axis (local Y). */
export function createBarkMaterial(base = new Color(0.36, 0.27, 0.2)): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color: base, roughness: 0.95 });
  m.onBeforeCompile = (shader) => {
    inject(shader, 'varying vec3 vObj;', 'vObj = position;', 'varying vec3 vObj;');
    cameraFade(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float ang = atan(vObj.z, vObj.x);
        float furrow = eNoise3(vec3(cos(ang) * 3.0, vObj.y * 0.7, sin(ang) * 3.0));
        float fine = eNoise3(vec3(cos(ang) * 9.0, vObj.y * 3.0, sin(ang) * 9.0));
        diffuseColor.rgb *= 0.65 + 0.5 * smoothstep(0.25, 0.75, furrow) + 0.15 * fine;
        `,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        float bh = eNoise3(vec3(cos(atan(vObj.z, vObj.x)) * 3.0, vObj.y * 0.7, sin(atan(vObj.z, vObj.x)) * 3.0));
        normal = ePerturbNormal(-vViewPosition, normal, bh, 1.2);
        `,
      );
  };
  m.customProgramCacheKey = () => 'bark';
  return m;
}

/** End-grain for cut log faces. */
export function createEndGrainMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color: new Color(0.62, 0.48, 0.32), roughness: 0.9 });
  m.onBeforeCompile = (shader) => {
    inject(shader, 'varying vec3 vObj;', 'vObj = position;', 'varying vec3 vObj;');
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      float r = length(vObj.xz);
      float rings = 0.5 + 0.5 * sin(r * 40.0 + eNoise3(vObj * 6.0) * 4.0);
      diffuseColor.rgb *= 0.78 + 0.25 * rings;
      `,
    );
  };
  m.customProgramCacheKey = () => 'endgrain';
  return m;
}

/** Conifer foliage with wind sway (works for instanced and plain meshes). */
export function createFoliageMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.88, side: DoubleSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.time;
    shader.uniforms.uWind = shared.wind;
    inject(
      shader,
      'uniform float uTime; uniform float uWind; varying vec3 vObjF;',
      `
      vObjF = position;
      float phase = 0.0;
      #ifdef USE_INSTANCING
        phase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
      #endif
      float sway = max(0.0, position.y) * 0.018 * uWind;
      transformed.x += sin(uTime * 1.3 + phase) * sway;
      transformed.z += cos(uTime * 1.1 + phase * 1.3) * sway * 0.6;
      `,
      'varying vec3 vObjF;',
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      float nf = eNoise3(vObjF * 3.5);
      diffuseColor.rgb *= 0.72 + 0.45 * nf;
      // darker toward the trunk and the ground: the interior of a conifer is in shade
      diffuseColor.rgb *= 0.7 + 0.3 * smoothstep(0.1, 0.9, vObjF.y);
      `,
    );
  };
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    prev(shader, r);
    cameraFade(shader);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      float rim = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 3.0);
      totalEmissiveRadiance += vec3(0.16, 0.2, 0.1) * rim * 0.35;`,
    );
  };
  m.customProgramCacheKey = () => 'foliage';
  return m;
}

export function createSoilMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color: new Color(0.42, 0.31, 0.21), roughness: 1 });
  m.onBeforeCompile = (shader) => {
    inject(shader, 'varying vec3 vObjS;', 'vObjS = position;', 'varying vec3 vObjS;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float s1 = eFbm3(vObjS * 1.6);
        float s2 = eNoise3(vObjS * 12.0);
        diffuseColor.rgb *= 0.7 + 0.45 * s1 + 0.12 * s2;
        // root-bound grass on the crown of the bank
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.34, 0.16), smoothstep(0.55, 0.85, normalize(vObjS).y) * smoothstep(0.45, 0.6, s1) * 0.8);
        `,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        normal = ePerturbNormal(-vViewPosition, normal, eFbm3(vObjS * 3.0), 1.4);
        `,
      );
  };
  m.customProgramCacheKey = () => 'soil';
  return m;
}

export function createIceMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    color: new Color(0.78, 0.9, 0.98),
    roughness: 0.12,
    metalness: 0.05,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
  });
  m.onBeforeCompile = (shader) => {
    inject(shader, 'varying vec3 vWorldI;', 'vWorldI = (modelMatrix * vec4(transformed, 1.0)).xyz;', 'varying vec3 vWorldI;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float cr = eNoise2(vWorldI.xz * 2.2);
        float cracks = smoothstep(0.03, 0.0, abs(cr - 0.5));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), cracks * 0.6 + eNoise2(vWorldI.xz * 7.0) * 0.12);
        diffuseColor.a *= 0.85 + cracks * 0.15;
        `,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        normal = ePerturbNormal(-vViewPosition, normal, eNoise2(vWorldI.xz * 1.5), 0.25);
        `,
      );
  };
  m.customProgramCacheKey = () => 'ice';
  return m;
}

/** Inverted-hull outline used to show interactivity and selection. */
export function createOutlineMaterial(color: Color, width: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: color },
      uWidth: { value: width },
      uOpacity: { value: 0.0 },
      uTime: shared.time,
    },
    vertexShader: /* glsl */ `
      uniform float uWidth;
      void main() {
        vec3 n = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // constant-ish screen width: scale offset with distance
        mv.xyz += n * uWidth * (0.6 + 0.012 * -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uTime;
      void main() {
        gl_FragColor = vec4(uColor, uOpacity);
      }
    `,
    side: BackSide,
    transparent: true,
    depthWrite: false,
  });
}
