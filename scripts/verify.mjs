// Release check in a real browser, on the production build: phone viewports, the HUD, the flows.
// Usage: node scripts/verify.mjs http://localhost:4173/            (exit code 1 on any failure)
//
// For each phone size (iPhones upright and on their side) it boots the game from a clean save and
// checks: no page errors or console warnings, every Kessel kit model loaded and placed (three.js as
// the game ships it), the HUD cards never overlap each other or leave the screen, the touch
// targets are big enough, the page cannot scroll, and the title, pause, panels, restart and
// continue flows leave the game in a clean state.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const url = process.argv[2] ?? 'http://localhost:4173/';
const KIT = ['rs_akja', 'rs_boulder_a', 'rs_boulder_b', 'rs_cache', 'rs_crag_a', 'rs_crag_b', 'rs_crag_c', 'rs_deadfall', 'rs_lantern', 'rs_stump'];
const SIZES = [
  ['iPhone 15', 393, 852],
  ['iPhone SE', 375, 667],
  ['iPhone 15 Pro Max', 430, 932],
  ['iPhone 15 landscape', 852, 393],
  ['iPhone SE landscape', 667, 375],
];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const fails = [];
const results = [];
const check = (ok, what) => {
  if (!ok) fails.push(what);
  return ok;
};

for (const [name, width, height] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const logs = [];
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  page.on('console', (m) => (m.type() === 'warning' || m.type() === 'error') && logs.push(`${m.type()}: ${m.text()}`));
  await page.goto(url);
  await page.waitForFunction(() => window.patrol, null, { timeout: 180000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.patrol, null, { timeout: 180000 });
  const P = (f, a) => page.evaluate(f, a);
  const until = (f, ms = 15000) => page.waitForFunction(f, null, { timeout: ms }).then(() => true, () => false);
  const r = { name, width, height };
  // the title: the loading card goes away (frames are slow on a software renderer, so allow time)
  r.loadingGone = await page.waitForFunction(() => getComputedStyle(document.getElementById('loading')).display === 'none', null, { timeout: 20000 }).then(() => true, () => false);
  check(r.loadingGone, `${name}: loading card still showing over the title`);
  await page.tap('[data-a=new]');
  await page.waitForTimeout(1200);
  // the kit, in the game's own three.js
  const kit = await P(() => window.patrol.kit());
  r.kit = { loaded: kit.loaded.length, placed: kit.placed, drawCalls: kit.drawCalls };
  check(KIT.every((k) => kit.loaded.includes(k)), `${name}: kit models missing: ${KIT.filter((k) => !kit.loaded.includes(k)).join(', ')}`);
  // the patrol's MeshCraft models stand in for the code-built sled, helicopter, conifer, patroller, villagers and Koda
  r.models = await P(() => window.patrol.models());
  check(Object.values(r.models).every(Boolean), `${name}: patrol models not in use: ${JSON.stringify(r.models)}`);
  check(kit.placed > 300, `${name}: only ${kit.placed} kit pieces placed`);
  // HUD geometry, on foot, on the sled and in the helicopter (with a mission card and the radio up)
  const hud = async (label) => {
    const boxes = await P(() => {
      const pick = (sel) => {
        const e = document.querySelector(sel);
        if (!e) return null;
        const cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return null;
        const b = e.getBoundingClientRect();
        if (!b.width || !b.height) return null;
        return { sel, x: b.left, y: b.top, r: b.right, b: b.bottom };
      };
      return ['.hud .task', '.hud .compass', '.hud .wp-dist', '.hud .cond', '.hud .radio.on', '.hud .speedo', '.hud .alt', '.hud .act', '.hud .side', '.hud .lever'].map(pick).filter(Boolean);
    });
    const overlaps = [];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const ix = Math.min(a.r, b.r) - Math.max(a.x, b.x);
        const iy = Math.min(a.b, b.b) - Math.max(a.y, b.y);
        if (ix > 2 && iy > 2) overlaps.push(`${a.sel} × ${b.sel}`);
      }
    const off = boxes.filter((b) => b.x < -1 || b.y < -1 || b.r > width + 1 || b.b > height + 1).map((b) => b.sel);
    check(!overlaps.length, `${name} ${label}: HUD overlaps ${overlaps.join(', ')}`);
    check(!off.length, `${name} ${label}: off screen ${off.join(', ')}`);
    return { cards: boxes.length, overlaps, off };
  };
  await P(() => window.patrol.game.hud.radio('Dispatch', 'Morning, Kessel Patrol. Forty centimetres up high overnight. There is a call on your mission table.', 30));
  await page.waitForTimeout(400);
  r.hudFoot = await hud('on foot');
  await P(() => {
    window.patrol.accept('rounds');
    window.patrol.sledTo(-150, -60);
    window.patrol.teleport(-150, -58, 0);
  });
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyE');
  check(await until(() => window.patrol.state().mode === 'sled'), `${name}: could not get on the sled`);
  await page.waitForTimeout(600);
  r.hudSled = await hud('on the sled');
  await page.keyboard.press('KeyX');
  check(await until(() => window.patrol.state().mode === 'foot'), `${name}: could not get off the sled`);
  await P(() => {
    window.patrol.complete('rounds');
    window.patrol.accept('survey');
    window.patrol.teleport(-20.5, 292, Math.PI / 2);
  });
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyE');
  check(await until(() => window.patrol.state().mode === 'heli'), `${name}: could not board the helicopter`);
  await P(() => window.patrol.heliTo(-175, -335, 380));
  await page.waitForTimeout(600);
  r.hudHeli = await hud('in the helicopter');
  // touch targets: every button the HUD shows is at least 44 px each way (Apple's guideline)
  const small = await P(() =>
    [...document.querySelectorAll('.hud button')]
      .filter((b) => b.offsetParent && getComputedStyle(b).visibility !== 'hidden')
      .map((b) => b.getBoundingClientRect())
      .filter((b) => b.width < 43.5 || b.height < 43.5).length,
  );
  check(small === 0, `${name}: ${small} HUD buttons smaller than 44 px`);
  // the page itself never scrolls or zooms under a drag
  r.scroll = await P(() => ({ x: document.scrollingElement.scrollWidth - innerWidth, y: document.scrollingElement.scrollHeight - innerHeight, touch: getComputedStyle(document.body).touchAction }));
  check(r.scroll.x <= 0 && r.scroll.y <= 0 && r.scroll.touch === 'none', `${name}: page can scroll (${JSON.stringify(r.scroll)})`);
  // panels: Esc closes them (frames are slow on a software renderer: wait on the state, not the clock)
  await P(() => window.patrol.closePanel());
  await page.keyboard.press('KeyM');
  const mapOpen = await until(() => document.querySelector('.panel-wrap h2')?.textContent === 'Valley map');
  await page.keyboard.press('Escape');
  const mapClosed = await until(() => !document.querySelector('.panel-wrap'));
  check(mapOpen && mapClosed, `${name}: map did not open with M (${mapOpen}) and close with Esc (${mapClosed})`);
  // start over mid-avalanche-watch: nothing carries over
  await P(() => {
    const g = window.patrol.game;
    g.watching = 1;
    g.holdId = 'saw';
    g.holdT = 1;
    g.hud.radio('Test', 'stale line', 30);
  });
  await P(() => window.patrol.closePanel());
  await page.tap('.cond .iconbtn');
  await until(() => document.querySelector('[data-a=reset]'));
  await page.tap('[data-a=reset]');
  await page.tap('[data-a=reset]');
  await page.waitForTimeout(500);
  await until(() => document.querySelector('[data-a=new]'));
  await page.tap('[data-a=new]');
  await until(() => window.patrol.game.state === 'play');
  await page.waitForTimeout(500);
  r.restart = await P(() => {
    const g = window.patrol.game;
    const s = window.patrol.state();
    return { mode: s.mode, active: s.active, watching: g.watching, holdT: g.holdT, talking: g.hud.talking && !document.querySelector('.radio').textContent.includes('Dispatch'), funds: g.p.funds, camMode: g.cam.mode };
  });
  check(r.restart.mode === 'foot' && !r.restart.active && r.restart.watching === 0 && r.restart.holdT === 0 && !r.restart.talking, `${name}: start over left state behind ${JSON.stringify(r.restart)}`);
  // continue restores where you were
  await P(() => window.patrol.teleport(10, 236, 0.3));
  await P(() => window.patrol.save());
  await page.reload();
  await page.waitForFunction(() => window.patrol, null, { timeout: 180000 });
  await page.waitForTimeout(1200);
  const hasContinue = await P(() => !!document.querySelector('[data-a=cont]'));
  check(hasContinue, `${name}: no Continue after a save`);
  if (hasContinue) {
    await page.tap('[data-a=cont]');
    await page.waitForTimeout(600);
    const pos = await P(() => window.patrol.state().pos);
    check(Math.hypot(pos.x - 10, pos.z - 236) < 3, `${name}: Continue put you at ${JSON.stringify(pos)}`);
  }
  r.logs = logs;
  check(!logs.length, `${name}: console: ${logs.join(' | ')}`);
  results.push(r);
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 1));
console.log(fails.length ? `FAIL (${fails.length})\n- ${fails.join('\n- ')}` : `PASS: ${SIZES.length} viewports`);
process.exit(fails.length ? 1 : 0);
