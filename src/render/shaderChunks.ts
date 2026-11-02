// Shared GLSL snippets.

export const NOISE_GLSL = /* glsl */ `
float eHash3(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float eNoise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(eHash3(i + vec3(0,0,0)), eHash3(i + vec3(1,0,0)), f.x),
                 mix(eHash3(i + vec3(0,1,0)), eHash3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(eHash3(i + vec3(0,0,1)), eHash3(i + vec3(1,0,1)), f.x),
                 mix(eHash3(i + vec3(0,1,1)), eHash3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float eFbm3(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * eNoise3(p); p *= 2.07; a *= 0.5; }
  return s;
}
float eHash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float eNoise2(vec2 x) {
  vec2 i = floor(x); vec2 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(eHash2(i), eHash2(i + vec2(1,0)), f.x), mix(eHash2(i + vec2(0,1)), eHash2(i + vec2(1,1)), f.x), f.y);
}
float eFbm2(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * eNoise2(p); p *= 2.03; a *= 0.5; }
  return s;
}
// Bump a normal from a scalar height using screen-space derivatives (no textures needed).
vec3 ePerturbNormal(vec3 surfPos, vec3 surfNorm, float h, float strength) {
  vec3 vSigmaX = dFdx(surfPos);
  vec3 vSigmaY = dFdy(surfPos);
  vec3 vN = surfNorm;
  vec3 R1 = cross(vSigmaY, vN);
  vec3 R2 = cross(vN, vSigmaX);
  float fDet = dot(vSigmaX, R1);
  vec2 dHdxy = vec2(dFdx(h), dFdy(h)) * strength;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * vN - vGrad);
}
`;
