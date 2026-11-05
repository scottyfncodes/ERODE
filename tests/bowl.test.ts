import { describe, expect, it } from 'vitest';
import { getTerrain } from '../src/world/terrain';
import { simulateRelease, Snowpack } from '../src/missions/avalanche';
import { bowlContacts, isControl, mission, MISSIONS, slopeList, WIND_LOADS } from '../src/missions/catalog';
import { currentStep, fire, fireState, interact, interactables, navTarget, newRun, stepContacts, tickRun, type Snapshot } from '../src/missions/runner';
import {
  available,
  bowlPending,
  checkBowl,
  complete,
  CONTROL_PAY,
  gradeControl,
  loadProfile,
  migrate,
  newProfile,
  nextGoal,
  RELOAD_CM,
  saveProfile,
  SAVE_KEY,
  tickEvents,
  windLoad,
  type Profile,
} from '../src/progress/profile';
import { RANKS } from '../src/progress/catalog';
import { nextDay, overnightSnow } from '../src/world/weather';

// Kessel Bowl after the story: it loads up again with new snow, the wind decides which slopes,
// and the avalanche service calls in a recon flight and a control job you can read for yourself.

const t = getTerrain();
const snap = (o: Partial<Snapshot>): Snapshot => ({ x: 0, z: 0, vehicle: 'foot', heliLanded: true, heliAgl: 0, heliYaw: 0, avalancheDone: false, ...o });

/** A save that has played the story through the release. */
function afterStory(): Profile {
  const p = newProfile();
  for (const id of ['rounds', 'survey', 'release']) complete(p, id);
  return p;
}

describe('the bowl reloads', () => {
  it('overnight snow lands on the bowl: heavy after a snowy evening, none on the first night', () => {
    expect(overnightSnow(1)).toBe(0);
    const days = Array.from({ length: 60 }, (_, i) => overnightSnow(i + 2));
    expect(Math.max(...days)).toBeGreaterThanOrEqual(RELOAD_CM);
    expect(Math.min(...days)).toBeGreaterThanOrEqual(0);
    // deterministic per day
    expect(overnightSnow(9)).toBe(overnightSnow(9));
  });

  it('reloads on some mornings and not others (about a third of them after a control)', () => {
    let reloads = 0;
    for (let d = 2; d <= 61; d++) if (8 * 0.85 + overnightSnow(d) >= RELOAD_CM) reloads++;
    expect(reloads).toBeGreaterThan(8);
    expect(reloads).toBeLessThan(40);
  });

  it('nextDay adds the night snow on top of the settled pack and clears the control', () => {
    const w = { day: 3, minute: 20 * 60, freshSnow: 10, controlled: true };
    nextDay(w);
    expect(w.day).toBe(4);
    expect(w.controlled).toBe(false);
    expect(w.freshSnow).toBeCloseTo(8.5 + overnightSnow(4), 5);
  });

  it('does nothing before the story release, or while the bowl is controlled or light', () => {
    const p = newProfile();
    p.weather.freshSnow = 60;
    expect(checkBowl(p)).toBe(false);
    const q = afterStory();
    expect(q.weather.controlled).toBe(true);
    q.weather.freshSnow = 60;
    expect(checkBowl(q)).toBe(false);
    q.weather.controlled = false;
    q.weather.freshSnow = RELOAD_CM - 1;
    expect(checkBowl(q)).toBe(false);
  });

  it('posts the recon flight and the control job once, with the day’s wind loading the slopes', () => {
    const p = afterStory();
    p.weather.controlled = false;
    p.weather.freshSnow = 40;
    p.weather.day = 5;
    expect(checkBowl(p)).toBe(true);
    expect(p.events).toEqual(['bowl-recon', 'bowl-control']);
    expect(p.loaded).toEqual(windLoad(5).loaded);
    expect(p.loadWind).toBe(windLoad(5).wind);
    expect(p.marked).toEqual([]);
    expect(bowlPending(p)).toBe(true);
    // not twice
    expect(checkBowl(p)).toBe(false);
    expect(available(p)).toEqual(expect.arrayContaining(['bowl-recon', 'bowl-control']));
  });

  it('every wind pattern is a real choice: one to three slopes, from A to D', () => {
    for (const w of WIND_LOADS) {
      expect(w.loaded.length).toBeGreaterThanOrEqual(1);
      expect(w.loaded.length).toBeLessThanOrEqual(3);
      for (const s of w.loaded) expect(['A', 'B', 'C', 'D']).toContain(s);
    }
    // over a month of reloads the loaded slopes are not always A and C
    const seen = new Set(Array.from({ length: 30 }, (_, i) => windLoad(i + 2).loaded.join('')));
    expect(seen.size).toBeGreaterThan(4);
  });

  it('the radio callouts never pick bowl work, and bowl work does not hold up a callout', () => {
    const p = afterStory();
    p.weather.controlled = false;
    p.weather.freshSnow = 40;
    checkBowl(p);
    p.eventClock = 0;
    for (let i = 0; i < 20; i++) {
      const id = tickEvents(p, 1, false, () => (i % 10) / 10);
      if (id) {
        expect(mission(id).bowl).toBeFalsy();
        break;
      }
    }
    expect(p.events.some((e) => !mission(e).bowl)).toBe(true);
  });
});

describe('the snowpack follows the day’s loading', () => {
  it('releases the slopes the wind loaded, whichever they are, and the berm holds', () => {
    for (const w of WIND_LOADS) {
      const s = simulateRelease(t, w.loaded, 120, w.loaded);
      expect(s.done, w.wind).toBe(true);
      expect(s.result.weakReleased / s.result.weakTotal, w.wind).toBeGreaterThan(0.6);
      expect(s.result.roadHit, w.wind).toBe(false);
    }
  });

  it('a wrong read brings none of the loaded snow down', () => {
    const s = simulateRelease(t, ['A', 'C'], 120, ['B', 'D']);
    expect(s.result.weakReleased).toBe(0);
  });

  it('the story bowl is unchanged: A and C loaded by default', () => {
    const s = new Snowpack(t);
    expect(s.isLoaded('A') && s.isLoaded('C')).toBe(true);
    expect(s.isLoaded('B') || s.isLoaded('D')).toBe(false);
    s.reset(['B']);
    expect(s.isLoaded('B')).toBe(true);
    expect(s.isLoaded('A')).toBe(false);
  });
});

describe('the recon flight reads today’s bowl', () => {
  it('the scan finds the loaded slopes of this run, not the story’s', () => {
    const r = newRun('bowl-recon', ['B', 'D']);
    const s = mission('bowl-recon').steps[2];
    if (s.kind !== 'scan') throw new Error('scan step');
    const c = stepContacts(r, s);
    expect(c.filter((k) => k.target).map((k) => k.label)).toEqual(['SLOPE B', 'SLOPE D']);
    expect(bowlContacts(['A']).filter((k) => k.target)).toHaveLength(1);
    // the story's survey keeps A and C
    const story = mission('survey').steps[2];
    if (story.kind !== 'scan') throw new Error('scan step');
    expect(stepContacts(newRun('survey'), story).filter((k) => k.target).map((k) => k.label)).toEqual(['SLOPE A', 'SLOPE C']);
  });

  it('flies end to end and flags the loaded slopes for the control team', () => {
    const p = afterStory();
    p.weather.controlled = false;
    p.weather.freshSnow = 40;
    p.weather.day = 5;
    checkBowl(p);
    const r = newRun('bowl-recon', p.loaded);
    tickRun(r, snap({ vehicle: 'heli' }), 0.1);
    tickRun(r, snap({ vehicle: 'heli', x: -120, z: -330, heliLanded: false, heliAgl: 60 }), 0.1);
    expect(currentStep(r)?.kind).toBe('scan');
    const s = currentStep(r);
    if (s?.kind !== 'scan') throw new Error('scan step');
    for (const c of stepContacts(r, s)) {
      // hover over each slope until it is read
      for (let i = 0; i < 20; i++) tickRun(r, snap({ vehicle: 'heli', x: c.x, z: c.z, heliLanded: false, heliAgl: 60 }), 0.1);
    }
    expect(currentStep(r)?.kind).toBe('land');
    p.active = r;
    complete(p, 'bowl-recon');
    expect(p.marked).toEqual(p.loaded);
    expect(p.events).toEqual(['bowl-control']);
  });
});

describe('the control job: your read, your charges', () => {
  function toCharges(loaded: string[]) {
    const r = newRun('bowl-control', loaded);
    interact(r, 'locker');
    interact(r, 'gate-close');
    tickRun(r, snap({ x: -150, z: -500 }), 0.1);
    const ridge = mission('bowl-control').steps[2];
    if (ridge.kind !== 'goto') throw new Error('goto');
    tickRun(r, snap({ x: ridge.at.x, z: ridge.at.z }), 0.1);
    return r;
  }

  it('offers all four slopes and does not point the way to the loaded ones', () => {
    const r = toCharges(['B']);
    expect(currentStep(r)?.kind).toBe('charges');
    expect(interactables(r).map((i) => i.id)).toEqual(['charge-A', 'charge-B', 'charge-C', 'charge-D']);
    expect(navTarget(r, { x: -125, z: -425 })).toBeNull();
    expect(fireState(r, 0, 300)).toBe('none');
  });

  it('you choose how many to charge, then fire from safe ground', () => {
    const r = toCharges(['A', 'C']);
    interact(r, 'charge-A');
    expect(currentStep(r)?.kind).toBe('charges');
    // still on the slope: too close
    expect(fireState(r, -175, -405)).toBe('too-close');
    // once one is set, the arrow points to safe ground
    expect(navTarget(r, { x: -175, z: -405 })).not.toBeNull();
    interact(r, 'charge-C');
    expect(currentStep(r)?.kind).toBe('charges');
    const safe = { x: -150, z: -520 };
    expect(fireState(r, safe.x, safe.z)).toBe('ready');
    const ev2 = fire(r);
    const f = ev2.find((e) => e.type === 'fire');
    expect(f && f.type === 'fire' && f.charges).toEqual(['A', 'C']);
    expect(currentStep(r)?.kind).toBe('watch');
    expect(r.fired).toBe(true);
  });

  it('pays by the result: a clean read earns most, a wrong one least, a wasted charge costs', () => {
    const clean = gradeControl({ charged: ['A', 'C'], loaded: ['A', 'C'], share: 0.95 });
    const extra = gradeControl({ charged: ['A', 'B', 'C'], loaded: ['A', 'C'], share: 0.95 });
    const partial = gradeControl({ charged: ['A'], loaded: ['A', 'C'], share: 0.54 });
    const wrong = gradeControl({ charged: ['B', 'D'], loaded: ['A', 'C'], share: 0 });
    expect(clean.clean).toBe(true);
    expect(extra.clean).toBe(false);
    expect(extra.wasted).toBe(1);
    expect(partial.missed).toBe(1);
    expect(clean.funds).toBeGreaterThan(extra.funds);
    expect(extra.funds).toBeGreaterThan(partial.funds);
    expect(partial.funds).toBeGreaterThan(wrong.funds);
    expect(wrong.funds).toBe(CONTROL_PAY.funds - 2 * CONTROL_PAY.wasted);
    // the listed reward is the most it can pay
    const best = gradeControl({ charged: ['A'], loaded: ['A'], share: 1 });
    expect(best.funds).toBeLessThanOrEqual(mission('bowl-control').reward.funds);
    expect(best.rep).toBeLessThanOrEqual(mission('bowl-control').reward.rep);
    expect(gradeControl({ charged: ['A', 'B', 'C', 'D'], loaded: ['A'], share: 0 }).funds).toBeGreaterThanOrEqual(0);
  });

  it('completing it controls the bowl, clears both calls, and counts in the patrol log', () => {
    const p = afterStory();
    p.weather.controlled = false;
    p.weather.freshSnow = 40;
    checkBowl(p);
    const loaded = [...p.loaded];
    const before = { funds: p.funds, rep: p.rep };
    p.active = newRun('bowl-control', loaded);
    const res = complete(p, 'bowl-control', { charged: loaded, loaded, share: 0.9 });
    expect(res.grade?.clean).toBe(true);
    expect(p.funds - before.funds).toBe(res.funds);
    expect(p.rep - before.rep).toBe(res.rep);
    expect(p.weather.controlled).toBe(true);
    expect(p.weather.freshSnow).toBeLessThanOrEqual(8);
    expect(p.events).toEqual([]);
    expect(p.loaded).toEqual([]);
    expect(p.marked).toEqual([]);
    expect(p.bowlDays).toBe(1);
    expect(p.cleanReads).toBe(1);
    expect(p.active).toBeNull();
    // and it can come round again
    nextDay(p.weather);
    p.weather.freshSnow = 40;
    expect(checkBowl(p)).toBe(true);
  });

  it('the story missions pay exactly what they did', () => {
    const p = newProfile();
    for (const m of MISSIONS.filter((k) => !k.dynamic)) {
      const before = p.funds;
      const r = complete(p, m.id);
      expect(r.funds).toBe(m.reward.funds);
      expect(p.funds - before).toBe(m.reward.funds);
      expect(r.grade).toBeUndefined();
    }
    expect(isControl('release') && isControl('bowl-control') && !isControl('survey')).toBe(true);
  });
});

describe('saves and the next goal', () => {
  it('an older save without the bowl fields loads with them empty, and Continue still works', () => {
    const old = afterStory() as unknown as Record<string, unknown>;
    delete old.loaded;
    delete old.loadWind;
    delete old.bowlDays;
    delete old.cleanReads;
    const p = migrate(JSON.parse(JSON.stringify(old)));
    expect(p.loaded).toEqual([]);
    expect(p.loadWind).toBe('');
    expect(p.bowlDays).toBe(0);
    expect(p.cleanReads).toBe(0);
    expect(p.completed.release).toBe(1);
  });

  it('a bowl job in progress survives a save and reload with its loaded slopes', () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    const p = afterStory();
    p.weather.controlled = false;
    p.weather.freshSnow = 40;
    checkBowl(p);
    p.active = newRun('bowl-control', p.loaded);
    interact(p.active, 'locker');
    p.active.charges = [p.loaded[0]];
    saveProfile(store, p);
    expect(mem.has(SAVE_KEY)).toBe(true);
    const q = loadProfile(store)!;
    expect(q.active?.id).toBe('bowl-control');
    expect(q.active?.loaded).toEqual(p.loaded);
    expect(q.active?.step).toBe(1);
    expect(q.loaded).toEqual(p.loaded);
  });

  it('a damaged save drops bowl work it cannot back up', () => {
    const p = afterStory() as unknown as Record<string, unknown>;
    p.events = ['bowl-recon', 'bowl-control', 'tree'];
    p.loaded = ['Z', 7];
    p.active = { ...newRun('bowl-control'), loaded: undefined };
    const q = migrate(JSON.parse(JSON.stringify(p)));
    expect(q.loaded).toEqual([]);
    expect(q.events).toEqual(['tree']);
    expect(q.active).toBeNull();
  });

  it('the next rank is always in sight, and the top rank says so', () => {
    const p = newProfile();
    let g = nextGoal(p);
    expect(g.next).toBe(RANKS[1].name);
    expect(g.need).toBe(RANKS[1].rep);
    expect(g.progress).toBe(0);
    p.rep = RANKS[1].rep + 10;
    g = nextGoal(p);
    expect(g.rank).toBe(RANKS[1].name);
    expect(g.next).toBe(RANKS[2].name);
    expect(g.need).toBe(RANKS[2].rep - p.rep);
    p.rep = RANKS[4].rep + 1;
    g = nextGoal(p);
    expect(g.next).toBeNull();
    expect(g.progress).toBe(1);
  });

  it('names slopes the way the radio does', () => {
    expect(slopeList(['C', 'A'])).toBe('Slopes A and C');
    expect(slopeList(['B'])).toBe('Slope B');
    expect(slopeList(['A', 'C', 'D'])).toBe('Slopes A, C and D');
    expect(slopeList([])).toBe('no slopes');
  });
});
