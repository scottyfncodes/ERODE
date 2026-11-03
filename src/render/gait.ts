/**
 * Human movement, as numbers: a two-bone leg solver, a speed-continuous gait (a walk that
 * lengthens and quickens into a run), and damped springs that carry every joint from pose to
 * pose. Pure and tested; the patroller mesh only turns these angles into rotations.
 *
 * Conventions (the mesh's): forward is -z, up is +y. A positive hip angle swings the leg forward,
 * a negative knee angle folds the shin back, a positive ankle angle lifts the toe.
 */

export const THIGH = 0.48;
export const SHIN = 0.46;
/** ankle joint above the sole */
export const ANKLE = 0.08;
/** hip joint above the ground with the leg straight */
export const LEG = THIGH + SHIN + ANKLE;
/** ankle to the ball of the foot (the toe-off pivot) */
export const TOE = 0.17;

export interface LegAngles {
  hip: number;
  knee: number;
}

/**
 * Solve a leg so the ankle lands at (`fwd`, `down`) from the hip joint (metres; `fwd` > 0 is
 * ahead, `down` > 0 is below). The knee always bends forward. Out of reach, the leg points
 * straight at the target.
 */
export function legIK(fwd: number, down: number, out: LegAngles = { hip: 0, knee: 0 }): LegAngles {
  const reach = THIGH + SHIN - 1e-4;
  let d = Math.hypot(fwd, down);
  if (d < 0.05) d = 0.05;
  if (d > reach) d = reach;
  const aim = Math.atan2(fwd, down);
  const cosA = (THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d);
  const cosK = (THIGH * THIGH + SHIN * SHIN - d * d) / (2 * THIGH * SHIN);
  out.hip = aim + Math.acos(Math.max(-1, Math.min(1, cosA)));
  out.knee = -(Math.PI - Math.acos(Math.max(-1, Math.min(1, cosK))));
  return out;
}

/** Where the ankle sits for given hip and knee angles (the inverse of `legIK`). */
export function legFK(hip: number, knee: number): { fwd: number; down: number } {
  return {
    fwd: THIGH * Math.sin(hip) + SHIN * Math.sin(hip + knee),
    down: THIGH * Math.cos(hip) + SHIN * Math.cos(hip + knee),
  };
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** 0 at a walk, 1 at a run, smooth between (m/s). */
export const runBlend = (speed: number) => smooth(2.9, 4.4, speed);

/** Metres travelled per full gait cycle (two steps) at a speed: longer strides as you go faster. */
export function cycleLength(speed: number): number {
  const r = runBlend(speed);
  return mix(0.75 + 0.28 * Math.min(speed, 3), 1.1 + 0.26 * speed, r);
}

/** Share of the cycle each foot is on the ground: a walk always has a foot down, a run flies. */
export function dutyFactor(speed: number): number {
  return mix(0.62 - 0.02 * Math.min(speed, 3), 0.38, runBlend(speed));
}

export interface Foot {
  /** ankle ahead of the hip (m) */
  fwd: number;
  /** sole above the ground under the hips (m) */
  lift: number;
  /** toe up (+) or down (-), radians */
  pitch: number;
  /** on the ground */
  planted: boolean;
}

/**
 * One foot through the cycle. `phase` 0..1 (0 = heel strike), `speed` m/s. In stance the foot
 * moves back at exactly the body's speed (it stays planted); in swing it lifts, passes under
 * the hip and reaches forward for the next strike.
 */
export function footAt(phase: number, speed: number, reachLimit: number, out: Foot = { fwd: 0, lift: 0, pitch: 0, planted: true }): Foot {
  const p = ((phase % 1) + 1) % 1;
  const duty = dutyFactor(speed);
  const L = cycleLength(speed);
  const r = runBlend(speed);
  // the planted foot covers L * duty while the body passes over it
  const half = Math.min(reachLimit, (L * duty) / 2);
  if (p < duty) {
    const s = p / duty;
    out.fwd = half - s * 2 * half;
    out.planted = true;
    // flat, then the heel peels up for toe-off: the ankle rises about the toe, which stays put,
    // and that rise is what lets a straight-ish leg reach the back of a long stride
    out.pitch = -smooth(0.62, 1, s) * mix(0.55, 0.75, r);
    out.lift = TOE * Math.sin(-out.pitch);
  } else {
    const s = (p - duty) / (1 - duty);
    // back to front, quick through the middle, slowing to meet the ground
    const e = s * s * (3 - 2 * s);
    out.fwd = -half + e * 2 * half;
    const h = mix(0.1, 0.3, r) * Math.min(1, speed / 1.2);
    out.lift = Math.sin(Math.PI * Math.min(1, s * 1.08)) * h;
    out.planted = false;
    // toe trails after push-off, then lifts to meet the snow heel first
    out.pitch = mix(-0.6, 0.25, smooth(0, 0.7, s));
  }
  return out;
}

/** Hip height over the ground at a phase: a walk vaults over the planted leg, a run sinks into it. */
export function pelvisBob(phase: number, speed: number): number {
  const r = runBlend(speed);
  const k = Math.min(1, speed / 1.5);
  const two = Math.cos(phase * Math.PI * 4);
  // walking: highest mid-stance (phase 0.25 / 0.75), lowest at the double support; running the reverse
  const walk = -two * 0.024 * k;
  const run = two * 0.045;
  // longer strides need lower hips to reach them
  const sink = mix(0.03 + 0.025 * Math.min(1, speed / 2.6), 0.13, r);
  return mix(walk, run, r) - sink * k;
}

/**
 * A critically damped spring: no overshoot, no lag at rest, smooth through any change of target.
 * `time` is roughly how long it takes to settle (s).
 */
export class Spring {
  v = 0;
  constructor(public x = 0) {}
  step(target: number, dt: number, time = 0.12): number {
    const w = 4.6 / Math.max(1e-3, time);
    // exact for a critically damped system over dt (stable at any frame rate)
    const e = Math.exp(-w * dt);
    const d = this.x - target;
    const c = this.v + w * d;
    this.x = target + (d + c * dt) * e;
    this.v = (this.v - c * w * dt) * e;
    return this.x;
  }
  set(x: number) {
    this.x = x;
    this.v = 0;
  }
}
