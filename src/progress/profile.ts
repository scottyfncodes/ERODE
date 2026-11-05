import { mission, MISSIONS } from '../missions/catalog';
import type { MissionRun } from '../missions/runner';
import { newWeather, type WeatherState } from '../world/weather';
import { UPGRADES, upgradeDef, type UpgradeId } from '../world/station';
import { BADGES, DEFAULT_EQUIP, item, ITEMS, rankOf, type Item, type Slot } from './catalog';

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
  if (p.active && !MISSIONS.some((m) => m.id === p.active!.id)) p.active = null;
  if (p.active && (p.active.step < 0 || p.active.step >= mission(p.active.id).steps.length)) p.active = null;
  p.version = SAVE_VERSION;
  return p;
}

export interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
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

/** Pay out a finished mission. Returns the rank before and after. */
export function complete(p: Profile, id: string): { funds: number; rep: number; rankBefore: number; rankAfter: number } {
  const def = mission(id);
  const before = rank(p);
  p.completed[id] = (p.completed[id] ?? 0) + 1;
  p.funds += def.reward.funds;
  p.rep += def.reward.rep;
  if (def.dynamic) p.events = p.events.filter((e) => e !== id);
  if (def.controls) {
    p.weather.controlled = true;
    p.weather.freshSnow = Math.min(p.weather.freshSnow, 8);
  }
  if (id === 'survey') p.marked = ['A', 'C'];
  p.active = null;
  return { funds: def.reward.funds, rep: def.reward.rep, rankBefore: before, rankAfter: rank(p) };
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
  if (!done(p, 'rounds') || p.events.length > 0) return null;
  p.eventClock -= dt * (storm ? 1.6 : 1);
  if (p.eventClock > 0) return null;
  p.eventClock = 200 + roll() * 160;
  const pool = MISSIONS.filter((m) => m.dynamic && (!p.active || p.active.id !== m.id));
  if (!pool.length) return null;
  const pick = pool[Math.floor(roll() * pool.length)];
  p.events.push(pick.id);
  return pick.id;
}
