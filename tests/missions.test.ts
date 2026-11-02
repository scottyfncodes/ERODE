import { describe, expect, it } from 'vitest';
import { getTerrain } from '../src/world/terrain';
import { simulateRelease } from '../src/missions/avalanche';
import { mission, MISSIONS } from '../src/missions/catalog';
import { newRun, tickRun, interact, interactables, fire, fireState, navTarget, currentStep, safeToFire, type Snapshot } from '../src/missions/runner';
import { available, buy, build, complete, findBadge, loadProfile, migrate, newProfile, saveProfile, tickEvents, blockReason, SAVE_KEY } from '../src/progress/profile';
import { item, ITEMS } from '../src/progress/catalog';
import { pad, CHARGE_SPOTS } from '../src/world/places';

const t = getTerrain();

describe('Kessel Bowl avalanche', () => {
  it('a controlled release on the loaded slopes brings them down and the berm holds', () => {
    const s = simulateRelease(t, ['A', 'C']);
    expect(s.done).toBe(true);
    expect(s.result.weakReleased / s.result.weakTotal).toBeGreaterThan(0.8);
    expect(s.result.roadHit).toBe(false);
    // the flow runs well down the track into the runout
    expect(s.result.reachZ).toBeGreaterThan(-230);
    expect(s.time).toBeLessThan(60);
  });

  it('a charge on a sound slope only cracks it locally', () => {
    const s = simulateRelease(t, ['B']);
    expect(s.result.weakReleased).toBe(0);
    expect(s.result.released).toBeLessThan(25);
  });

  it('released blocks break up as they speed down', () => {
    const s = simulateRelease(t, ['A']);
    expect(s.blocks.some((b) => b.gen > 0)).toBe(true);
  });
});

const snap = (o: Partial<Snapshot>): Snapshot => ({ x: 0, z: 0, vehicle: 'foot', heliLanded: true, heliAgl: 0, heliYaw: 0, avalancheDone: false, ...o });

function play(id: string) {
  const r = newRun(id);
  return r;
}

describe('missions', () => {
  it('every mission has steps, a reward and a place', () => {
    for (const m of MISSIONS) {
      expect(m.steps.length).toBeGreaterThan(0);
      expect(m.reward.funds).toBeGreaterThan(0);
      for (const req of m.requires) expect(MISSIONS.some((k) => k.id === req)).toBe(true);
    }
  });

  it('Morning Rounds plays through', () => {
    const r = play('rounds');
    expect(interactables(r)[0].dog).toBe(true);
    interact(r, 'pet');
    expect(currentStep(r)!.kind).toBe('mount');
    tickRun(r, snap({ vehicle: 'sled', x: 20, z: 226 }), 0.1);
    expect(currentStep(r)!.kind).toBe('goto');
    const st = pad('station');
    tickRun(r, snap({ vehicle: 'sled', x: st.x, z: st.z }), 0.1);
    interact(r, 'anemometer');
    const ev = tickRun(r, snap({ vehicle: 'sled', x: 0, z: 250 }), 0.1);
    expect(ev.some((e) => e.type === 'complete')).toBe(true);
  });

  it('Eyes on Kessel Bowl: the SKYTRACE scanner reads every slope, loaded ones found', () => {
    const r = play('survey');
    tickRun(r, snap({ vehicle: 'heli', heliLanded: true }), 0.1);
    tickRun(r, snap({ vehicle: 'heli', heliLanded: false, x: -120, z: -330, heliAgl: 60 }), 0.1);
    expect(currentStep(r)!.kind).toBe('scan');
    const found: string[] = [];
    // hover just south of each slope, nose north toward it
    for (const c of CHARGE_SPOTS) {
      for (let i = 0; i < 40; i++) {
        for (const e of tickRun(r, snap({ vehicle: 'heli', heliLanded: false, x: c.x, z: c.z + 60, heliYaw: 0, heliAgl: 50 }), 0.05)) {
          if (e.type === 'scan' && e.ev.type === 'found') found.push(CHARGE_SPOTS[e.ev.index].id);
        }
      }
    }
    expect(found.sort()).toEqual(['A', 'C']);
    expect(currentStep(r)!.kind).toBe('land');
    const ev = tickRun(r, snap({ vehicle: 'heli', heliLanded: true, x: -24, z: 292 }), 0.1);
    expect(ev.some((e) => e.type === 'complete')).toBe(true);
  });

  it('Controlled Release: charges only on the loaded slopes, and only fired from safe ground', () => {
    const r = play('release');
    interact(r, 'locker');
    interact(r, 'gate-close');
    const ridge = pad('ridge');
    tickRun(r, snap({ vehicle: 'sled', x: ridge.x, z: ridge.z }), 0.1);
    expect(currentStep(r)!.kind).toBe('charges');
    expect(interactables(r).map((i) => i.id).sort()).toEqual(['charge-A', 'charge-C']);
    interact(r, 'charge-A');
    interact(r, 'charge-C');
    expect(currentStep(r)!.kind).toBe('fire');
    // standing on the slab: not safe
    expect(fireState(r, -120, -400)).toBe('too-close');
    expect(navTarget(r, { x: -120, z: -400 })).not.toBeNull();
    expect(fireState(r, ridge.x, ridge.z)).toBe('ready');
    const ev = fire(r);
    expect(ev.find((e) => e.type === 'fire')).toEqual({ type: 'fire', charges: ['A', 'C'] });
    tickRun(r, snap({ x: ridge.x, z: ridge.z, avalancheDone: true }), 0.1);
    interact(r, 'gate-open');
    expect(currentStep(r)).toBeNull();
    expect(safeToFire(-120, -380)).toBe(false);
  });

  it('Lost on the Tannberg: scent, follow, first aid, sled, clinic', () => {
    const r = play('skier');
    const top = pad('lifttop');
    tickRun(r, snap({ vehicle: 'sled', x: top.x, z: top.z }), 0.1);
    expect(interactables(r)[0].id).toBe('scent');
    interact(r, 'scent');
    expect(navTarget(r, { x: 0, z: 0 })).toBe('dog');
    const sub = mission('skier').subject!;
    tickRun(r, snap({ x: sub.x, z: sub.z }), 0.1);
    interact(r, 'aid-nils');
    expect(interactables(r)[0].onSled).toBe(true);
    interact(r, 'board');
    expect(r.passenger).toBe(true);
    tickRun(r, snap({ vehicle: 'foot', x: 380, z: 506 }), 0.1);
    expect(currentStep(r)!.kind).toBe('goto'); // on foot does not count: bring him on the sled
    tickRun(r, snap({ vehicle: 'sled', x: 380, z: 506 }), 0.1);
    interact(r, 'handover-nils');
    expect(currentStep(r)).toBeNull();
  });

  it('Firewood for the Kettle and Where is Pepper play through', () => {
    const r = play('supplies');
    interact(r, 'crate');
    expect(r.cargo).toBe(true);
    tickRun(r, snap({ vehicle: 'sled' }), 0.1);
    tickRun(r, snap({ vehicle: 'sled', x: 330, z: 461 }), 0.1);
    interact(r, 'unload');
    expect(currentStep(r)).toBeNull();
    const q = play('pepper');
    tickRun(q, snap({ x: -300, z: 455 }), 0.1);
    interact(q, 'scent');
    const cat = mission('pepper').subject!;
    tickRun(q, snap({ x: cat.x, z: cat.z }), 0.1);
    interact(q, 'pepper');
    expect(q.carrying).toBe(true);
    tickRun(q, snap({ x: 330, z: 461 }), 0.1);
    interact(q, 'pepper-home');
    expect(currentStep(q)).toBeNull();
  });

  it('the callouts play through', () => {
    for (const [id, act] of [
      ['tree', 'saw'],
      ['drift', 'dig'],
    ]) {
      const r = play(id);
      const at = mission(id).where;
      tickRun(r, snap({ x: at.x, z: at.z }), 0.1);
      interact(r, act);
      expect(currentStep(r)).toBeNull();
    }
  });

  it('Nils is found on gentle ground, and every scent trail can be walked', () => {
    for (const id of ['skier', 'pepper']) {
      const s = mission(id).steps.find((k) => k.kind === 'track')!;
      if (s.kind !== 'track') continue;
      for (const p of s.trail) expect((t.slope(p.x, p.z) * 180) / Math.PI).toBeLessThan(42);
    }
    const sub = mission('skier').subject!;
    expect((t.slope(sub.x, sub.z) * 180) / Math.PI).toBeLessThan(20);
  });
});

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};

describe('progression and saving', () => {
  it('opens missions as you finish them', () => {
    const p = newProfile();
    expect(available(p)).toEqual(['rounds']);
    complete(p, 'rounds');
    expect(available(p)).toEqual(expect.arrayContaining(['survey', 'supplies']));
    complete(p, 'survey');
    expect(p.marked).toEqual(['A', 'C']);
    expect(available(p)).toEqual(expect.arrayContaining(['release', 'skier']));
  });

  it('pays out, ranks up, and buying needs funds, rank and the right building', () => {
    const p = newProfile();
    for (const id of ['rounds', 'survey', 'release']) complete(p, id);
    expect(p.rep).toBeGreaterThanOrEqual(520);
    expect(blockReason(p, item('sled-yellow'))).toMatch(/workshop/);
    expect(build(p, 'workshop')).toBe(true);
    expect(buy(p, 'sled-yellow')).toBe(true);
    expect(p.equip.sledPaint).toBe('sled-yellow');
    p.funds = 0;
    expect(buy(p, 'jacket-orange')).toBe(false);
  });

  it('badges pay once', () => {
    const p = newProfile();
    const f = p.funds;
    expect(findBadge(p, 'b-lake')).toBe(true);
    expect(findBadge(p, 'b-lake')).toBe(false);
    expect(p.funds).toBeGreaterThan(f);
  });

  it('saves and continues mid-mission, and survives a damaged save', () => {
    const store = mem();
    const p = newProfile();
    complete(p, 'rounds');
    p.active = newRun('survey');
    p.active.step = 2;
    p.player = { x: 10, z: 20, yaw: 1, mode: 'heli' };
    saveProfile(store, p);
    const q = loadProfile(store)!;
    expect(q.active!.id).toBe('survey');
    expect(q.active!.step).toBe(2);
    expect(q.player.mode).toBe('heli');
    store.setItem(SAVE_KEY, '{not json');
    expect(loadProfile(store)).toBeNull();
    const m = migrate({ funds: 5, equip: { jacket: 'nope' }, upgrades: ['hangar', 'castle'], active: { id: 'gone', step: 0 } });
    expect(m.equip.jacket).toBe('jacket-red');
    expect(m.upgrades).toEqual(['hangar']);
    expect(m.active).toBeNull();
    expect(m.owned).toContain('sled-red');
  });

  it('world events come in now and then, never piling up', () => {
    const p = newProfile();
    let n = 0;
    const roll = () => 0.3;
    for (let i = 0; i < 2000; i++) if (tickEvents(p, 1, false, roll)) n++;
    expect(n).toBe(0); // not before the first rounds
    complete(p, 'rounds');
    for (let i = 0; i < 2000; i++) if (tickEvents(p, 1, false, roll)) n++;
    expect(n).toBe(1);
    expect(p.events.length).toBe(1);
  });

  it('every item names a slot the default kit fills', () => {
    for (const i of ITEMS) expect(newProfile().equip[i.slot]).toBeTruthy();
  });
});
