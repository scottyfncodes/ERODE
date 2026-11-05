/**
 * Two small pieces of game feel for the big moments.
 *
 * Hit-stop: when the charges go off, the world slows almost to a stop for a beat, so the flash and the
 * first crack across the slab register, then eases back to full speed. Only the simulation's clock is
 * slowed; the sound, the HUD and the input run in real time.
 *
 * Haptics: a short buzz under the thumb on the blast, a hard landing and a finished job, on phones whose
 * browser can vibrate (Android Chrome and most others; Safari on iPhone has no vibration API, so there it
 * does nothing). It can be switched off in the pause menu.
 */

/** seconds of near-freeze, then seconds of easing back to full speed */
export const HIT_HOLD = 0.09;
export const HIT_EASE = 0.4;
/** the slowest the world runs during the hold */
export const HIT_FLOOR = 0.06;

/** Simulation speed (0..1) `t` real seconds after a hit-stop started. */
export function hitScale(t: number): number {
  if (t < 0) return 1;
  if (t < HIT_HOLD) return HIT_FLOOR;
  const u = (t - HIT_HOLD) / HIT_EASE;
  if (u >= 1) return 1;
  // ease out: quick at first, settling into full speed
  return HIT_FLOOR + (1 - HIT_FLOOR) * (1 - (1 - u) * (1 - u));
}

export const HIT_TOTAL = HIT_HOLD + HIT_EASE;

/** Buzz patterns (ms on, off, on…). */
export const BUZZ = {
  blast: [45, 50, 90],
  landing: [22],
  done: [16, 70, 16],
} as const;

export function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

/** Buzz if the platform can and the player has not switched it off. Never throws. */
export function buzz(enabled: boolean, pattern: readonly number[]): void {
  if (!enabled || !canVibrate()) return;
  try {
    navigator.vibrate([...pattern]);
  } catch {
    /* some browsers refuse vibration without a recent tap: nothing to do */
  }
}
