import { mission, MISSIONS, WIND_LOADS } from '../missions/catalog';
import { mulberry32 } from '../sim/noise';
import type { MissionRun } from '../missions/runner';
import { newWeather, type WeatherState } from '../world/weather';
import { UPGRADES, upgradeDef, type UpgradeId } from '../world/station';
import { BADGES, DEFAULT_EQUIP, item, ITEMS, RANKS, rankOf, type Item, type Slot } from './catalog';

/**
 * Everything that persists: progress, money, what you own and wear, what the station has grown
 * into, where you left off. One JSON object in localStorage, written often and on the way out.
 */

export const SAVE_KEY = 'rockslide.patrol.v1';
export const SAVE_VERSION = 1;

export type Mode = 'foot' | 'sled' | 'heli' | 'skis';

export interface Settings {
  sound: boolean;
  music: boolean;
  /** camera drag sensitivity multiplier */
  look: number;
  invertY: boolean;
  /** 'auto' picks by device; 'low' / 'high' force */
  quality: 'auto' | 'low' | 'high';
  /** buzz on big moments, where the browser can vibrate */
  vibrate: boolean;
  /** assists, all off unless the player turns them on in the pause menu */
  heliAssist: boolean;
  sledAssist: boolean;
  routeLine: boolean;
}

export interface Profile {
  version: number;
  funds: number;
  rep: number;
  completed: Record<string, number>;
  owned: string[];
  equip: Record<Slot, string>;
  upgrades: UpgradeId[];
  badges: string[];
  weather: WeatherState;
  active: MissionRun | null;
  /** dynamic events waiting on the board */
  events: string[];
  /** seconds until the next event may come in */
  eventClock: number;
  player: { x: number; z: number; yaw: number; mode: Mode };
  sled: { x: number; z: number; yaw: number };
  heli: { x: number; z: number; yaw: number };
  /** pets and treats */
  affection: number;
  /** the slopes the recon flight marked */
  marked: string[];
  /** Kessel Bowl's loaded slopes right now, once it has reloaded after the story's release ([] when not) */
  loaded: string[];
  /** the wind that loaded them, for the briefing */
  loadWind: string;
  /** repeat control work on the bowl: how many, and how many clean reads */
  bowlDays: number;
  cleanReads: number;
  settings: Settings;
  played: number;
  /** a new save that has not seen the opening yet */
  fresh: boolean;
  savedAt: number;
}

export function newProfile(): Profile {
  return {
    version: SAVE_VERSION,
    funds: 60,
    rep: 0,
    completed: {},
    owned: Object.values(DEFAULT_EQUIP),
    equip: { ...DEFAULT_EQUIP },
    upgrades: [],
    badges: [],
    weather: newWeather(),
    active: null,
    events: [],
    eventClock: 150,
    player: { x: -33.5, z: 243.2, yaw: -Math.PI / 2, mode: 'foot' },
    sled: { x: 23, z: 226, yaw: Math.PI / 2 },
    heli: { x: -24, z: 292, yaw: Math.PI / 2 },
    affection: 0,
    marked: [],
    loaded: [],
    loadWind: '',
    bowlDays: 0,
    cleanReads: 0,
    settings: { sound: true, music: true, look: 1, invertY: false, quality: 'auto', vibrate: true, heliAssist: false, sledAssist: false, routeLine: false },
    played: 0,
    fresh: true,
    savedAt: 0,
  };
}

/** Fill anything missing from an older or damaged save with defaults. */
export function migrate(raw: unknown): Profile {
  const base = newProfile();
  if (!raw || typeof raw !== 'object') return base;
  const p = { ...base, ...(raw as Partial<Profile>) };
  p.equip = { ...base.equip, ...(p.equip ?? {}) };
  p.settings = { ...base.settings, ...(p.settings ?? {}) };
  p.weather = { ...base.weather, ...(p.weather ?? {}) };
  p.player = { ...base.player, ...(p.player ?? {}) };
  p.sled = { ...base.sled, ...(p.sled ?? {}) };
  p.heli = { ...base.heli, ...(p.heli ?? {}) };
  p.owned = Array.from(new Set([...(Array.isArray(p.owned) ? p.owned : []), ...Object.values(DEFAULT_EQUIP)])).filter((id) => ITEMS.some((i) => i.id === id));
  for (const k of Object.keys(p.equip) as Slot[]) if (!ITEMS.some((i) => i.id === p.equip[k] && i.slot === k)) p.equip[k] = DEFAULT_EQUIP[k];
  p.upgrades = (Array.isArray(p.upgrades) ? p.upgrades : []).filter((u) => UPGRADES.some((d) => d.id === u));
  p.badges = (Array.isArray(p.badges) ? p.badges : []).filter((b) => BADGES.some((d) => d.id === b));
  p.events = (Array.isArray(p.events) ? p.events : []).filter((e) => MISSIONS.some((m) => m.id === e && m.dynamic));
  const slope = (s: unknown) => typeof s === 'string' && ['A', 'B', 'C', 'D'].includes(s);
  p.marked = (Array.isArray(p.marked) ? p.marked : []).filter(slope);
  p.loaded = (Array.isArray(p.loaded) ? p.loaded : []).filter(slope);
  if (typeof p.loadWind !== 'string') p.loadWind = '';
  if (!Number.isFinite(p.bowlDays)) p.bowlDays = 0;
  if (!Number.isFinite(p.cleanReads)) p.cleanReads = 0;
  // bowl calls without a loaded bowl behind them (a damaged save) go
  if (!p.loaded.length) p.events = p.events.filter((e) => !mission(e).bowl);
  if (p.active && !MISSIONS.some((m) => m.id === p.active!.id)) p.active = null;
  if (p.active && (p.active.step < 0 || p.active.step >= mission(p.active.id).steps.length)) p.active = null;
  if (p.active && mission(p.active.id).bowl && !(Array.isArray(p.active.loaded) && p.active.loaded.length)) p.active = null;
  p.version = SAVE_VERSION;
  return p;
}

export interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

/** The browser's localStorage, if it works here (private windows and blocked storage throw). */
export function browserStore(): Store | null {
  try {
    const s = window.localStorage;
    s.setItem('__t', '1');
    s.removeItem('__t');
    return s;
  } catch {
    return null;
  }
}

export function loadProfile(store: Store | null): Profile | null {
  if (!store) return null;
  try {
    const s = store.getItem(SAVE_KEY);
    if (!s) return null;
    return migrate(JSON.parse(s));
  } catch {
    return null;
  }
}

export function saveProfile(store: Store | null, p: Profile): boolean {
  if (!store) return false;
  try {
    p.savedAt = Date.now();
    store.setItem(SAVE_KEY, JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}

export const rank = (p: Profile) => rankOf(p.rep);
export const hasUpgrade = (p: Profile, u: UpgradeId) => p.upgrades.includes(u);
export const done = (p: Profile, id: string) => (p.completed[id] ?? 0) > 0;

/** Missions on the board right now: unlocked story missions not yet done, and waiting events. */
export function available(p: Profile): string[] {
  const story = MISSIONS.filter((m) => !m.dynamic && !done(p, m.id) && m.requires.every((r) => done(p, r))).map((m) => m.id);
  return [...story, ...p.events];
}

export function locked(p: Profile): string[] {
  return MISSIONS.filter((m) => !m.dynamic && !done(p, m.id) && !m.requires.every((r) => done(p, r))).map((m) => m.id);
}

/** Why an item cannot be bought yet, or null. */
export function blockReason(p: Profile, it: Item): string | null {
  if (p.owned.includes(it.id)) return null;
  if (rank(p) < it.rank) return `Needs rank: ${['Recruit', 'Patroller', 'Senior patroller', 'Lead patroller', 'Chief of patrol'][it.rank]}`;
  if (it.needs && !hasUpgrade(p, it.needs)) return `Needs the ${upgradeDef(it.needs).name.toLowerCase()}`;
  if (p.funds < it.cost) return 'Not enough funds';
  return null;
}

export function buy(p: Profile, id: string): boolean {
  const it = item(id);
  if (!it || p.owned.includes(id) || blockReason(p, it)) return false;
  p.funds -= it.cost;
  p.owned.push(id);
  p.equip[it.slot] = id;
  return true;
}

export function equip(p: Profile, id: string): boolean {
  const it = item(id);
  if (!it || !p.owned.includes(id)) return false;
  p.equip[it.slot] = id;
  return true;
}

export function upgradeBlock(p: Profile, id: UpgradeId): string | null {
  const u = upgradeDef(id);
  if (hasUpgrade(p, id)) return 'Built';
  if (rank(p) < u.rank) return `Needs rank: ${['Recruit', 'Patroller', 'Senior patroller', 'Lead patroller', 'Chief of patrol'][u.rank]}`;
  if (p.funds < u.cost) return 'Not enough funds';
  return null;
}

export function build(p: Profile, id: UpgradeId): boolean {
  if (upgradeBlock(p, id)) return false;
  p.funds -= upgradeDef(id).cost;
  p.upgrades.push(id);
  return true;
}

/** How a control job on the bowl went: what was charged, against what was loaded, and how much came down. */
export interface ControlResult {
  charged: string[];
  loaded: string[];
  /** share of the loaded snow that came down, 0..1 */
  share: number;
}

export interface ControlGrade {
  funds: number;
  rep: number;
  /** charges on stable slopes */
  wasted: number;
  /** loaded slopes left uncharged */
  missed: number;
  /** every loaded slope charged and nothing else */
  clean: boolean;
}

export const CONTROL_PAY = { funds: 100, rep: 60, perShare: { funds: 140, rep: 80 }, wasted: 25, clean: { funds: 50, rep: 30 } };

/**
 * Pay for repeat control work: a base for doing the job, most of the rest for the share of the
 * loaded snow brought down, a charge's worth off for each one on a stable slope, and a bonus for a
 * clean read. The most it pays is the mission's listed reward.
 */
export function gradeControl(r: ControlResult): ControlGrade {
  const wasted = r.charged.filter((c) => !r.loaded.includes(c)).length;
  const missed = r.loaded.filter((c) => !r.charged.includes(c)).length;
  const clean = wasted === 0 && missed === 0;
  const share = Math.max(0, Math.min(1, r.share));
  const funds = Math.max(0, CONTROL_PAY.funds + Math.round(CONTROL_PAY.perShare.funds * share) - CONTROL_PAY.wasted * wasted + (clean ? CONTROL_PAY.clean.funds : 0));
  const rep = CONTROL_PAY.rep + Math.round(CONTROL_PAY.perShare.rep * share) + (clean ? CONTROL_PAY.clean.rep : 0);
  return { funds, rep, wasted, missed, clean };
}

/** Pay out a finished mission. Returns the rank before and after (and the grade, for graded work). */
export function complete(p: Profile, id: string, control?: ControlResult): { funds: number; rep: number; rankBefore: number; rankAfter: number; grade?: ControlGrade } {
  const def = mission(id);
  const before = rank(p);
  const grade = def.graded && control ? gradeControl(control) : undefined;
  const pay = grade ? { funds: grade.funds, rep: grade.rep } : def.reward;
  p.completed[id] = (p.completed[id] ?? 0) + 1;
  p.funds += pay.funds;
  p.rep += pay.rep;
  if (def.dynamic) p.events = p.events.filter((e) => e !== id);
  if (def.controls) {
    p.weather.controlled = true;
    p.weather.freshSnow = Math.min(p.weather.freshSnow, 8);
    p.marked = [];
  }
  if (id === 'survey') p.marked = ['A', 'C'];
  if (id === 'bowl-recon') p.marked = [...p.loaded];
  if (def.bowl && def.controls) {
    // the bowl is down: the recon call (if nobody flew it) goes with it
    p.events = p.events.filter((e) => !mission(e).bowl);
    p.loaded = [];
    p.bowlDays += 1;
    if (grade?.clean) p.cleanReads += 1;
  }
  p.active = null;
  return { funds: pay.funds, rep: pay.rep, rankBefore: before, rankAfter: rank(p), grade };
}

/** Fresh snow (cm) that loads Kessel Bowl enough for the avalanche service to call it in again. */
export const RELOAD_CM = 25;

/** The wind (and so the loaded slopes) for a reload on `day`. */
export function windLoad(day: number): { wind: string; loaded: string[] } {
  const w = WIND_LOADS[Math.floor(mulberry32(day * 2654435 + 101)() * WIND_LOADS.length)];
  return { wind: w.wind, loaded: [...w.loaded] };
}

/** Bowl work is on the board or under way. */
export const bowlPending = (p: Profile): boolean => p.events.some((e) => mission(e).bowl) || (!!p.active && !!mission(p.active.id).bowl);

/**
 * After the story's release, Kessel Bowl loads up again whenever enough new snow builds up on it
 * (overnight, or through a snowy day). Then the avalanche service puts the recon flight and the
 * control job on the board, with today's wind deciding which slopes are loaded. Returns true when
 * it posts them.
 */
export function checkBowl(p: Profile): boolean {
  if (!done(p, 'release') || p.weather.controlled || p.weather.freshSnow < RELOAD_CM || bowlPending(p)) return false;
  const w = windLoad(p.weather.day);
  p.loaded = w.loaded;
  p.loadWind = w.wind;
  p.marked = [];
  p.events.push('bowl-recon', 'bowl-control');
  return true;
}

/** The next thing to work towards on the patrol: the next rank and how far off it is. */
export function nextGoal(p: Profile): { rank: string; next: string | null; need: number; progress: number } {
  const r = rank(p);
  const cur = RANKS[r];
  const nxt = RANKS[r + 1];
  if (!nxt) return { rank: cur.name, next: null, need: 0, progress: 1 };
  return { rank: cur.name, next: nxt.name, need: nxt.rep - p.rep, progress: (p.rep - cur.rep) / (nxt.rep - cur.rep) };
}

export const BADGE_REWARD = 40;

export function findBadge(p: Profile, id: string): boolean {
  if (p.badges.includes(id)) return false;
  p.badges.push(id);
  p.funds += BADGE_REWARD;
  p.rep += 15;
  return true;
}

/**
 * World events: every few minutes of play, once the first rounds are done, one may come in
 * (not while one is already waiting, and a storm makes them likelier).
 */
export function tickEvents(p: Profile, dt: number, storm: boolean, roll: () => number): string | null {
  // one radio callout waiting at a time (bowl work on the board does not hold them up)
  if (!done(p, 'rounds') || p.events.some((e) => !mission(e).bowl)) return null;
  p.eventClock -= dt * (storm ? 1.6 : 1);
  if (p.eventClock > 0) return null;
  p.eventClock = 200 + roll() * 160;
  const pool = MISSIONS.filter((m) => m.dynamic && !m.bowl && (!p.active || p.active.id !== m.id));
  if (!pool.length) return null;
  const pick = pool[Math.floor(roll() * pool.length)];
  p.events.push(pick.id);
  return pick.id;
}
