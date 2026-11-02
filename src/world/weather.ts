import { mulberry32 } from '../sim/noise';
import { clamp, lerp, smoothstep } from '../sim/geom';

/**
 * The day and the sky. A patrol day runs 06:00 to 22:00 in about twenty minutes of play;
 * the night passes quickly, or you sleep through it at the station. Each day has a forecast
 * of four periods, and the weather blends from one to the next.
 */

export type Sky = 'clear' | 'cloud' | 'snow' | 'storm';

export const SKY_LABEL: Record<Sky, string> = { clear: 'Clear', cloud: 'Overcast', snow: 'Snow', storm: 'Storm' };

export interface Period {
  name: string;
  from: number; // minutes since midnight
  sky: Sky;
  /** air temperature, °C */
  temp: number;
  /** wind, km/h */
  wind: number;
}

export const DAY_START = 6 * 60;
export const DAY_END = 22 * 60;
/** game minutes per real second, day and night */
export const DAY_RATE = (DAY_END - DAY_START) / (20 * 60);
export const NIGHT_RATE = 4;

const PERIODS: [string, number][] = [
  ['Morning', 6 * 60],
  ['Midday', 10 * 60],
  ['Afternoon', 14 * 60],
  ['Evening', 18 * 60],
];

/** The forecast for day `day` (1-based). Day one is gentle. */
export function forecast(day: number): Period[] {
  if (day <= 1) {
    const sky: Sky[] = ['clear', 'clear', 'cloud', 'snow'];
    return PERIODS.map(([name, from], i) => ({ name, from, sky: sky[i], temp: [-7, -3, -4, -8][i], wind: [8, 12, 18, 22][i] }));
  }
  const r = mulberry32(day * 7919 + 13);
  let prev: Sky = r() < 0.5 ? 'clear' : 'cloud';
  return PERIODS.map(([name, from], i) => {
    const roll = r();
    let sky: Sky;
    if (prev === 'storm') sky = roll < 0.5 ? 'snow' : 'cloud';
    else if (prev === 'snow') sky = roll < 0.25 ? 'storm' : roll < 0.6 ? 'snow' : 'cloud';
    else if (prev === 'cloud') sky = roll < 0.35 ? 'snow' : roll < 0.7 ? 'cloud' : 'clear';
    else sky = roll < 0.65 ? 'clear' : 'cloud';
    // at most one storm period a day, never first thing
    if (sky === 'storm' && i === 0) sky = 'snow';
    prev = sky;
    const base = -4 - r() * 8 + (i === 1 || i === 2 ? 3 : 0);
    const wind = sky === 'storm' ? 45 + r() * 20 : sky === 'snow' ? 15 + r() * 15 : 5 + r() * 15;
    return { name, from, sky, temp: Math.round(base - (sky === 'storm' ? 4 : 0)), wind: Math.round(wind) };
  });
}

const SKY_VALUES: Record<Sky, { snow: number; cloud: number; fog: number; wind: number }> = {
  clear: { snow: 0, cloud: 0.05, fog: 0, wind: 0.15 },
  cloud: { snow: 0.05, cloud: 0.7, fog: 0.25, wind: 0.3 },
  snow: { snow: 0.6, cloud: 0.85, fog: 0.5, wind: 0.45 },
  storm: { snow: 1, cloud: 1, fog: 1, wind: 1 },
};

export interface Conditions {
  /** falling snow 0..1 */
  snow: number;
  /** cloud cover 0..1 */
  cloud: number;
  /** haze and visibility loss 0..1 */
  fog: number;
  /** wind strength 0..1 */
  wind: number;
  /** daylight 0 (night) .. 1 (full day) */
  light: number;
  /** sun elevation (rad) and azimuth (rad) */
  sunEl: number;
  sunAz: number;
  sky: Sky;
  temp: number;
  windKmh: number;
  /** the helicopter stays on the ground */
  grounded: boolean;
}

export interface WeatherState {
  day: number;
  minute: number;
  /** fresh snow since the slopes were last controlled (cm) */
  freshSnow: number;
  /** days since Kessel Bowl was last released, -1 never */
  controlled: boolean;
}

export const newWeather = (): WeatherState => ({ day: 1, minute: 8 * 60, freshSnow: 38, controlled: false });

export function periodAt(day: number, minute: number): { now: Period; next: Period | null; blend: number } {
  const f = forecast(day);
  let i = 0;
  for (let k = 0; k < f.length; k++) if (minute >= f[k].from) i = k;
  const now = f[i];
  const next = f[i + 1] ?? null;
  const end = next ? next.from : DAY_END + 120;
  // the last 40 minutes of a period turn into the next one
  const blend = next ? smoothstep(end - 40, end, minute) : 0;
  return { now, next, blend };
}

export function conditions(w: WeatherState): Conditions {
  const { now, next, blend } = periodAt(w.day, w.minute);
  const a = SKY_VALUES[now.sky];
  const b = next ? SKY_VALUES[next.sky] : a;
  const snow = lerp(a.snow, b.snow, blend);
  const cloud = lerp(a.cloud, b.cloud, blend);
  const fog = lerp(a.fog, b.fog, blend);
  const wind = lerp(a.wind, b.wind, blend);
  const m = w.minute % 1440;
  // sun: rises ~06:30, sets ~19:30, highest at 13:00
  const dayT = (m - 6.5 * 60) / (13 * 60);
  const sunEl = Math.sin(clamp(dayT, -0.15, 1.15) * Math.PI) * 0.62;
  const sunAz = lerp(-1.9, 1.9, clamp(dayT, 0, 1)) + Math.PI;
  const light = smoothstep(-0.12, 0.18, sunEl);
  const sky = blend > 0.5 && next ? next.sky : now.sky;
  return {
    snow,
    cloud,
    fog,
    wind,
    light,
    sunEl,
    sunAz,
    sky,
    temp: Math.round(lerp(now.temp, next ? next.temp : now.temp, blend)),
    windKmh: Math.round(lerp(now.wind, next ? next.wind : now.wind, blend)),
    grounded: snow > 0.85 && wind > 0.8,
  };
}

/** Advance the clock and the snowpack by dt real seconds. */
export function tickWeather(w: WeatherState, dt: number): void {
  const day = w.minute >= DAY_START && w.minute < DAY_END;
  const rate = day ? DAY_RATE : NIGHT_RATE;
  const before = w.minute;
  w.minute += dt * rate;
  const c = conditions(w);
  // it snows a few centimetres an hour in a snow period
  w.freshSnow = Math.min(120, w.freshSnow + (c.snow * 4 * (w.minute - before)) / 60);
  if (w.minute >= 1440 + DAY_START) nextDay(w);
}

/** Sleep at the station: morning of the next day. */
export function nextDay(w: WeatherState): void {
  w.day += 1;
  w.minute = DAY_START + 15;
  // the snowpack settles overnight a little
  w.freshSnow = Math.max(0, w.freshSnow * 0.85);
  w.controlled = false;
}

/**
 * Avalanche danger on the five-level scale, from fresh snow and wind.
 * A controlled release brings the bowl down to moderate.
 */
export function avalancheDanger(w: WeatherState, c: Conditions): 1 | 2 | 3 | 4 | 5 {
  const load = w.freshSnow / 10 + c.wind * 2;
  let lvl = load < 1.5 ? 1 : load < 3 ? 2 : load < 5 ? 3 : load < 8 ? 4 : 5;
  if (w.controlled) lvl = Math.min(lvl, 2);
  return lvl as 1 | 2 | 3 | 4 | 5;
}

export const DANGER_LABEL = ['', 'Low', 'Moderate', 'Considerable', 'High', 'Very high'];

export function clock(minute: number): string {
  const m = Math.floor(minute) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
