// Fixed-camera showcase captures for before/after comparisons (QA and the production report).
// Usage: node scripts/showcase.mjs <url> <outprefix> [portrait]
// Every view is placed with the window.patrol debug handle, so two builds can be shot identically.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [url = 'http://localhost:4173/', out = 'out/show', portrait] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const size = portrait ? { width: 390, height: 844 } : { width: 844, height: 390 };
const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => m.type() === 'warning' && m.text().includes('ROCKSLIDE') && logs.push(`[warn] ${m.text()}`));
const t0 = Date.now();
await page.goto(url);
await page.waitForFunction(() => window.patrol, null, { timeout: 180000 });
const bootMs = Date.now() - t0;
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.patrol, null, { timeout: 180000 });
await page.waitForTimeout(3500);
await page.screenshot({ path: `${out}-0title.png` });
await page.click('[data-a=new]');
await page.waitForTimeout(1500);
const P = (f, a) => page.evaluate(f, a);
const shot = async (name, setup, wait = 2200) => {
  await P(setup);
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${out}-${name}.png` });
};
// hide transient radio/dispatch cards so views compare cleanly
await page.addStyleTag({ content: '.radio,.toast,.dispatch{display:none!important}' });
// camera sits at player + (sin yaw, cos yaw) * dist, so yaw 0 looks north (-z)
const ground = (minute, x, z, yaw, pitch = 0.2) => ({ f: ([m, x, z, y, p]) => {
  window.patrol.closePanel();
  window.patrol.setTime(m);
  window.patrol.teleport(x, z, y);
  window.patrol.camYaw(y);
  window.patrol.camPitch(p);
}, a: [minute, x, z, yaw, pitch] });
const at = async (name, v, wait = 2400) => {
  await P(v.f, v.a);
  await page.waitForTimeout(wait);
  await P(v.f, v.a);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}-${name}.png` });
};
await at('1yard', ground(9 * 60, 30, 254, 0.35));
await at('2topstation', ground(11 * 60, 586, -320, 0.1, 0.16));
await at('3passroad', ground(13 * 60, -420, -186, 0.05, 0.16));
await at('5dusk', ground(18 * 60 + 40, -12, 258, 0.74, 0.18));
// recon flight over Kessel Bowl, boarded the way a player does
await P(() => {
  window.patrol.closePanel();
  window.patrol.setTime(10 * 60);
  window.patrol.complete('rounds');
  window.patrol.accept('survey');
  window.patrol.teleport(-20.5, 292, Math.PI / 2);
});
await page.waitForTimeout(600);
await page.keyboard.down('KeyE');
await page.waitForTimeout(100);
await page.keyboard.up('KeyE');
await P(() => {
  window.patrol.closePanel();
  window.patrol.heliTo(-150, -260, 420);
  window.patrol.camYaw(0);
});
await page.waitForTimeout(2800);
await page.screenshot({ path: `${out}-4ridge-heli.png` });
const info = await P(() => ({ state: window.patrol.state(), info: window.patrol.info(), kit: window.patrol.kit ? window.patrol.kit() : null }));
console.log(JSON.stringify({ bootMs, fps: info.state.fps, calls: info.info.calls, tris: info.info.tris, kit: info.kit }));
console.log(logs.join('\n') || 'no page errors');
await browser.close();
