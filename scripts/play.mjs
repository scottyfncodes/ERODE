// Drive the game in a real browser and screenshot the key scenes (QA).
// Usage: node scripts/play.mjs <url> <outprefix> [portrait]
// Uses the window.patrol debug handle to jump between places; controls are real key and touch input.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [url = 'http://localhost:5173/', out = 'out/patrol', portrait] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const size = portrait ? { width: 390, height: 844 } : { width: 844, height: 390 };
const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForFunction(() => window.patrol, null, { timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.patrol, null, { timeout: 120000 });
await page.waitForTimeout(1000);
await page.screenshot({ path: `${out}-0title.png` });
await page.click('[data-a=new]');
await page.waitForTimeout(1000);
const P = (f, a) => page.evaluate(f, a);
const hold = async (k, ms) => {
  await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  await page.keyboard.up(k);
};
const shot = async (name, at, wait = 1200) => {
  if (at) await P(at.f, at.a);
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${out}-${name}.png` });
};
await shot('1lodge');
await shot('2yard', { f: () => window.patrol.teleport(10, 236, 0.3) });
// the board
await P(() => window.patrol.teleport(-28, 247.8, 0));
await hold('KeyE', 100);
await shot('3board', null, 600);
await P(() => window.patrol.closePanel());
// the sled up the pass road
await P(() => window.patrol.sledTo(-150, -60));
await P(() => window.patrol.teleport(-150, -58, 0));
await page.waitForTimeout(500);
await hold('KeyE', 100);
await page.keyboard.down('KeyW');
await shot('4sled', null, 3000);
await page.keyboard.up('KeyW');
await hold('KeyX', 100);
// recon from the helicopter
await P(() => window.patrol.complete('rounds'));
await P(() => window.patrol.accept('survey'));
await P(() => window.patrol.teleport(-20.5, 292, Math.PI / 2));
await page.waitForTimeout(500);
await hold('KeyE', 100);
await P(() => window.patrol.heliTo(-175, -335, 380));
await P(() => window.patrol.camYaw(0));
await shot('5recon', null, 2500);
console.log(JSON.stringify(await P(() => window.patrol.state())));
console.log(logs.join('\n') || 'no page errors');
await browser.close();
