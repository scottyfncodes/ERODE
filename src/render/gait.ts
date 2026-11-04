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
/** ankle to the back of the heel (the heel-strike pivot) */
export const HEEL = 0.05;

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
const TAU = Math.PI * 2;

/** 0 at a walk, 1 at a run, smooth between (m/s). */
export const runBlend = (speed: number) => smooth(2.4, 3.9, speed);

/** Share of the cycle each foot is on the ground: a walk always has a foot down, a run flies. */
export function dutyFactor(speed: number): number {
  // walking ~0.6; jogging ~0.36; a fast run ~0.3 (contact about 0.2 s of a 0.65 s stride)
  return mix(0.62 - 0.02 * Math.min(speed, 3), Math.max(0.28, 0.46 - 0.03 * speed), runBlend(speed));
}

/** How far the hips sink below a straight leg at a speed: a run bends into the ground. */
const sinkAt = (speed: number) => mix(0.025 + 0.02 * Math.min(1, speed / 2.6), 0.115, runBlend(speed)) * Math.min(1, speed / 1.5);

/**
 * Hip height over the ground at a phase. Walking vaults over the planted leg (highest at mid-stance,
 * phase duty/2); running is a spring (lowest at mid-stance, highest mid-flight). Phase 0 is a left
 * heel strike, 0.5 a right one.
 */
export function pelvisBob(phase: number, speed: number): number {
  const r = runBlend(speed);
  const k = Math.min(1, speed / 1.5);
  const mid = dutyFactor(speed) / 2;
  const two = Math.cos((phase - mid) * TAU * 2);
  const walk = two * 0.022 * k;
  const run = -two * (0.03 + 0.004 * speed);
  return mix(walk, run, r) - sinkAt(speed);
}

/** Toe-off: how far the heel has peeled up at the end of a stance (radians, foot pitch). */
const peelAt = (speed: number) => mix(0.5, 0.82, runBlend(speed));

export interface GaitShape {
  /** metres travelled per full cycle (two steps) */
  L: number;
  duty: number;
  /** ankle ahead of the hip at contact, behind it at toe-off (m) */
  front: number;
  back: number;
  /** swing clearance (m) and how early in the swing it peaks (exponent; < 1 is a heel kick) */
  clear: number;
  kick: number;
  r: number;
}

/**
 * The gait at a speed, from the leg's own geometry. A runner lands a little ahead of the hips and
 * pushes off well behind them (on the ball of the foot, heel peeled up); the planted foot has to
 * cover exactly the distance the body travels while it is down, so the stride is as long as the
 * runner would like but never longer than the leg can reach: a foot that cannot reach skates.
 */
export function gaitShape(speed: number): GaitShape {
  const v = Math.max(0, speed);
  const r = runBlend(v);
  const duty = dutyFactor(v);
  const reach = THIGH + SHIN;
  const base = LEG - 0.02;
  const yStrike = base + pelvisBob(0, v);
  const yOff = base + pelvisBob(duty, v);
  const peel = peelAt(v);
  const front = 0.97 * Math.sqrt(Math.max(0, reach * reach - (yStrike - ANKLE) ** 2));
  const dOff = yOff - ANKLE - TOE * Math.sin(peel);
  const back = 0.97 * Math.sqrt(Math.max(0, reach * reach - dOff * dOff)) + TOE * (1 - Math.cos(peel)) + ANKLE * Math.sin(peel);
  // a stride the runner wants: walking ~1.1-1.5 m, running grows with speed (~3.4 m at 5.8 m/s)
  const want = mix(0.6 + 0.45 * v, 1.0 + 0.42 * v, r);
  // the stance is shared out in proportion to what the leg can reach either side of the hips (a
  // runner, whose hips sit lower, lands nearer under them and pushes off further behind)
  const stance = Math.min(want * duty, front + back);
  const share = front / Math.max(1e-3, front + back);
  const L = Math.max(0.3, stance / duty);
  return {
    L,
    duty,
    front: stance * share,
    back: stance * (1 - share),
    clear: mix(0.1 * Math.min(1, v / 1.2), 0.1 + 0.055 * v, r),
    kick: mix(0.8, 0.62, r),
    r,
  };
}

/** Metres travelled per full gait cycle (two steps) at a speed: longer strides as you go faster. */
export const cycleLength = (speed: number) => gaitShape(speed).L;

export interface Foot {
  /** ankle ahead of the hip (m) */
  fwd: number;
  /** sole above the ground under the hips (m) */
  lift: number;
  /** toe up (+) or down (-), radians */
  pitch: number;
  /** on the ground */
  planted: boolean;
  /** in stance, where the foot is pinned to the ground (the ankle without the toe-off roll) */
  ground: number;
}

/**
 * One foot through the cycle. `phase` 0..1 (0 = contact), `speed` m/s. In stance the foot moves
 * back at exactly the body's speed (it stays planted), the heel peeling up about the ball of the foot
 * for toe-off; in swing it leaves at the speed it was going, folds up behind (the heel kicks towards
 * the seat at a run), drives forward under the hip and reaches out, easing back a touch to meet the
 * ground at its own speed. `reachLimit` is kept for callers; the shape already respects the leg.
 */
export function footAt(phase: number, speed: number, reachLimit = 10, out: Foot = { fwd: 0, lift: 0, pitch: 0, planted: true, ground: 0 }): Foot {
  const p = ((phase % 1) + 1) % 1;
  const g = gaitShape(speed);
  const front = Math.min(g.front, reachLimit);
  const back = Math.min(g.back, reachLimit + TOE);
  const peel = peelAt(speed);
  // walkers strike with the heel (toe up), runners nearer flat
  const strike = mix(0.22, 0.06, g.r) * Math.min(1, speed / 1);
  if (p < g.duty) {
    const s = p / g.duty;
    out.planted = true;
    // heel rocker: the toe comes down to the snow just after contact, the heel staying put
    const down = strike * (1 - smooth(0, 0.18, s));
    // heel off, rolling over the ball of the foot
    const up = peel * smooth(mix(0.55, 0.4, g.r), 1, s);
    out.pitch = down - up;
    out.ground = front - s * (front + back);
    // the ankle turns about whichever point of the sole is on the snow, so that point stays put:
    // the heel (HEEL behind the ankle) as the toe comes down, the ball (TOE ahead) as the heel lifts
    out.fwd = out.ground + TOE * (1 - Math.cos(up)) + ANKLE * Math.sin(up) + HEEL * (Math.cos(down) - 1) - ANKLE * Math.sin(down);
    out.lift = TOE * Math.sin(up) - ANKLE * (1 - Math.cos(up)) + HEEL * Math.sin(down) - ANKLE * (1 - Math.cos(down));
  } else {
    const s = (p - g.duty) / (1 - g.duty);
    out.planted = false;
    // matched to the stance speed at both ends: no pop as the foot leaves or meets the ground
    const m = -g.L * (1 - g.duty);
    // the last part of the swing the foot already moves with the ground (still in the world) and only
    // comes down: it is placed, not skidded in
    const e = mix(0.9, 0.95, g.r);
    const u = Math.min(1, s / e);
    const h = u * u * (3 - 2 * u);
    const lean = u * (2 * u - 1) * (u - 1);
    const p0 = -back + TOE * (1 - Math.cos(peel)) + ANKLE * Math.sin(peel);
    // land exactly where the stance takes over: heel down, toe up, the ankle where the heel puts it
    const p1 = front + HEEL * (Math.cos(strike) - 1) - ANKLE * Math.sin(strike);
    const l1 = HEEL * Math.sin(strike) - ANKLE * (1 - Math.cos(strike));
    const pe = p1 - m * (1 - e);
    out.fwd = s < e ? p0 + (pe - p0) * h + m * e * lean : p1 - m * (1 - s);
    out.ground = out.fwd;
    // lift: off the ball of the foot, up behind (early at a run), down to meet the snow
    const l0 = TOE * Math.sin(peel) - ANKLE * (1 - Math.cos(peel));
    const bump = Math.pow(Math.sin(Math.PI * Math.pow(s, g.kick)), 1 + 0.5 * (1 - g.r));
    out.lift = l0 * (1 - smooth(0.15, 0.6, s)) + l1 * smooth(0.5, 1, s) + g.clear * bump;
    // the toe trails after push-off, then comes up to meet the ground
    const trail = mix(-0.55, -0.95, g.r);
    out.pitch = mix(mix(-peel, trail, smooth(0, 0.3, s)), strike, smooth(0.4, 0.92, s));
  }
  return out;
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
