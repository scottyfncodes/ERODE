import { ShaderChunk, ShaderLib } from 'three';

/**
 * The high-country air, for every material in the scene at once.
 *
 * three.js's linear fog is replaced (in its shader chunks, before anything compiles) by aerial
 * perspective: haze that thickens with distance the way thin dry air does (exponentially), that pools
 * in the valley and thins with altitude so the summits stand clear of it, and that is lit by the sun:
 * looking towards the sun the far ridges dissolve into a warm glare, looking away they turn cold blue.
 *
 * `fogColor`, `fogNear` and `fogFar` still come from the scene's THREE.Fog (visibility for the weather).
 * The sun's direction and glow ride in two shared arrays: three clones a material's uniforms when it
 * compiles, but passes typed arrays through by reference, so one write here reaches every material.
 */

/** world-space direction to the sun (xyz) and how much the haze glows towards it (w) */
export const FOG_SUN = new Float32Array([0.4, 0.7, 0.3, 1]);
/** the colour of that glow (rgb) and the height the haze settles at (w, world metres) */
export const FOG_GLOW = new Float32Array([1, 0.85, 0.65, 120]);

const PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif
`;

const VERTEX = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  {
    vec4 fw = vec4( transformed, 1.0 );
    #ifdef USE_INSTANCING
      fw = instanceMatrix * fw;
    #endif
    vFogWorld = ( modelMatrix * fw ).xyz;
  }
#endif
`;

const PARS_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  uniform vec4 uFogSun;
  uniform vec4 uFogGlow;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif
`;

const FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  {
    vec3 toFrag = vFogWorld - cameraPosition;
    float d = length( toFrag );
    #ifdef FOG_EXP2
      float t = d * fogDensity;
    #else
      float t = max( d - fogNear, 0.0 ) / max( fogFar - fogNear, 1.0 );
    #endif
    // thin, dry air: haze builds exponentially with distance
    float fogAmt = 1.0 - exp( -t * 1.7 );
    // it pools in the valley and thins with altitude: the summits stand clear of it
    float hy = mix( cameraPosition.y, vFogWorld.y, 0.65 );
    fogAmt *= mix( 1.0, 0.5, smoothstep( uFogGlow.w, uFogGlow.w + 1100.0, hy ) );
    // lit by the sun: a warm glare towards it, cold blue away from it
    vec3 dir = toFrag / max( d, 1e-3 );
    float s = max( dot( dir, uFogSun.xyz ), 0.0 );
    vec3 haze = fogColor + uFogGlow.rgb * ( pow( s, 10.0 ) * 0.55 + pow( s, 2.0 ) * 0.12 ) * uFogSun.w;
    gl_FragColor.rgb = mix( gl_FragColor.rgb, haze, clamp( fogAmt, 0.0, 1.0 ) );
  }
#endif
`;

let installed = false;

/** Swap the fog chunks and give every built-in shader the sun's uniforms. Call before anything renders. */
export function installAtmosphere() {
  if (installed) return;
  installed = true;
  ShaderChunk.fog_pars_vertex = PARS_VERTEX;
  ShaderChunk.fog_vertex = VERTEX;
  ShaderChunk.fog_pars_fragment = PARS_FRAGMENT;
  ShaderChunk.fog_fragment = FRAGMENT;
  for (const lib of Object.values(ShaderLib) as { uniforms: Record<string, { value: unknown }> }[]) {
    if (!lib.uniforms || !('fogColor' in lib.uniforms)) continue;
    lib.uniforms.uFogSun = { value: FOG_SUN };
    lib.uniforms.uFogGlow = { value: FOG_GLOW };
  }
}
