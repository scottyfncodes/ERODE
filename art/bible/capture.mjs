// The art bible's captures: authentic frames of the current build, staged through the QA handle
// `window.patrol` (teleport, time of day, day/forecast, panels). Nothing is painted over.
//   npx vite build && npx vite preview --port 4173 &
//   node art/bible/capture.mjs [url] [outdir]       (default http://localhost:4173/ gitcraft-out/bible/shots)
// Each shot is "env" (the HTML interface hidden, the 3D view and its lens grade only) or "ui"
// (exactly what a player sees). shots.json records every shot's staging next to the PNGs.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [url = 'http://localhost:4173/', out = 'gitcraft-out/bible/shots', only] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const record = [];
const problems = [];

async function boot(viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: opts.dpr ?? 1, isMobile: !!opts.mobile, hasTouch: !!opts.mobile });
  const page = await ctx.newPage();
  page.setDefaultTimeout(300000);
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
  await page.goto(url);
  await page.waitForFunction(() => window.patrol, null, { timeout: 240000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.patrol, null, { timeout: 240000 });
  await page.waitForTimeout(3500);
  return { ctx, page };
}
const unhide = (page) => page.evaluate(() => { const s = document.getElementById('bible-hide'); if (s) s.textContent = ''; });
const want = (name) => !only || only.split(',').includes(name);
async function shot(page, name, kind, note) {
  if (!want(name)) return;
  await page.evaluate((hide) => {
    let s = document.getElementById('bible-hide');
    if (!s) { s = document.createElement('style'); s.id = 'bible-hide'; document.head.appendChild(s); }
    s.textContent = hide ? '#ui,#loading{visibility:hidden!important}' : '';
  }, kind === 'env');
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${out}/${name}.png` });
  const vp = page.viewportSize();
  record.push({ name, kind, note, viewport: `${vp.width}x${vp.height}` });
  console.log('shot', name);
}
// place the patroller and the camera: the camera sits at player + (sin yaw, cos yaw) * dist
const stage = (page, s) =>
  page.evaluate((s) => {
    const P = window.patrol, g = P.game;
    P.closePanel();
    if (s.day) P.setDay(s.day);
    P.setTime(s.minute);
    P.teleport(s.x, s.z, s.yaw ?? 0);
    P.camYaw(s.cam ?? s.yaw ?? 0);
    P.camPitch(s.pitch ?? 0.2);
    // a fixed camera distance for close-ups (the follow camera eases back to its own otherwise)
    if (!g.cam.__orig) g.cam.__orig = g.cam.update;
    g.cam.__dist = s.dist ?? null;
    g.cam.update = function (...a) { if (this.__dist) this.dist = this.__dist; return this.__orig.apply(this, a); };
    if (s.dog) P.dogTo(s.dog[0], s.dog[1]);
  }, s);
async function at(page, name, kind, s, note, wait = 2600) {
  if (!want(name)) return;
  await stage(page, s);
  await page.waitForTimeout(wait);
  await stage(page, s);
  await page.waitForTimeout(600);
  await shot(page, name, kind, note);
}

// ---------------- landscape desktop, 1440 x 900 ----------------
{
  const { ctx, page } = await boot({ width: 1440, height: 900 });
  await shot(page, 'ui-title', 'ui', 'Title screen, first launch');
  await shot(page, 'env-title', 'env', 'Title view: the lodge front, symmetrical, the interface hidden');
  await unhide(page);
  await page.click('[data-a=new]');
  await page.waitForTimeout(1800);
  await page.addStyleTag({ content: '.dispatch{display:none!important}' });
  const G = (f, a) => page.evaluate(f, a);

  // --- the station, through the day (one view of the lodge front)
  const lodge = { x: -12, z: 258, yaw: 0.74, pitch: 0.18 };
  await at(page, 'env-lodge-dawn', 'env', { ...lodge, minute: 6 * 60 + 40 }, 'Lodge front, 06:40');
  await at(page, 'env-lodge-day', 'env', { ...lodge, minute: 12 * 60 }, 'Lodge front, 12:00, clear');
  await at(page, 'env-lodge-dusk', 'env', { ...lodge, minute: 18 * 60 + 40 }, 'Lodge front, 18:40, first snow of the evening');
  await at(page, 'env-lodge-night', 'env', { ...lodge, minute: 21 * 60 + 30 }, 'Lodge front, 21:30');
  await at(page, 'env-yard', 'env', { x: 30, z: 254, yaw: 0.35, minute: 9 * 60 }, 'The station yard, 09:00');
  await at(page, 'env-lodge-inside', 'env', { x: -28, z: 245, yaw: 1.2, pitch: 0.5, minute: 12 * 60 }, 'Inside the lodge: the roof lifts away');
  await at(page, 'env-pad', 'env', { x: -6, z: 300, yaw: 1.2, pitch: 0.2, minute: 10 * 60 + 30 }, 'Helipad and hangar');

  // --- the valley
  // look at a target (tx, tz) from d metres away on bearing a (0 = south of it): the camera sits behind the player
  const look = (name, minute, tx, tz, a, dd, pitch, note) => at(page, name, 'env', { x: tx + Math.sin(a) * dd, z: tz + Math.cos(a) * dd, yaw: a, pitch, minute }, note);
  await look('env-hollin', 11 * 60, 330, 455, 0.25, 42, 0.16, 'Hollin: the Kettle and the village row');
  await at(page, 'env-topstation', 'env', { x: 586, z: -320, yaw: 0.1, pitch: 0.16, minute: 11 * 60 }, 'Tannberg top station');
  await at(page, 'env-ops-sign', 'env', { x: -133 + Math.sin(0.35) * 10, z: -36 + Math.cos(0.35) * 10, yaw: 0.35, pitch: 0.16, minute: 13 * 60 }, 'Avalanche area sign on the pass road');
  await at(page, 'env-ops-exploder', 'env', { x: -112 + Math.sin(2.1) * 11, z: -474 + Math.cos(2.1) * 11, yaw: 2.1, pitch: 0.36, minute: 10 * 60 }, 'Remote exploder, Kessel Ridge');

  // --- weather (day 30: snow 06-10, storm 10-14)
  await at(page, 'env-snow', 'env', { ...lodge, day: 30, minute: 8 * 60 }, 'Snow, day 30 08:00');
  await at(page, 'env-storm', 'env', { ...lodge, day: 30, minute: 12 * 60 }, 'Storm, day 30 12:00', 4000);
  await at(page, 'env-overcast', 'env', { ...lodge, day: 1, minute: 15 * 60 + 30 }, 'Overcast, day 1 15:30');
  await G(() => window.patrol.setDay(1));

  // --- characters: Vince close (camera in front: yaw + pi), Koda beside him
  const vx = 6, vz = 262;
  await at(page, 'env-vince-front', 'env', { x: vx, z: vz, yaw: 0, cam: Math.PI, pitch: 0.06, dist: 2.6, minute: 11 * 60 }, 'Vince, front');
  await at(page, 'env-vince-three', 'env', { x: vx, z: vz, yaw: 0, cam: Math.PI - 0.75, pitch: 0.1, dist: 3.0, minute: 11 * 60 }, 'Vince, three-quarter', 3400);
  await at(page, 'env-vince-back', 'env', { x: vx, z: vz, yaw: 0, cam: 0, pitch: 0.12, dist: 3.0, minute: 11 * 60 }, 'Vince, back: the pack and the scarf');
  await at(page, 'env-koda', 'env', { x: vx, z: vz, yaw: 0, cam: Math.PI - 0.35, pitch: 0.14, dist: 3.6, dog: [vx - 1.0, vz - 0.6], minute: 11 * 60 }, 'Koda beside Vince', 1400);
  // the cast lineup (staged in engine: the real villager models, moved into one frame)
  if (want('env-cast')) {
    await stage(page, { x: vx, z: vz, yaw: 0, cam: Math.PI, pitch: 0.08, dist: 6.5, minute: 11 * 60 });
    await G(([vx, vz]) => {
      const g = window.patrol.game, pr = g.props, h = (x, z) => g.terrain.height(x, z);
      const put = (m, dx) => { m.group.visible = true; m.group.position.set(vx + dx, h(vx + dx, vz - 0.4), vz - 0.4); m.group.rotation.y = 0; };
      put(pr.greta, -2.6); put(pr.nils, 2.2); put(pr.driver, 3.7);
      window.patrol.dogTo(vx - 1.2, vz - 0.6);
    }, [vx, vz]);
    await page.waitForTimeout(2500);
    await G(([vx, vz]) => window.patrol.dogTo(vx - 1.2, vz - 0.6), [vx, vz]);
    await page.waitForTimeout(400);
    await shot(page, 'env-cast', 'env', 'Cast lineup, staged in engine: Greta, Koda, Vince, Nils, the van driver');
  }
  await G(() => { const g = window.patrol.game; g.cam.__dist = null; });

  // --- interface: panels
  const panel = async (name, f, note, a) => {
    if (!want(name)) return;
    await G(() => window.patrol.closePanel());
    await G(() => { window.patrol.setTime(10 * 60); window.patrol.teleport(-27, 245, 1.2); });
    await page.waitForTimeout(1500);
    await G(f, a);
    await page.waitForTimeout(1400);
    await shot(page, name, 'ui', note);
  };
  await panel('ui-board', () => window.patrol.game.openBoard('calls'), 'The mission table: calls, forecast and avalanche danger');
  await panel('ui-board-station', () => window.patrol.game.openBoard('station'), 'The mission table: building up the station');
  await panel('ui-wardrobe', () => window.patrol.game.openOutfit('Wardrobe', ['patroller']), 'The wardrobe');
  await panel('ui-map', () => window.patrol.game.openMap(), 'The valley map');
  await panel('ui-pause', () => window.patrol.game.openPause(), 'Pause: settings and assists');
  await G(() => window.patrol.closePanel());

  // --- interface: the HUD on foot with a radio line, a call accepted (chapter card), the marker
  if (want('ui-hud-foot')) {
    await stage(page, { x: 30, z: 254, yaw: 0.35, minute: 9 * 60 + 30 });
    await page.waitForTimeout(2200);
    await G(() => window.patrol.game.hud.radio('Dispatch', 'Kessel Patrol, morning. The Grauhorn station has gone quiet again. Can you run up and have a look?', 8));
    await page.waitForTimeout(900);
    await shot(page, 'ui-hud-foot', 'ui', 'HUD on foot with a dispatch radio line');
  }
  if (want('ui-chapter')) {
    await stage(page, { x: 30, z: 254, yaw: 0.35, minute: 9 * 60 + 30 });
    await G(() => window.patrol.accept('rounds'));
    await page.waitForTimeout(900);
    await shot(page, 'ui-chapter', 'ui', 'Chapter card on accepting a call');
    await page.waitForTimeout(4000);
  }
  await G(() => { const p = window.patrol.profile(); if (p.settings) p.settings.routeLine = true; window.patrol.apply && window.patrol.apply(); });
  await at(page, 'ui-hud-mission', 'ui', { x: 40, z: 236, yaw: 2.6, pitch: 0.24, minute: 9 * 60 + 40 }, 'HUD during a call: the objective, the route line on the snow', 3000);
  await at(page, 'env-beacon', 'env', { x: -12, z: 258, yaw: 0.74, pitch: 0.18, minute: 18 * 60 + 40 }, 'Mission beacon over the objective (here the lodge), dusk');

  // --- vehicles
  if (want('ui-hud-sled') || want('env-sled')) {
    await G(() => window.patrol.game.mountSled(true));
    await at(page, 'ui-hud-sled', 'ui', { x: 40, z: 300, yaw: 1.9, pitch: 0.22, minute: 10 * 60 }, 'HUD on the snowmobile');
    await at(page, 'env-sled', 'env', { x: 40, z: 300, yaw: 1.9, cam: 1.9 + 2.3, pitch: 0.16, dist: 5.4, minute: 10 * 60 }, 'The snowmobile with Koda on the rack');
    await G(() => { const g = window.patrol.game; g.cam.__dist = null; });
    await G(() => window.patrol.game.dismount());
    await page.waitForTimeout(800);
  }
  if (['ui-hud-heli', 'env-heli', 'env-air-hollin', 'env-air-tannberg', 'env-air-bowl', 'env-air-lake', 'env-air-station'].some(want)) {
    await G(() => window.patrol.game.mountHeli(true));
    await G(() => { window.patrol.setTime(10 * 60 + 20); window.patrol.heliTo(-150, -260, 420); window.patrol.camYaw(0); });
    await page.waitForTimeout(3000);
    await shot(page, 'ui-hud-heli', 'ui', 'HUD in the helicopter over Kessel Bowl');
    await G(() => { window.patrol.heliTo(120, 120, window.patrol.game.terrain.height(120, 120) + 26); window.patrol.camYaw(1.9); window.patrol.camPitch(0.12); });
    await page.waitForTimeout(3000);
    await shot(page, 'env-heli', 'env', 'The rescue helicopter in flight');
    // aerial establishing views: the helicopter on bearing a, dd metres from the target, the camera behind it
    const air = async (name, minute, tx, tz, a, dd, alt, pitch, note) => {
      if (!want(name)) return;
      const f = ([m, tx, tz, a, dd, alt, pitch]) => {
        const P = window.patrol, g = P.game, x = tx + Math.sin(a) * dd, z = tz + Math.cos(a) * dd;
        P.setTime(m); P.heliTo(x, z, g.terrain.height(x, z) + alt); g.heli.yaw = a; P.camYaw(a); P.camPitch(pitch);
        // establishing views: the helicopter itself is hidden so the place fills the frame (tagged staged)
        g.heliMesh.group.scale.setScalar(0.0001);
      };
      await G(f, [minute, tx, tz, a, dd, alt, pitch]); await page.waitForTimeout(3000);
      await G(f, [minute, tx, tz, a, dd, alt, pitch]); await page.waitForTimeout(700);
      await shot(page, name, 'env', note + ' (staged: the helicopter model hidden)');
      await G(() => window.patrol.game.heliMesh.group.scale.setScalar(1));
    };
    await air('env-air-hollin', 11 * 60, 330, 480, 0.35, 170, 60, 0.3, 'Hollin from the air');
    await air('env-air-tannberg', 12 * 60, 560, -80, 0.15, 360, 90, 0.22, 'The Tannberg ski area from the air');
    await air('env-air-bowl', 10 * 60 + 30, -125, -420, 0.1, 330, 110, 0.2, 'Kessel Bowl and the ridge from the air');
    await air('env-air-lake', 16 * 60, -430, 470, 1.0, 260, 70, 0.28, 'Mirror Lake from the air');
  }
  await ctx.close();
}

// ---------------- phone, portrait: iPhone-sized, 2x ----------------
{
  const { ctx, page } = await boot({ width: 390, height: 844 }, { dpr: 2, mobile: true });
  await shot(page, 'phone-title', 'ui', 'Title screen on a phone held upright');
  await unhide(page);
  await page.click('[data-a=new]');
  await page.waitForTimeout(1800);
  await page.addStyleTag({ content: '.dispatch{display:none!important}' });
  await at(page, 'phone-hud', 'ui', { x: 30, z: 254, yaw: 0.35, minute: 9 * 60 + 30 }, 'HUD on a phone: stick, look, the action button and chips');
  await page.evaluate(() => window.patrol.game.openBoard('calls'));
  await page.waitForTimeout(1500);
  await shot(page, 'phone-board', 'ui', 'The mission table on a phone');
  await ctx.close();
}
let prev = [];
try { prev = JSON.parse(readFileSync(`${out}/shots.json`, 'utf8')).shots; } catch {}
const merged = [...prev.filter((p) => !record.some((r) => r.name === p.name)), ...record];
writeFileSync(`${out}/shots.json`, JSON.stringify({ url, taken: new Date().toISOString(), shots: merged, problems }, null, 1));
console.log(JSON.stringify({ shots: record.length, problems }));
await browser.close();
