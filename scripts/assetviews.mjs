// Fixed views of the assets the GITCRAFT modernization touches, for before/after comparisons.
// Usage: node scripts/assetviews.mjs <url> <outprefix> [portrait]
// Every station upgrade is built (via the save) so the wing, kennel run and the rest are in frame.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [url = 'http://localhost:4173/', out = 'out/assets', portrait] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const size = portrait ? { width: 390, height: 844 } : { width: 844, height: 390 };
const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
page.on('console', (m) => (m.type() === 'warning' || m.type() === 'error') && problems.push(`[${m.type()}] ${m.text()}`));
await page.goto(url);
await page.waitForFunction(() => window.patrol, null, { timeout: 180000 });
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.patrol, null, { timeout: 180000 });
await page.waitForTimeout(2500);
await page.click('[data-a=new]');
await page.waitForTimeout(1200);
await page.addStyleTag({ content: '.radio,.toast,.dispatch{display:none!important}' });
// every upgrade stands: the save is patched before the game reads it on each load (the page writes
// its own copy on the way out, so patching it from the page would be undone)
await ctx.addInitScript(() => {
  try {
    const k = 'rockslide.patrol.v1';
    const p = JSON.parse(localStorage.getItem(k));
    if (p) {
      p.upgrades = ['kennel', 'workshop', 'equipment', 'hangar', 'mast', 'wing', 'lights'];
      localStorage.setItem(k, JSON.stringify(p));
    }
  } catch {}
});
await page.evaluate(() => window.patrol.save());
await page.reload();
await page.waitForFunction(() => window.patrol, null, { timeout: 180000 });
await page.waitForTimeout(2000);
await page.click('[data-a=cont]');
await page.waitForTimeout(1200);
await page.addStyleTag({ content: '.radio,.toast,.dispatch{display:none!important}' });
const view = async (name, minute, x, z, yaw, pitch, wait = 2400) => {
  const f = ([m, x, z, y, p]) => {
    window.patrol.closePanel();
    window.patrol.setTime(m);
    window.patrol.teleport(x, z, y);
    window.patrol.camYaw(y);
    window.patrol.camPitch(p);
  };
  await page.evaluate(f, [minute, x, z, yaw, pitch]);
  await page.waitForTimeout(wait);
  await page.evaluate(f, [minute, x, z, yaw, pitch]);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}-${name}.png` });
};
// camera sits at player + (sin yaw, cos yaw) * dist
await view('lodge-front', 10 * 60, -14, 247, 1.75, 0.22);
await view('lodge-north', 10 * 60, -30, 222, Math.PI - 0.5, 0.25);
await view('lodge-inside', 12 * 60, -28, 245, 1.2, 0.5);
await view('lodge-inside-bunk', 12 * 60, -33, 243, 0.4, 0.6);
await view('lodge-dusk', 18 * 60 + 50, -12, 252, 1.4, 0.2);
// look at a target (tx, tz) from a player d metres away at bearing a (0 = south of it): the camera is
// behind the player (angles picked so the slope does not fill the frame)
const look = (name, minute, tx, tz, a, d, pitch) => view(name, minute, tx + Math.sin(a) * d, tz + Math.cos(a) * d, a, pitch);
await look('ops-snowcat', 11 * 60, 634, -314, 2.1, 13, 0.42);
await look('ops-mine', 13 * 60, -358, -224, 2.1, 15, 0.36);
await look('ops-exploder', 10 * 60, -112, -474, 2.1, 11, 0.36);
await look('ops-fence', 10 * 60, -100, -502, 2.1, 12, 0.4);
await look('ops-sign', 13 * 60, -133, -36, 0.35, 10, 0.16);
const info = await page.evaluate(() => window.patrol.info());
console.log(JSON.stringify({ info, problems: problems.slice(0, 20) }));
await browser.close();
