// End-to-end playthrough of every mission in a real browser, on the production build, with an
// evidence report (JSON + Markdown) of what was checked and what happened.
//
//   npx vite build && npx vite preview --port 4173 &
//   npx tsx scripts/playthrough.ts http://localhost:4173/ docs/playcraft/evidence
//
// What is real and what is a shortcut (both are written into the report):
//   * Every mission action is done with real key input (E taps and holds, R/C on the helicopter, X to
//     get off, W/S on the sled, Esc for the pause menu) and every menu with real clicks: the mission
//     table, the debrief, the station builder, the workbench, the title screen. The game's own rules
//     decide when a step is done; this script only reads `window.game` (read-only) to see it.
//   * Long journeys are skipped with the QA handle `window.patrol` (teleport / sledTo / heliTo /
//     dogTo), so a 2 km ride does not take an hour in a software-rendered browser. Each skip is
//     counted. The helicopter is always in the air (or on the pad) when it is moved; Koda is brought
//     along when the player is moved far.
//   * The radio callout timer (200-360 s of play) is wound down through the save; the game's own
//     timer then fires the call and it is answered with the real Respond button.
// Exit code 1 if any check fails.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { BOWL_CONTACTS, mission, MISSIONS } from '../src/missions/catalog';
import { BADGES, RANKS } from '../src/progress/catalog';
import { CONTROL_PAY } from '../src/progress/profile';
import { CHARGE_SPOTS, pad } from '../src/world/places';
import { SPOTS } from '../src/world/station';
import { getTerrain } from '../src/world/terrain';
import type { GameSnapshot } from '../src/game/snapshot';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const url = process.argv[2] ?? 'http://localhost:4173/';
const outDir = process.argv[3] ?? 'docs/playcraft/evidence';
mkdirSync(join(outDir, 'shots'), { recursive: true });
const terrain = getTerrain();
const H = (x: number, z: number) => terrain.height(x, z);

type Cat = 'core_gameplay' | 'game_feel' | 'controls' | 'progression' | 'difficulty' | 'player_experience' | 'replayability' | 'technical' | 'presentation' | 'mobile';
interface Check {
  cat: Cat;
  group: string;
  what: string;
  ok: boolean;
  detail: string;
}
const checks: Check[] = [];
const log: string[] = [];
const counts = { realInputs: 0, holds: 0, clicks: 0, travelShortcuts: 0, timerShortcuts: 0, snowShortcuts: 0 };
const say = (s: string) => {
  const line = `[${((Date.now() - T0) / 1000).toFixed(0).padStart(4)}s] ${s}`;
  log.push(line);
  console.log(line);
};
const check = (cat: Cat, group: string, what: string, ok: boolean, detail: unknown = '') => {
  checks.push({ cat, group, what, ok, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) });
  say(`${ok ? 'PASS' : 'FAIL'} ${group}: ${what}${detail ? ` (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`);
  return ok;
};

const T0 = Date.now();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const pageErrors: string[] = [];
page.on('pageerror', (e: Error) => pageErrors.push(e.message));
page.on('console', (m: { type(): string; text(): string }) => {
  if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`);
});
// count vibration requests (the API is a no-op in headless Chromium, so it is observed, not felt)
await page.addInitScript(() => {
  (window as unknown as { __buzz: unknown[] }).__buzz = [];
  navigator.vibrate = (p: VibratePattern) => {
    (window as unknown as { __buzz: unknown[] }).__buzz.push(p);
    return true;
  };
});

const G = (): Promise<GameSnapshot> => page.evaluate(() => (window as unknown as { game: GameSnapshot }).game);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const P = (f: (p: any, a: any) => unknown, a?: unknown) => page.evaluate(([src, arg]: [string, unknown]) => new Function('p', 'a', `return (${src})(p, a)`)((window as unknown as { patrol: unknown }).patrol, arg), [f.toString(), a] as [string, unknown]);
const sleep = (ms: number) => page.waitForTimeout(ms);
async function until<T>(f: () => Promise<T>, ok: (v: T) => boolean, ms: number, every = 250): Promise<{ ok: boolean; v: T }> {
  const end = Date.now() + ms;
  let v = await f();
  while (!ok(v) && Date.now() < end) {
    await sleep(every);
    v = await f();
  }
  return { ok: ok(v), v };
}
const shot = async (name: string) => {
  await page.screenshot({ path: join(outDir, 'shots', `${name}.jpg`), type: 'jpeg', quality: 62 });
};

// ---- moving about (shortcuts, counted)
async function travel(x: number, z: number, yaw = 0, bringKoda = true) {
  counts.travelShortcuts++;
  await P((p, a) => p.teleport(a.x, a.z, a.yaw), { x, z, yaw });
  if (bringKoda) await P((p, a) => p.dogTo(a.x, a.z), { x: x + 1.6, z: z + 1.2 });
  await sleep(500);
}
async function flyTo(x: number, z: number, agl: number, yaw?: number) {
  counts.travelShortcuts++;
  await P((p, a) => p.heliTo(a.x, a.z, a.y), { x, z, y: H(x, z) + agl });
  if (yaw !== undefined) await P((p, a) => p.teleport(a.x, a.z, a.yaw), { x, z, yaw });
  await sleep(400);
}

// ---- real input
async function tap(code: string, ms = 260) {
  counts.realInputs++;
  await page.keyboard.down(code);
  await sleep(ms);
  await page.keyboard.up(code);
  await sleep(250);
}
async function waitAction(label: string | RegExp, ms = 20000) {
  const m = (s: GameSnapshot) => !!s.action && (typeof label === 'string' ? s.action.label === label : label.test(s.action.label));
  return until(G, m, ms);
}
/** Do what the action button offers (tap or hold E), as a player would. */
async function act(label: string | RegExp, group: string, holdSeconds = 0): Promise<boolean> {
  const w = await waitAction(label);
  if (!w.ok) return check('controls', group, `action button offers "${label}"`, false, `button shows ${JSON.stringify(w.v.action)} at ${JSON.stringify(w.v.position)}`);
  const before = w.v;
  if (!w.v.action!.enabled) return check('controls', group, `"${label}" is enabled`, false, w.v.action);
  counts.realInputs++;
  if (holdSeconds > 0) counts.holds++;
  await page.keyboard.down('KeyE');
  // a hold fills the ring over `hold` seconds of wall clock; let go when the job is done
  const done = await until(
    G,
    (s) => s.mission?.step !== before.mission?.step || s.mission?.id !== before.mission?.id || s.panel || s.mode !== before.mode || !s.action || s.action.label !== before.action!.label,
    holdSeconds * 1000 + 15000,
    120,
  );
  await page.keyboard.up('KeyE');
  await sleep(300);
  return done.ok;
}
async function click(sel: string, group: string, what: string) {
  const el = page.locator(sel).first();
  try {
    await el.waitFor({ state: 'visible', timeout: 15000 });
    await el.click({ timeout: 15000 });
    counts.clicks++;
    await sleep(500);
    return true;
  } catch (e) {
    return check('controls', group, what, false, String(e).slice(0, 160));
  }
}

// ---- mission helpers
async function takeFromTable(id: string) {
  const group = mission(id).title;
  await travel(SPOTS.table.x + 1.4, SPOTS.table.z + 0.4, Math.PI / 2, false);
  await act('Mission table', group);
  const open = await until(G, (s) => s.panel, 8000);
  check('player_experience', group, 'the mission table opens from the lodge table', open.ok);
  await click(`[data-m="${id}"]`, group, 'pick the call on the table');
  await click('[data-go]', group, 'take the call');
  const s = await until(G, (g) => g.mission?.id === id && !g.panel, 8000);
  check('core_gameplay', group, 'call taken from the mission table', s.ok, s.v.mission);
  return s.ok;
}
/** every step's objective as the HUD showed it, against the game's own step text */
const objectives: { mission: string; step: number; game: string; hud: string }[] = [];
async function stepIs(id: string, step: number, ms = 20000) {
  const r = await until(G, (s) => s.mission?.id === id && s.mission.step === step, ms);
  if (r.ok) {
    await sleep(400);
    const hud = ((await page.locator('.task .obj').first().textContent().catch(() => '')) ?? '').trim();
    objectives.push({ mission: id, step, game: r.v.mission!.objective, hud });
  }
  return r;
}
const missionLog: Record<string, { funds: number; rep: number; ok: boolean; seconds: number; extra?: string; rankBefore: string; rankAfter: string }> = {};
async function finish(id: string, before: GameSnapshot, t0: number) {
  const def = mission(id);
  const d = await until(G, (s) => s.panel && !s.mission, 20000);
  const debrief = await page.locator('.debrief').first().textContent({ timeout: 5000 }).catch(() => '');
  const after = await G();
  const df = after.funds - before.funds;
  const dr = after.reputation - before.reputation;
  check('core_gameplay', def.title, 'mission completes and the debrief opens', d.ok && !!debrief, debrief?.slice(0, 120));
  if (def.graded) {
    // graded work pays by the result: never more than the listed reward, and a clean read earns the bonus
    const clean = /clean read/i.test(debrief ?? '');
    check('progression', def.title, `pays by the result, up to the listed ${def.reward.funds} funds (a clean read: base, share and bonus)`, df > 0 && df <= def.reward.funds && dr <= def.reward.rep && (!clean || df >= CONTROL_PAY.funds + CONTROL_PAY.clean.funds), { funds: df, reputation: dr, clean });
  } else check('progression', def.title, `pays the advertised reward (+${def.reward.funds} funds, +${def.reward.rep} reputation)`, df === def.reward.funds && dr === def.reward.rep, { funds: df, reputation: dr });
  missionLog[id] = { funds: df, rep: dr, ok: d.ok, seconds: Math.round((Date.now() - t0) / 1000), rankBefore: before.rank.name, rankAfter: after.rank.name, extra: debrief ?? '' };
  await shot(`debrief-${id}`);
  await click('.debrief [data-a=ok]', def.title, 'close the debrief');
  await until(G, (s) => !s.panel, 5000);
}
async function followKoda(id: string, group: string, target: { x: number; z: number }, trail: { x: number; z: number }[]) {
  // the player keeps a few metres behind Koda (as on a phone: Koda leads, waits and looks back)
  const path: { x: number; z: number }[] = [];
  const end = Date.now() + 600000;
  let s = await G();
  const startStep = s.mission!.step;
  while (Date.now() < end) {
    s = await G();
    if (s.mission?.id !== id || s.mission.step !== startStep) break;
    const dog = (await P((p) => p.info().dog)) as { x: number; z: number; mode: string };
    path.push({ x: dog.x, z: dog.z });
    const dx = dog.x - s.position.x;
    const dz = dog.z - s.position.z;
    const d = Math.hypot(dx, dz);
    // Koda has stopped by the subject and is waiting: walk up to what Koda found
    const n = path.length;
    const still = n > 4 && Math.hypot(path[n - 1].x - path[n - 4].x, path[n - 1].z - path[n - 4].z) < 0.5;
    if (still && Math.hypot(dog.x - target.x, dog.z - target.z) < 12) {
      counts.travelShortcuts++;
      await P((p, a) => p.teleport(a.x, a.z, 0), { x: target.x + (dog.x - target.x) * 0.3, z: target.z + (dog.z - target.z) * 0.3 });
    } else if (d > 6) {
      counts.travelShortcuts++;
      await P((p, a) => p.teleport(a.x, a.z, a.yaw), { x: dog.x - (dx / d) * 4, z: dog.z - (dz / d) * 4, yaw: Math.atan2(-dx, -dz) });
    }
    await sleep(900);
  }
  s = await G();
  const led = s.mission?.id !== id || s.mission.step !== startStep;
  // how close did Koda's own route stay to the real trail?
  // how far off the trail Koda strays once on it (the run over from your side to the trail does not count)
  // distance to the trail as a line (its segments), not to its points
  const toTrail = (q: { x: number; z: number }) => {
    let best = Infinity;
    for (let i = 0; i < trail.length - 1; i++) {
      const a = trail[i];
      const b = trail[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const u = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
      best = Math.min(best, Math.hypot(a.x + dx * u - q.x, a.z + dz * u - q.z));
    }
    return best;
  };
  const offAll = path.map(toTrail);
  const joined = offAll.findIndex((d) => d < 4);
  const off = joined >= 0 ? offAll.slice(joined) : offAll;
  const last = path[path.length - 1];
  check('core_gameplay', group, 'Koda takes the scent and leads to the subject', led, { kodaSamples: path.length, endsFrom: last ? Math.round(Math.hypot(last.x - target.x, last.z - target.z)) : null });
  check('game_feel', group, "Koda's route follows the scent trail once on it (within 12 m)", joined >= 0 && Math.max(...off) < 12, {
    worstOffTrailM: off.length ? +Math.max(...off).toFixed(1) : null,
    worstIncludingTheRunToTheTrailM: offAll.length ? +Math.max(...offAll).toFixed(1) : null,
  });
}

// ================================================================== boot
say(`playthrough of ${url}`);
await page.goto(url);
await page.waitForFunction(() => (window as unknown as { patrol?: unknown }).patrol, null, { timeout: 180000 });
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => (window as unknown as { patrol?: unknown }).patrol, null, { timeout: 180000 });
await shot('title');
check('player_experience', 'Title', 'title screen offers a fresh start', await page.locator('[data-a=new]').isVisible());
await click('[data-a=new]', 'Title', 'start a new patrol');
const s0 = await until(G, (s) => s.state === 'play', 15000);
check('core_gameplay', 'Title', 'Start your patrol begins play in the lodge', s0.ok, { mode: s0.v.mode, funds: s0.v.funds });
// Light graphics through the real pause menu (it is a software renderer here)
await tap('Escape');
await click('.seg[data-k=quality] [data-v=low]', 'Settings', 'choose Light graphics');
await click('[data-a=back]', 'Settings', 'back to patrol');
check('controls', 'Settings', 'pause menu opens with Esc and closes with Back to patrol', !(await G()).panel);
const radio = await until(() => page.locator('.radio').first().textContent().catch(() => ''), (t) => !!t && /mission table/i.test(t), 15000);
check('player_experience', 'Title', 'the first radio call says where to start (the mission table)', radio.ok, (radio.v ?? '').slice(0, 90));

// ================================================================== Morning Rounds
{
  const id = 'rounds';
  const T = mission(id).title;
  const t0 = Date.now();
  await takeFromTable(id);
  const before = await G();
  // pet Koda: Koda is at the door; walk over (a short teleport inside the lodge)
  const dog = (await P((p) => p.info().dog)) as { x: number; z: number };
  await travel(dog.x - 1.2, dog.z, -Math.PI / 2, false);
  await act('Pet Koda', T);
  check('core_gameplay', T, 'step 1: pet Koda', (await stepIs(id, 1)).ok);
  await travel(SPOTS.sled.x - 2, SPOTS.sled.z, Math.PI / 2, false);
  await act('Ride the sled', T);
  const st2 = await stepIs(id, 2);
  check('core_gameplay', T, 'step 2: get on the sled in the garage', st2.ok && st2.v.mode === 'sled');
  // the sled moves under real throttle before the long ride is skipped
  const sx = st2.v.position;
  await page.keyboard.down('KeyW');
  const moved = await until(G, (s) => Math.hypot(s.position.x - sx.x, s.position.z - sx.z) > 3, 25000);
  await page.keyboard.up('KeyW');
  counts.realInputs++;
  check('controls', T, 'the sled drives under real throttle (W)', moved.ok, { speedKmh: moved.v.speedKmh, movedM: +Math.hypot(moved.v.position.x - sx.x, moved.v.position.z - sx.z).toFixed(1) });
  const wx = pad('station');
  await travel(wx.x + 8, wx.z + 8, 0);
  check('core_gameplay', T, 'step 3: ride up the pass road to the weather station', (await stepIs(id, 3)).ok);
  await tap('KeyX');
  check('controls', T, 'X gets off the sled', (await until(G, (s) => s.mode === 'foot', 5000)).ok);
  await travel(-646 + 1.5, -296 + 1.5, 0);
  await shot('rounds-repair');
  await act('Repair', T, 3);
  check('core_gameplay', T, 'step 4: hold Repair for 3 s to restart the weather station', (await stepIs(id, 4)).ok);
  await travel(0, 250, 0);
  await finish(id, before, t0);
}

// ================================================================== Eyes on Kessel Bowl
{
  const id = 'survey';
  const T = mission(id).title;
  const t0 = Date.now();
  await takeFromTable(id);
  const before = await G();
  await travel(SPOTS.heli.x + 3.2, SPOTS.heli.z + 1, Math.PI / 2, false);
  await act('Fly', T);
  check('core_gameplay', T, 'step 1: start the helicopter on the pad', (await stepIs(id, 1)).ok);
  // lift off with the real lever (R) once the rotor is up to speed
  await page.keyboard.down('KeyR');
  const up = await until(G, (s) => !s.heli.landed && s.heli.altitudeAboveGround > 4, 120000);
  await page.keyboard.up('KeyR');
  counts.realInputs++;
  check('controls', T, 'R lifts the helicopter off once the rotor is up to speed', up.ok, { agl: up.v.heli.altitudeAboveGround, rotor: up.v.heli.rotor });
  await flyTo(-120, -260, 70, 0);
  check('core_gameplay', T, 'step 2: fly to Kessel Bowl', (await stepIs(id, 2)).ok);
  // nose on each slope, 70 m out, 50 m up: the scanner reads it
  const results: Record<string, string> = {};
  for (const [i, c] of BOWL_CONTACTS.entries()) {
    await flyTo(c.x, c.z + 70, Math.max(30, H(c.x, c.z) - H(c.x, c.z + 70) + 50), 0);
    const r = await until(
      () => P((p) => p.state().active?.scan) as Promise<{ identified: boolean[] } | null>,
      (sc) => !!sc && sc.identified[i],
      120000,
      400,
    );
    results[c.label] = r.ok ? (c.target ? 'loaded' : 'stable') : 'not read';
    if (i === 0) await shot('survey-scan');
  }
  check('core_gameplay', T, 'step 3: the scanner reads all four slopes (A and C loaded, B and D stable)', Object.values(results).every((v) => v !== 'not read'), results);
  await stepIs(id, 3, 10000);
  // home and land with the real lever (C)
  await flyTo(SPOTS.heli.x, SPOTS.heli.z, 12, Math.PI / 2);
  await page.keyboard.down('KeyC');
  const down = await until(G, (s) => s.heli.landed || !s.mission, 120000);
  await page.keyboard.up('KeyC');
  counts.realInputs++;
  check('controls', T, 'C settles the helicopter onto the pad', down.ok, { landed: down.v.heli.landed });
  await finish(id, before, t0);
  // X (the Shut down chip) on the pad: engines off and out you get
  await tap('KeyX');
  const out = await until(G, (s) => s.mode === 'foot', 10000);
  check('controls', T, 'X shuts the helicopter down on the pad and you climb out', out.ok, { mode: out.v.mode });
}

// ================================================================== Controlled Release (+ hit-stop and the buzz)
{
  const id = 'release';
  const T = mission(id).title;
  const t0 = Date.now();
  await takeFromTable(id);
  const before = await G();
  await travel(SPOTS.locker.x - 1.2, SPOTS.locker.z, Math.PI / 2, false);
  await act('Take charges', T, 1);
  check('core_gameplay', T, 'step 1: take the charges from the locker', (await stepIs(id, 1)).ok);
  await travel(-150 + 1, -40 + 1, 0);
  await act('Close road', T, 1.2);
  check('core_gameplay', T, 'step 2: close the pass road at the barrier', (await stepIs(id, 2)).ok);
  const ridge = pad('ridge');
  await travel(ridge.x, ridge.z, 0);
  check('core_gameplay', T, 'step 3: climb to Kessel Ridge', (await stepIs(id, 3)).ok);
  for (const sid of ['A', 'C']) {
    const c = CHARGE_SPOTS.find((k) => k.id === sid)!;
    await travel(c.x + 1, c.z + 1, 0);
    await act(new RegExp(`^Set charge`), T, 2.2);
  }
  check('core_gameplay', T, 'step 4: set a charge on each loaded slope (A and C)', (await stepIs(id, 4)).ok);
  // the rule: you cannot fire standing on the slab
  const slab = CHARGE_SPOTS.find((k) => k.id === 'C')!;
  await travel(slab.x, slab.z + 6, 0);
  const close = await waitAction('Too close to fire', 8000);
  check('difficulty', T, 'firing is refused while standing on the slope ("Too close to fire", disabled)', close.ok && close.v.action?.enabled === false, close.v.action);
  await travel(ridge.x, ridge.z, Math.PI);
  await shot('release-ready');
  // fire, and watch the clock: the hit-stop slows the world for a beat
  const fireReady = await waitAction('Fire charges');
  const runT = (await P((p) => p.state().active.time)) as number;
  counts.realInputs++;
  counts.holds++;
  await page.keyboard.down('KeyE');
  const fired = await until(G, (s) => s.avalanche.fired, 20000, 50);
  await page.keyboard.up('KeyE');
  const samples: number[] = [];
  let prev = (await P((p) => p.state().active?.time ?? 0)) as number;
  for (let k = 0; k < 8; k++) {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(0))));
    const t = (await P((p) => p.state().active?.time ?? 0)) as number;
    samples.push(+(t - prev).toFixed(4));
    prev = t;
  }
  check('core_gameplay', T, 'step 5: fire the charges from safe ground (hold Fire charges)', fireReady.ok && fired.ok, { fromRunTime: +runT.toFixed(1) });
  check('game_feel', T, 'hit-stop: the world clock nearly stops on the blast, then recovers', samples.length > 3 && Math.min(...samples) < 0.012 && samples[samples.length - 1] > Math.min(...samples) * 2, { worldSecondsPerFrame: samples });
  const buzz = (await page.evaluate(() => (window as unknown as { __buzz: unknown[] }).__buzz)) as number[][];
  check('mobile', T, 'the blast asks the phone to vibrate (pattern 45/50/90 ms)', buzz.some((b) => JSON.stringify(b) === '[45,50,90]'), buzz);
  await sleep(1500);
  await shot('release-avalanche');
  const settled = await until(G, (s) => s.avalanche.settled, 900000, 2000);
  check('core_gameplay', T, 'step 6: the avalanche runs and settles', settled.ok, { releasedShare: settled.v.avalanche.releasedShare, reachedRoad: settled.v.avalanche.reachedRoad });
  check('difficulty', T, 'a release on the loaded slopes brings most of the loaded snow down', settled.v.avalanche.releasedShare > 0.5, { releasedShare: settled.v.avalanche.releasedShare });
  await stepIs(id, 6, 20000);
  await travel(-150 + 1, -40 + 1, 0);
  await act('Open road', T, 1.2);
  await finish(id, before, t0);
}

// ================================================================== progression: build, buy, measure
{
  const T = 'Station and gear';
  // the stock engine first: speed after 60 m from a standstill on a flat packed road (frame-rate independent)
  // flat packed snow, clear of walls, trees and the kit for 100 m (the line 10 m east runs into the patrol
  // supply cache at about 60 m, which made one of each pair of runs look slow)
  const road = { x: -30, z: 210, yaw: 3.927 };
  const speedAt60Once = async () => {
    await P((p, a) => p.sledTo(a.x, a.z), road);
    await travel(road.x + 1.5, road.z, 0, false);
    await act('Ride the sled', T);
    const on = await until(G, (s) => s.mode === 'sled', 5000);
    if (!on.ok) return { kmh: null, why: `not on the sled (${on.v.mode})` };
    await P((p, a) => p.teleport(a.x, a.z, a.yaw), road);
    await sleep(600);
    const start = await G();
    await page.keyboard.down('KeyW');
    // speed every 6 m, so a slow run says where it lost its speed
    const trace: string[] = [];
    let lastD = -6;
    const r = await until(
      async () => {
        const s = await G();
        const d = Math.hypot(s.position.x - start.position.x, s.position.z - start.position.z);
        if (d - lastD >= 6) {
          lastD = d;
          trace.push(`${Math.round(d)}m:${Math.round(s.speedKmh)}${s.panel ? ' panel' : ''}${s.action ? ` [${s.action.label}]` : ''}`);
        }
        return s;
      },
      (s) => Math.hypot(s.position.x - start.position.x, s.position.z - start.position.z) >= 60,
      300000,
      60,
    );
    await page.keyboard.up('KeyW');
    counts.realInputs++;
    await tap('KeyS', 1500);
    await tap('KeyX');
    const engine = (await P((p) => p.profile().equip.sledEngine)) as string;
    return { kmh: r.ok && r.v.mode === 'sled' ? r.v.speedKmh : null, why: `${r.v.mode}, ${Math.round(Math.hypot(r.v.position.x - start.position.x, r.v.position.z - start.position.z))} m, ${engine}`, trace: trace.join(' ') };
  };
  // two runs each; the slower one counts (a conservative comparison)
  const speedAt60 = async () => {
    const a = await speedAt60Once();
    const b = await speedAt60Once();
    const v = [a.kmh, b.kmh].filter((x): x is number => x !== null);
    return { kmh: v.length === 2 ? Math.min(...v) : null, runs: [a, b] };
  };
  const stock = await speedAt60();
  const g = await G();
  await travel(SPOTS.table.x + 1.4, SPOTS.table.z + 0.4, Math.PI / 2, false);
  await act('Mission table', T);
  await click('.tab[data-t=station]', T, 'open Build the station');
  const fundsB = (await G()).funds;
  await click('[data-u=workshop]', T, 'build the garage workshop');
  const built = await until(G, (s) => s.progress.buildings.includes('workshop'), 5000);
  check('progression', T, 'build the garage workshop from the mission table (220 funds)', built.ok && fundsB - built.v.funds === 220, { buildings: built.v.progress.buildings, spent: fundsB - built.v.funds, rank: g.rank.name });
  await tap('Escape');
  await until(G, (s) => !s.panel, 4000);
  await shot('yard-workshop');
  await travel(SPOTS.workbench.x - 1.4, SPOTS.workbench.z, Math.PI / 2, false);
  await act('Workbench', T);
  await click('[data-i=engine-800]', T, 'buy the Mountain 800 engine');
  const eq = (await P((p) => p.profile().equip.sledEngine)) as string;
  check('progression', T, 'buy the Mountain 800 engine at the workbench and it is fitted', eq === 'engine-800', { equipped: eq });
  await tap('Escape');
  await until(G, (s) => !s.panel, 4000);
  const tuned = await speedAt60();
  check('progression', T, 'the engine upgrade really is faster: speed after 60 m from a standstill on a flat packed road', stock.kmh !== null && tuned.kmh !== null && tuned.kmh > stock.kmh * 1.03, { stock: stock.runs, mountain800: tuned.runs });
}

// ================================================================== Lost on the Tannberg
{
  const id = 'skier';
  const T = mission(id).title;
  const t0 = Date.now();
  await takeFromTable(id);
  const before = await G();
  const top = pad('lifttop');
  await travel(top.x, top.z, 0);
  check('core_gameplay', T, 'step 1: get to the Tannberg top station', (await stepIs(id, 1)).ok);
  await travel(606 + 1, -327 + 1, 0);
  await act('Give Koda the scent', T, 0.8);
  const def = mission(id);
  const trk = def.steps[1] as { trail: { x: number; z: number }[]; at: { x: number; z: number } };
  await shot('skier-track');
  await followKoda(id, T, trk.at, trk.trail);
  await travel(def.subject!.x + 1.2, def.subject!.z + 1.2, 0, false);
  await act('First aid', T, 3);
  check('core_gameplay', T, 'step 3: hold First aid for 3 s', (await stepIs(id, 3)).ok);
  await P((p, a) => p.sledTo(a.x, a.z), { x: def.subject!.x + 3, z: def.subject!.z + 2 });
  await travel(def.subject!.x + 4.5, def.subject!.z + 2, 0, false);
  await act('Ride the sled', T);
  await act('Help Nils on', T, 1.2);
  check('core_gameplay', T, 'step 4: bring the sled over and help Nils on', (await stepIs(id, 4)).ok);
  await travel(380 + 4, 506 + 4, 0);
  check('core_gameplay', T, 'step 5: take Nils down to the clinic on the sled', (await stepIs(id, 5)).ok);
  await tap('KeyX');
  await travel(380 + 1, 506 + 1, 0, false);
  await act('Hand over', T, 0.6);
  await finish(id, before, t0);
}

// ================================================================== Firewood for the Kettle
{
  const id = 'supplies';
  const T = mission(id).title;
  const t0 = Date.now();
  await takeFromTable(id);
  const before = await G();
  await travel(SPOTS.crate.x + 1.2, SPOTS.crate.z, 0, false);
  await act('Load crate', T, 1);
  check('core_gameplay', T, 'step 1: load the crate onto the sled rack', (await stepIs(id, 1)).ok);
  await P((p, a) => p.sledTo(a.x, a.z), { x: SPOTS.crate.x + 4, z: SPOTS.crate.z });
  await travel(SPOTS.crate.x + 5.5, SPOTS.crate.z, 0, false);
  await act('Ride the sled', T);
  check('core_gameplay', T, 'step 2: get on the sled', (await stepIs(id, 2)).ok);
  await travel(330 - 8, 461 - 8, 0);
  check('core_gameplay', T, 'step 3: ride down to the Kettle', (await stepIs(id, 3)).ok);
  await tap('KeyX');
  await travel(336 + 1, 466 + 1, 0, false);
  await act('Unload', T, 1);
  await finish(id, before, t0);
}

// ================================================================== Where's Pepper? (+ save and Continue mid-mission)
{
  const id = 'pepper';
  const T = mission(id).title;
  const t0 = Date.now();
  await takeFromTable(id);
  const before = await G();
  await travel(-300, 455, 0);
  check('core_gameplay', T, 'step 1: go to Mirror Lake', (await stepIs(id, 1)).ok);
  // quit to the title mid-mission, reload the page, Continue: the mission picks up where it was
  await tap('Escape');
  await click('[data-a=title]', 'Save and Continue', 'Save and quit to title');
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { patrol?: unknown }).patrol, null, { timeout: 180000 });
  const cont = page.locator('[data-a=cont]');
  const hasCont = await cont.isVisible().catch(() => false);
  await click('[data-a=cont]', 'Save and Continue', 'Continue');
  const back = await until(G, (s) => s.state === 'play', 15000);
  check('progression', 'Save and Continue', 'after a reload, Continue restores the mission mid-way, funds, rank and place', hasCont && back.v.mission?.id === id && back.v.mission.step === 1 && back.v.funds === before.funds && Math.hypot(back.v.position.x + 300, back.v.position.z - 455) < 30, {
    mission: back.v.mission && `${back.v.mission.id} step ${back.v.mission.step}`,
    funds: back.v.funds,
    rank: back.v.rank.name,
  });
  await P((p, a) => p.dogTo(a.x, a.z), { x: -298, z: 456 });
  await travel(-296 + 1, 456 + 1, 0);
  await act('Give Koda the scent', T, 0.8);
  const def = mission(id);
  const trk = def.steps[1] as { trail: { x: number; z: number }[]; at: { x: number; z: number } };
  await followKoda(id, T, trk.at, trk.trail);
  await travel(def.subject!.x + 1, def.subject!.z + 1, 0, false);
  await act('Pick up', T, 1.6);
  check('core_gameplay', T, 'step 3: coax Pepper down and pick her up', (await stepIs(id, 3)).ok);
  await travel(330 - 8, 461 - 8, 0);
  check('core_gameplay', T, 'step 4: bring Pepper home to the Kettle', (await stepIs(id, 4)).ok);
  await travel(336 + 1, 466 + 1, 0, false);
  await act('Hand over', T, 0.6);
  await finish(id, before, t0);
}

// ================================================================== the two callouts, on the game's own timer
{
  const answered: string[] = [];
  for (let k = 0; k < 2; k++) {
    await travel(0, 250, 0);
    counts.timerShortcuts++;
    await P((p) => (p.profile().eventClock = 1));
    const call = await until(() => page.locator('.alert [data-a=go]').isVisible().catch(() => false), (v) => v, 60000, 400);
    const shown = (await page.locator('.alert').first().textContent().catch(() => '')) ?? '';
    check('replayability', 'Callouts', `a radio callout comes in on the game's timer (#${k + 1})`, call.ok, shown.slice(0, 90));
    if (!call.ok) break;
    await click('.alert [data-a=go]', 'Callouts', 'Respond');
    const s = await until(G, (g) => !!g.mission && !!mission(g.mission.id).dynamic, 8000);
    const id = s.v.mission!.id;
    const def = mission(id);
    const before = await G();
    const t0 = Date.now();
    const at = (def.steps[0] as { at: { x: number; z: number } }).at;
    await travel(at.x + 2, at.z + 2, 0);
    check('core_gameplay', def.title, 'step 1: get to the scene', (await stepIs(id, 1)).ok);
    await travel(at.x + 1, at.z + 1, 0, false);
    const step2 = def.steps[1] as { action: string; hold: number };
    await act(step2.action, def.title, step2.hold);
    await finish(id, before, t0);
    answered.push(id);
  }
  check('replayability', 'Callouts', 'callouts are drawn from the pool (both kinds answered, or one twice)', answered.length === 2, answered);
}

// ================================================================== badges, Koda's nose, sleeping
{
  const T = 'Badges and Koda';
  const b = BADGES.find((k) => k.id !== 'b-lake') ?? BADGES[0];
  const before = await G();
  // stand 20 m off; Koda (at heel) smells it and runs over
  await travel(b.x + 20, b.z, Math.PI / 2);
  const noticed = await until(() => P((p) => p.info().dog) as Promise<{ x: number; z: number; mode: string }>, (d) => Math.hypot(d.x - b.x, d.z - b.z) < 6, 120000, 500);
  check('core_gameplay', T, "Koda smells a hidden badge from 20 m and runs to it", noticed.ok, { kodaFromBadgeM: +Math.hypot(noticed.v.x - b.x, noticed.v.z - b.z).toFixed(1), mode: noticed.v.mode });
  await shot('badge-koda');
  await travel(b.x + 1, b.z, 0, false);
  const found = await until(G, (s) => s.progress.badges === before.progress.badges + 1, 10000);
  check('progression', T, 'walking onto it finds the badge and it is logged', found.ok, { badges: `${found.v.progress.badges} of ${found.v.progress.badgesTotal}` });
  // a night in the bunk: a new day and a new forecast
  await travel(SPOTS.bed.x + 1.5, SPOTS.bed.z + 0.5, 0, false);
  const d0 = (await G()).day;
  await act('Sleep till morning', 'Sleep', 1);
  const morning = await until(G, (s) => s.day === d0 + 1 && s.panel, 8000);
  const fc = (await page.locator('.forecast').first().textContent().catch(() => '')) ?? '';
  check('replayability', 'Sleep', 'the bunk ends the day: next morning, a fresh four-period forecast', morning.ok && fc.length > 10, { day: morning.v.day, forecast: fc.slice(0, 80) });
  await shot('morning');
  await click('[data-a=ok]', 'Sleep', 'Head out');
}

// ================================================================== Kessel Bowl, again: reload, recon, your own read
{
  const T = 'Kessel Bowl, again';
  await travel(0, 250, 0);
  // if the night did not load the bowl, let it snow: fresh snow set through the save (counted)
  const loadedNow = (await P((p) => p.profile().events.includes('bowl-control'))) as boolean;
  if (!loadedNow) {
    counts.snowShortcuts++;
    await P((p) => {
      const w = p.profile().weather;
      w.controlled = false;
      w.freshSnow = 40;
    });
  }
  const posted = await until(() => P((p) => ({ events: [...p.profile().events], loaded: [...p.profile().loaded], wind: p.profile().loadWind })) as Promise<{ events: string[]; loaded: string[]; wind: string }>, (v) => v.events.includes('bowl-recon') && v.events.includes('bowl-control'), 20000, 400);
  check('replayability', T, 'after the story, new snow reloads the bowl and the avalanche service posts a recon flight and a control job', posted.ok && posted.v.loaded.length > 0, { loaded: posted.v.loaded, wind: posted.v.wind, viaNight: loadedNow });
  const loaded = posted.v.loaded;
  // the recon flight: today's loading, not the story's
  {
    const id = 'bowl-recon';
    const t0 = Date.now();
    await takeFromTable(id);
    const before = await G();
    await travel(SPOTS.heli.x + 3.2, SPOTS.heli.z + 1, Math.PI / 2, false);
    await act('Fly', T);
    await stepIs(id, 1);
    await page.keyboard.down('KeyR');
    await until(G, (s) => !s.heli.landed && s.heli.altitudeAboveGround > 4, 120000);
    await page.keyboard.up('KeyR');
    counts.realInputs++;
    await flyTo(-120, -260, 70, 0);
    check('core_gameplay', T, 'recon: fly to Kessel Bowl', (await stepIs(id, 2)).ok);
    const read: string[] = [];
    for (const [i, c] of BOWL_CONTACTS.entries()) {
      await flyTo(c.x, c.z + 70, Math.max(30, H(c.x, c.z) - H(c.x, c.z + 70) + 50), 0);
      const r = await until(() => P((p) => p.state().active?.scan) as Promise<{ identified: boolean[] } | null>, (sc) => !!sc && sc.identified[i], 120000, 400);
      if (r.ok) read.push(c.label);
    }
    check('core_gameplay', T, 'recon: the scanner reads all four slopes', read.length === 4, read);
    await stepIs(id, 3, 10000);
    await flyTo(SPOTS.heli.x, SPOTS.heli.z, 12, Math.PI / 2);
    await page.keyboard.down('KeyC');
    await until(G, (s) => s.heli.landed || !s.mission, 120000);
    await page.keyboard.up('KeyC');
    counts.realInputs++;
    await finish(id, before, t0);
    const marked = (await P((p) => [...p.profile().marked])) as string[];
    check('replayability', T, "recon flags today's loaded slopes (the wind's pattern), ready for the control team", marked.join() === loaded.join(), { marked, loaded });
    await tap('KeyX');
    await until(G, (s) => s.mode === 'foot', 10000);
  }
  // the control job: the table says what recon flagged; charge those, fire, and get paid by the result
  {
    const id = 'bowl-control';
    const t0 = Date.now();
    await travel(SPOTS.table.x + 1.4, SPOTS.table.z + 0.4, Math.PI / 2, false);
    await act('Mission table', T);
    await until(G, (s) => s.panel, 8000);
    await click(`[data-m="${id}"]`, T, 'pick the control job');
    const brief = ((await page.locator('.mdetail').first().textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ');
    const tag = ((await page.locator(`[data-m="${id}"] .tag`).first().textContent().catch(() => '')) ?? '').trim();
    check('player_experience', T, 'the table shows what recon flagged and that the pay is "up to" the listed reward', /Recon flagged/.test(brief) && /^up to/.test(tag), { tag, read: brief.match(/Recon flagged[^.]*\./)?.[0] });
    const goal = ((await page.locator('.goal').first().textContent().catch(() => '')) ?? '').trim();
    check('progression', T, 'the mission table shows the next rank and how far off it is', /Next rank|top of the patrol/.test(goal), goal);
    await click('[data-go]', T, 'take the call');
    await until(G, (g) => g.mission?.id === id && !g.panel, 8000);
    const before = await G();
    await travel(SPOTS.locker.x - 1.2, SPOTS.locker.z, Math.PI / 2, false);
    await act('Take charges', T, 1);
    await stepIs(id, 1);
    await travel(-150 + 1, -40 + 1, 0);
    await act('Close road', T, 1.2);
    await stepIs(id, 2);
    const ridge = pad('ridge');
    await travel(ridge.x, ridge.z, 0);
    check('core_gameplay', T, 'control: road closed and up on Kessel Ridge', (await stepIs(id, 3)).ok);
    const chargesAtStart = (await P((p) => p.profile().active.charges.length)) as number;
    for (const sid of loaded) {
      const c = CHARGE_SPOTS.find((k) => k.id === sid)!;
      await travel(c.x + 1, c.z + 1, 0);
      await act(new RegExp(`^Set charge: Slope ${sid}`), T, 2.2);
    }
    const hud = ((await page.locator('.task .obj').first().textContent().catch(() => '')) ?? '').trim();
    const charged = (await P((p) => [...p.profile().active.charges])) as string[];
    check('core_gameplay', T, 'control: your own charges, as many as you choose (the step waits for you to fire)', chargesAtStart === 0 && charged.join() === loaded.join() && /\(\d+ set\)$/.test(hud), { charged, hud });
    await travel(ridge.x, ridge.z, Math.PI);
    const fireReady = await waitAction('Fire charges');
    counts.realInputs++;
    counts.holds++;
    await page.keyboard.down('KeyE');
    const fired = await until(G, (s) => s.avalanche.fired, 20000, 50);
    await page.keyboard.up('KeyE');
    check('core_gameplay', T, 'control: fire from safe ground with the charges you chose', fireReady.ok && fired.ok);
    const settled = await until(G, (s) => s.avalanche.settled, 900000, 2000);
    check('difficulty', T, "control: today's loaded slopes come down and the berm holds", settled.ok && settled.v.avalanche.releasedShare > 0.5 && !settled.v.avalanche.reachedRoad, settled.v.avalanche);
    await stepIs(id, 6, 20000);
    await travel(-150 + 1, -40 + 1, 0);
    await act('Open road', T, 1.2);
    await finish(id, before, t0);
    check('replayability', T, 'the debrief explains the result: what was loaded, what you charged, and the clean-read bonus', /Loaded today:/.test(missionLog[id]?.extra ?? '') && /clean read/i.test(missionLog[id]?.extra ?? ''), (missionLog[id]?.extra ?? '').slice(0, 220));
    const after = (await P((p) => ({ events: [...p.profile().events], controlled: p.profile().weather.controlled, bowlDays: p.profile().bowlDays }))) as { events: string[]; controlled: boolean; bowlDays: number };
    check('replayability', T, 'the bowl is controlled, the calls are off the board, and the patrol log counts it', after.controlled && !after.events.some((e) => e.startsWith('bowl')) && after.bowlDays === 1, after);
  }
}

// ================================================================== totals
const end = await G();
const story = MISSIONS.filter((m) => !m.dynamic);
check('core_gameplay', 'Campaign', 'every story mission completed end to end', story.every((m) => missionLog[m.id]?.ok), Object.keys(missionLog));
check('progression', 'Campaign', 'reputation raises the rank (Recruit at the start)', end.rank.index >= 3, { rank: end.rank.name, reputation: end.reputation, ranks: RANKS.map((r) => `${r.name} ${r.rep}`).join(', ') });
// the HUD adds a count to counted steps ("(0 of 4)" slopes scanned, charges set)
const badObj = objectives.filter((o) => !o.game || !(o.hud === o.game || new RegExp(`^${o.game.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(\\d+ (of \\d+|set)\\)$`).test(o.hud)));
check('player_experience', 'Campaign', "every mission step's objective is on the HUD, word for word (plus its count on counted steps)", objectives.length > 20 && badObj.length === 0, { stepsChecked: objectives.length, mismatches: badObj.slice(0, 3) });
check('technical', 'Campaign', 'no page errors or console errors during the whole playthrough', pageErrors.length === 0, pageErrors.slice(0, 5));
await shot('end');
await browser.close();

// ================================================================== report
const failed = checks.filter((c) => !c.ok);
const byCat: Record<string, Check[]> = {};
for (const c of checks) (byCat[c.cat] ??= []).push(c);
const report = {
  kind: 'rockslide-playthrough',
  url,
  when: new Date().toISOString(),
  seconds: Math.round((Date.now() - T0) / 1000),
  ok: failed.length === 0,
  counts,
  missions: missionLog,
  final: { rank: end.rank.name, funds: end.funds, reputation: end.reputation, day: end.day, progress: end.progress },
  categories: Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, { checks: v.length, passed: v.filter((c) => c.ok).length }])),
  checks,
  log,
  method:
    'Real key input and clicks for every action and menu; long journeys skipped with the QA teleport (counted in counts.travelShortcuts); the radio callout timer wound down through the save (counts.timerShortcuts); if the night did not reload Kessel Bowl, new snow is set through the save (counts.snowShortcuts). Chromium headless, SwiftShader (software WebGL), 390x844 touch viewport, Light graphics.',
  notTested: ['real-device frame rate', 'real touch hardware and haptics on a phone (vibration was observed as a request to navigator.vibrate, not felt)', 'iPhone Safari (this is Chromium)', 'driving and flying the long journeys by hand'],
};
writeFileSync(join(outDir, 'playthrough.json'), JSON.stringify(report, null, 1));
const md = [
  `# ROCKSLIDE playthrough: ${report.ok ? 'PASS' : `FAIL (${failed.length} of ${checks.length} checks)`}`,
  '',
  `${report.when} · ${url} · ${report.seconds} s · ${checks.length} checks · ${counts.realInputs} real key inputs (${counts.holds} holds) · ${counts.clicks} clicks · ${counts.travelShortcuts} travel shortcuts · ${counts.timerShortcuts} callout-timer shortcuts · ${counts.snowShortcuts} snow shortcuts`,
  '',
  `Method: ${report.method}`,
  '',
  '## Missions',
  '',
  '| Mission | Funds | Reputation | Rank after | Wall time |',
  '|---|---|---|---|---|',
  ...Object.entries(missionLog).map(([id, m]) => `| ${mission(id).title} | +${m.funds} | +${m.rep} | ${m.rankAfter} | ${m.seconds} s |`),
  '',
  `Final: ${report.final.rank}, ${report.final.funds} funds, ${report.final.reputation} reputation, day ${report.final.day}, ${report.final.progress.badges} of ${report.final.progress.badgesTotal} badges, buildings: ${report.final.progress.buildings.join(', ') || 'none'}.`,
  '',
  '## Checks',
  '',
  '| | Area | Check | Detail |',
  '|---|---|---|---|',
  ...checks.map((c) => `| ${c.ok ? '✅' : '❌'} | ${c.group} | ${c.what} | ${c.detail.replace(/\|/g, '/').slice(0, 160)} |`),
  '',
  '## Not tested here',
  '',
  ...report.notTested.map((n) => `- ${n}`),
  '',
];
writeFileSync(join(outDir, 'playthrough.md'), md.join('\n'));
console.log(`\n${report.ok ? 'PASS' : 'FAIL'}: ${checks.length - failed.length}/${checks.length} checks, ${report.seconds} s`);
process.exit(report.ok ? 0 : 1);
