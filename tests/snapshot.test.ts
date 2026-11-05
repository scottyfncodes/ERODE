import { describe, expect, it } from 'vitest';
import { exposeSnapshot, type GameSnapshot } from '../src/game/snapshot';

const live = () => ({
  funds: 60,
  pos: { x: 1.234, y: 2, z: 3 },
});

function sample(s: ReturnType<typeof live>): GameSnapshot {
  return {
    state: 'play', panel: false, day: 1, minute: 480, funds: s.funds, reputation: 0, rank: { index: 0, name: 'Recruit' }, mode: 'foot',
    position: { ...s.pos }, speedKmh: 4.04, heading: -90, heli: { altitudeAboveGround: 0, landed: true, rotor: 0 }, koda: { mode: 'follow', distance: 1.26 },
    weather: { sky: 'clear', windKmh: 12.4, tempC: -7.2, snow: 0, grounded: false, avalancheDanger: 3 }, mission: null, action: null,
    progress: { storyDone: 0, storyTotal: 5, calloutsAnswered: 0, badges: 0, badgesTotal: 10, buildings: [] },
    avalanche: { fired: false, settled: false, releasedShare: 0, reachedRoad: false }, assists: { heliHover: false, sledClimb: false, routeLine: false },
  };
}

describe('window.game snapshot', () => {
  it('is a fresh, deeply frozen copy on every read: writes never reach the game', () => {
    const state = live();
    const w = {} as { game: GameSnapshot };
    exposeSnapshot(w, () => sample(state));
    const a = w.game;
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.position)).toBe(true);
    expect(Object.isFrozen(a.progress.buildings)).toBe(true);
    expect(() => ((a as { funds: number }).funds = 1e6)).toThrow();
    expect(() => ((a.position as { x: number }).x = 0)).toThrow();
    (w as { game: unknown }).game = { funds: 1e6 };
    expect(w.game.funds).toBe(60);
    expect(state.pos.x).toBe(1.234);
    state.funds = 75;
    expect(w.game.funds).toBe(75);
    expect(w.game).not.toBe(a);
  });

  it('rounds for reading and normalises the heading', () => {
    const w = {} as { game: GameSnapshot };
    exposeSnapshot(w, () => sample(live()));
    expect(w.game.position.x).toBe(1.2);
    expect(w.game.heading).toBe(270);
    expect(w.game.speedKmh).toBe(4);
    expect(w.game.koda.distance).toBe(1.3);
  });

  it('has only plain data (no functions) for tools to read', () => {
    const w = {} as { game: GameSnapshot };
    exposeSnapshot(w, () => sample(live()));
    const walk = (o: unknown): boolean => (typeof o === 'function' ? false : o && typeof o === 'object' ? Object.values(o).every(walk) : true);
    expect(walk(w.game)).toBe(true);
    expect(JSON.parse(JSON.stringify(w.game)).rank.name).toBe('Recruit');
  });
});
