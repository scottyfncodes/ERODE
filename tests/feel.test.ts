import { describe, expect, it } from 'vitest';
import { buzz, hitStopScale, HIT_FLOOR, HIT_HOLD, HIT_TOTAL } from '../src/game/feel';

describe('hit-stop', () => {
  it('nearly freezes the world for the hold, then eases back to full speed', () => {
    expect(hitStopScale(0)).toBe(HIT_FLOOR);
    expect(hitStopScale(HIT_HOLD * 0.9)).toBe(HIT_FLOOR);
    let last = HIT_FLOOR;
    for (let t = HIT_HOLD; t <= HIT_TOTAL; t += 0.02) {
      const k = hitStopScale(t);
      expect(k).toBeGreaterThanOrEqual(last - 1e-9);
      last = k;
    }
    expect(hitStopScale(HIT_TOTAL)).toBe(1);
    expect(hitStopScale(5)).toBe(1);
  });

  it('is a short beat: under half a second of lost world time', () => {
    let world = 0;
    for (let t = 0; t < HIT_TOTAL; t += 1 / 240) world += hitStopScale(t) / 240;
    expect(HIT_TOTAL - world).toBeLessThan(0.3);
    expect(HIT_TOTAL).toBeLessThan(0.6);
  });
});

describe('haptics', () => {
  it('does nothing (and never throws) where the browser cannot vibrate, or when switched off', () => {
    expect(() => buzz(true, [20])).not.toThrow();
    expect(() => buzz(false, [20])).not.toThrow();
  });
});
