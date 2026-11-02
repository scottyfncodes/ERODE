import type { LevelDef, LevelObject, ObjectState, Plan } from '../levels/types';

export function defaultState(o: LevelObject): ObjectState {
  switch (o.type) {
    case 'rock':
      return { type: 'rock', removed: false, x: o.position[0], z: o.position[1] };
    case 'log':
      return { type: 'log', yaw: o.yaw, x: o.position[0], z: o.position[1] };
    case 'branches':
      return { type: 'branches', removed: false };
    case 'tree':
      return { type: 'tree', felled: null };
    case 'soil':
      return { type: 'soil', dug: false };
    case 'outcrop':
      return { type: 'outcrop', split: false };
    case 'ice':
      return { type: 'ice', broken: false };
    case 'gate':
      return { type: 'gate', option: o.initial };
  }
}

export function defaultPlan(level: LevelDef): Plan {
  const p: Plan = {};
  for (const o of level.objects) p[o.id] = defaultState(o);
  return p;
}

export function stateOf<T extends ObjectState['type']>(
  level: LevelDef,
  plan: Plan,
  id: string,
): Extract<ObjectState, { type: T }> {
  const o = level.objects.find((x) => x.id === id);
  if (!o) throw new Error(`unknown object ${id}`);
  return (plan[id] ?? defaultState(o)) as Extract<ObjectState, { type: T }>;
}

function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Has the player changed this object from how the mountain left it? */
export function isModified(o: LevelObject, s: ObjectState): boolean {
  const d = defaultState(o);
  switch (s.type) {
    case 'rock': {
      const dd = d as typeof s;
      return s.removed || Math.hypot(s.x - dd.x, s.z - dd.z) > 0.25;
    }
    case 'log': {
      const dd = d as typeof s;
      // a log is symmetric: rotating by 180° is the same log
      const da = Math.abs(angleDiff(s.yaw, dd.yaw));
      const sym = Math.min(da, Math.PI - da);
      return sym > 0.05 || Math.hypot(s.x - dd.x, s.z - dd.z) > 0.25;
    }
    case 'branches':
      return s.removed;
    case 'tree':
      return s.felled !== null;
    case 'soil':
      return s.dug;
    case 'outcrop':
      return s.split;
    case 'ice':
      return s.broken;
    case 'gate':
      return s.option !== (d as typeof s).option;
  }
}

export function countInterventions(level: LevelDef, plan: Plan): number {
  let n = 0;
  for (const o of level.objects) if (plan[o.id] && isModified(o, plan[o.id])) n++;
  return n;
}

/** Which water bodies are flowing under this plan. */
export function activeWater(level: LevelDef, plan: Plan): Set<string> {
  const out = new Set<string>();
  for (const w of level.water) {
    if (!w.activeWhen) {
      out.add(w.id);
      continue;
    }
    const s = plan[w.activeWhen.object];
    if (s && s.type === 'gate' && s.option === w.activeWhen.state) out.add(w.id);
  }
  return out;
}

export function clonePlan(p: Plan): Plan {
  return JSON.parse(JSON.stringify(p));
}

/** Validate a plan loaded from storage against the level, falling back to defaults. */
export function sanitizePlan(level: LevelDef, raw: unknown): Plan {
  const base = defaultPlan(level);
  if (!raw || typeof raw !== 'object') return base;
  for (const o of level.objects) {
    const s = (raw as Record<string, ObjectState>)[o.id];
    if (s && typeof s === 'object' && s.type === o.type) base[o.id] = { ...base[o.id], ...s } as ObjectState;
  }
  return base;
}
