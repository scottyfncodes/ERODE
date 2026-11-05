import { BOWL, CHARGE_SPOTS, pad } from '../world/places';
import { bowlContacts, mission, type MissionDef, type Step, type Target, type Vehicle } from './catalog';
import { newScan, nextContact, tickScan, type Contact, type ScanEvent, type ScanState } from './recon';

/**
 * One mission in progress: which step, and the little bits of state a step needs
 * (charges set, slopes scanned, who is riding on the sled). Pure; the game feeds it a snapshot
 * of the world each frame and tells it when an interaction finishes.
 */

export interface MissionRun {
  id: string;
  step: number;
  charges: string[];
  scan: ScanState | null;
  /** track step: Koda has the scent */
  tracking: boolean;
  /** someone or something is with you: on the sled, or in your arms */
  passenger: boolean;
  cargo: boolean;
  carrying: boolean;
  fired: boolean;
  /** seconds since the mission began */
  time: number;
  /** Kessel Bowl's loaded slopes for this run (repeat bowl work; absent on the story missions) */
  loaded?: string[];
}

export interface Snapshot {
  x: number;
  z: number;
  vehicle: Vehicle;
  heliLanded: boolean;
  heliAgl: number;
  heliYaw: number;
  /** has the avalanche settled (watch step) */
  avalancheDone: boolean;
}

export interface Interactable {
  id: string;
  x: number;
  z: number;
  /** 'dog' when the target is Koda */
  dog?: boolean;
  radius: number;
  action: string;
  hold: number;
  /** must be on foot */
  onFoot: boolean;
  /** must be on the sled */
  onSled?: boolean;
}

export type RunEvent =
  | { type: 'step'; index: number }
  | { type: 'complete' }
  | { type: 'scan'; ev: ScanEvent }
  | { type: 'charge'; spot: string }
  | { type: 'fire'; charges: string[] }
  | { type: 'track' }
  | { type: 'boarded' }
  | { type: 'cargo'; on: boolean };

export const newRun = (id: string, loaded?: readonly string[]): MissionRun => ({
  id, step: 0, charges: [], scan: null, tracking: false, passenger: false, cargo: false, carrying: false, fired: false, time: 0,
  ...(loaded ? { loaded: [...loaded] } : {}),
});

/** A scan step's contacts for this run: the bowl as it is loaded today, or the step's own. */
export function stepContacts(r: MissionRun, s: Extract<Step, { kind: 'scan' }>): Contact[] {
  return s.bowl && r.loaded ? bowlContacts(r.loaded) : s.contacts;
}

/** On a choose-your-charges step with at least one set: firing ends the step. */
const chooseReady = (r: MissionRun, s: Step | null) => s?.kind === 'charges' && !!s.choose && r.charges.length > 0;

export const currentStep = (r: MissionRun): Step | null => mission(r.id).steps[r.step] ?? null;

/** Stand this far from the slab (south of the runout line, or up on the ridge) before firing. */
export function safeToFire(x: number, z: number): boolean {
  const s = BOWL.slab;
  if (z < s.z0 - 25) return true; // above the start zone, on the ridge
  if (x < s.x0 - 60 || x > s.x1 + 60) return true; // well off to the side
  return z > -100; // far down, below the road
}

function advance(r: MissionRun, out: RunEvent[]) {
  r.step++;
  const def = mission(r.id);
  if (r.step >= def.steps.length) out.push({ type: 'complete' });
  else {
    out.push({ type: 'step', index: r.step });
    const s = def.steps[r.step];
    if (s.kind === 'scan') r.scan = newScan(stepContacts(r, s));
  }
}

/** Check the current step against the world. */
export function tickRun(r: MissionRun, snap: Snapshot, dt: number): RunEvent[] {
  const out: RunEvent[] = [];
  r.time += dt;
  const s = currentStep(r);
  if (!s) return out;
  const near = (t: Target, rad: number) => Math.hypot(snap.x - t.x, snap.z - t.z) < rad;
  switch (s.kind) {
    case 'goto':
      if (near(s.at, s.radius) && (!s.by || s.by.includes(snap.vehicle))) advance(r, out);
      break;
    case 'mount':
      if (snap.vehicle === s.vehicle) advance(r, out);
      break;
    case 'land':
      if (snap.vehicle === 'heli' && snap.heliLanded && near(s.at, 16)) advance(r, out);
      else if (snap.vehicle === 'foot' && near(s.at, 16)) advance(r, out);
      break;
    case 'scan': {
      const contacts = stepContacts(r, s);
      if (!r.scan) r.scan = newScan(contacts);
      if (snap.vehicle !== 'heli' || snap.heliLanded) break;
      for (const ev of tickScan(contacts, r.scan, { x: snap.x, z: snap.z, yaw: snap.heliYaw, agl: snap.heliAgl }, dt)) out.push({ type: 'scan', ev });
      if (r.scan.identified.every(Boolean)) advance(r, out);
      break;
    }
    case 'track':
      if (r.tracking && near(s.at, 7)) advance(r, out);
      break;
    case 'watch':
      if (snap.avalancheDone) advance(r, out);
      break;
    default:
      break;
  }
  return out;
}

/** What you can do right now for this mission, and where. */
export function interactables(r: MissionRun): Interactable[] {
  const s = currentStep(r);
  if (!s) return [];
  const def = mission(r.id);
  switch (s.kind) {
    case 'interact':
      if (s.at === 'dog') return [{ id: s.id, x: 0, z: 0, dog: true, radius: 2.6, action: s.action, hold: s.hold, onFoot: true }];
      return [{ id: s.id, x: s.at.x, z: s.at.z, radius: s.radius ?? 3.2, action: s.action, hold: s.hold, onFoot: s.onFoot ?? false }];
    case 'charges':
      return s.spots
        .filter((id) => !r.charges.includes(id))
        .map((id) => {
          const c = CHARGE_SPOTS.find((k) => k.id === id)!;
          return { id: `charge-${id}`, x: c.x, z: c.z, radius: 4, action: `Set charge: ${c.label}`, hold: 2.2, onFoot: true };
        });
    case 'track':
      return r.tracking ? [] : [{ id: 'scent', x: s.start.x, z: s.start.z, radius: 4.5, action: 'Give Koda the scent', hold: 0.8, onFoot: true }];
    case 'carry': {
      const sub = def.subject!;
      return [{ id: 'board', x: sub.x, z: sub.z, radius: 8, action: `Help ${sub.name} on`, hold: 1.2, onFoot: false, onSled: true }];
    }
    default:
      return [];
  }
}

/** An interaction finished. Returns events (and moves the mission on). */
export function interact(r: MissionRun, id: string): RunEvent[] {
  const out: RunEvent[] = [];
  const s = currentStep(r);
  if (!s) return out;
  if (s.kind === 'interact' && s.id === id) {
    if (id === 'crate') {
      r.cargo = true;
      out.push({ type: 'cargo', on: true });
    }
    if (id === 'unload') {
      r.cargo = false;
      out.push({ type: 'cargo', on: false });
    }
    if (id === 'pepper') r.carrying = true;
    if (id === 'pepper-home') r.carrying = false;
    if (id === 'handover-nils') r.passenger = false;
    advance(r, out);
  } else if (s.kind === 'charges' && id.startsWith('charge-')) {
    const spot = id.slice(7);
    if (s.spots.includes(spot) && !r.charges.includes(spot)) {
      r.charges.push(spot);
      out.push({ type: 'charge', spot });
      if (!s.choose && s.spots.every((k) => r.charges.includes(k))) advance(r, out);
    }
  } else if (s.kind === 'track' && id === 'scent') {
    r.tracking = true;
    out.push({ type: 'track' });
  } else if (s.kind === 'carry' && id === 'board') {
    r.passenger = true;
    out.push({ type: 'boarded' });
    advance(r, out);
  }
  return out;
}

/** The fire step's button: available when you are clear. */
export function fireState(r: MissionRun, x: number, z: number): 'none' | 'ready' | 'too-close' {
  const s = currentStep(r);
  if (!s || (s.kind !== 'fire' && !chooseReady(r, s)) || r.fired) return 'none';
  return safeToFire(x, z) ? 'ready' : 'too-close';
}

export function fire(r: MissionRun): RunEvent[] {
  const out: RunEvent[] = [];
  let s = currentStep(r);
  if (s && !r.fired && chooseReady(r, s)) {
    // the charges you chose are the charges you fire
    advance(r, out);
    s = currentStep(r);
  }
  if (!s || s.kind !== 'fire' || r.fired) return out;
  r.fired = true;
  out.push({ type: 'fire', charges: [...r.charges] });
  advance(r, out);
  return out;
}

/**
 * Where the nav arrow points. Some targets move (the dog, the sled): those come back as a keyword
 * for the game to resolve.
 */
export function navTarget(r: MissionRun, snap: { x: number; z: number }): Target | 'dog' | 'sled' | 'heli' | null {
  const s = currentStep(r);
  if (!s) return null;
  switch (s.kind) {
    case 'goto':
    case 'land':
      return s.at;
    case 'interact':
      return s.at;
    case 'mount':
      return s.vehicle === 'sled' ? 'sled' : s.vehicle === 'heli' ? 'heli' : null;
    case 'scan': {
      if (!r.scan) return null;
      const contacts = stepContacts(r, s);
      const i = nextContact(contacts, r.scan, snap);
      return i >= 0 ? { x: contacts[i].x, z: contacts[i].z, label: contacts[i].label } : null;
    }
    case 'charges': {
      // your own read: the arrow does not choose for you; once one is set, it points to safe ground
      if (s.choose) return r.charges.length && !safeToFire(snap.x, snap.z) ? { x: pad('ridge').x, z: pad('ridge').z, label: 'Safe ground: the ridge' } : null;
      const left = CHARGE_SPOTS.filter((c) => s.spots.includes(c.id) && !r.charges.includes(c.id));
      left.sort((a, b) => Math.hypot(a.x - snap.x, a.z - snap.z) - Math.hypot(b.x - snap.x, b.z - snap.z));
      return left[0] ? { x: left[0].x, z: left[0].z, label: left[0].label } : null;
    }
    case 'fire':
      return safeToFire(snap.x, snap.z) ? null : { x: pad('ridge').x, z: pad('ridge').z, label: 'Safe ground: the ridge' };
    case 'track':
      return r.tracking ? 'dog' : s.start;
    case 'carry': {
      const sub = mission(r.id).subject!;
      return { x: sub.x, z: sub.z, label: sub.name };
    }
    default:
      return null;
  }
}

export function stepCount(def: MissionDef) {
  return def.steps.length;
}
