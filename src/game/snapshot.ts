/**
 * `window.game`: a read-only view of the live game for tests, playtest scripts and tools.
 *
 * Every read builds a fresh plain object from the game's state and freezes it (all the way down), so
 * nothing a script does to it reaches the game: there are no references to the game's own objects,
 * no functions and no setters. Building it costs nothing unless something reads it.
 *
 * The debug handle `window.patrol` (teleports, forcing missions) is separate and is for QA only.
 */

export interface GameSnapshot {
  /** 'title' before you start, 'play' on patrol */
  state: 'title' | 'play';
  /** a panel (map, mission table, pause, debrief…) is open; the valley is paused behind it */
  panel: boolean;
  day: number;
  /** minutes since midnight (06:00 = 360) */
  minute: number;
  funds: number;
  reputation: number;
  rank: { index: number; name: string };
  mode: 'foot' | 'sled' | 'heli' | 'skis';
  position: { x: number; y: number; z: number };
  /** ground speed, km/h */
  speedKmh: number;
  /** heading, degrees clockwise from north */
  heading: number;
  heli: { altitudeAboveGround: number; landed: boolean; rotor: number };
  koda: { mode: string; distance: number };
  weather: { sky: string; windKmh: number; tempC: number; snow: number; grounded: boolean; avalancheDanger: number };
  mission: null | { id: string; title: string; step: number; steps: number; stepKind: string; objective: string; seconds: number };
  /** what the action button would do right now, and how far a hold has got (0..1) */
  action: null | { label: string; hold: number; enabled: boolean };
  progress: { storyDone: number; storyTotal: number; calloutsAnswered: number; badges: number; badgesTotal: number; buildings: string[] };
  avalanche: { fired: boolean; settled: boolean; releasedShare: number; reachedRoad: boolean };
  assists: { heliHover: boolean; sledClimb: boolean; routeLine: boolean };
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Freeze an object and everything inside it. */
export function deepFreeze<T>(o: T): Readonly<T> {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

/** Round the numbers so the snapshot reads cleanly (positions to 0.1 m, speeds to 0.1 km/h). */
export function tidy(s: GameSnapshot): GameSnapshot {
  s.position = { x: r1(s.position.x), y: r1(s.position.y), z: r1(s.position.z) };
  s.speedKmh = r1(s.speedKmh);
  s.heading = Math.round(((s.heading % 360) + 360) % 360);
  s.heli = { ...s.heli, altitudeAboveGround: r1(s.heli.altitudeAboveGround), rotor: r3(s.heli.rotor) };
  s.koda = { ...s.koda, distance: r1(s.koda.distance) };
  s.weather = { ...s.weather, windKmh: Math.round(s.weather.windKmh), tempC: Math.round(s.weather.tempC), snow: r3(s.weather.snow) };
  if (s.mission) s.mission = { ...s.mission, seconds: r1(s.mission.seconds) };
  if (s.action) s.action = { ...s.action, hold: r3(s.action.hold) };
  s.avalanche = { ...s.avalanche, releasedShare: r3(s.avalanche.releasedShare) };
  return s;
}

/** Put a live, read-only `game` on the window: each read is a new frozen snapshot. */
export function exposeSnapshot(target: object, read: () => GameSnapshot) {
  Object.defineProperty(target, 'game', {
    get: () => deepFreeze(tidy(read())),
    set: () => {
      /* read-only: assignments are ignored */
    },
    enumerable: true,
    configurable: false,
  });
}
