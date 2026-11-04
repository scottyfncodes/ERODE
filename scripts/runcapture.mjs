// The patroller running in the real game, on a phone: real touch on the stick (DevTools touch), the
// game's own camera, frames grabbed while running, braking and setting off again. For checking the
// gait, the boot prints and the footfall puffs in play, not in the lab.
// Usage: node scripts/runcapture.mjs <url> <outprefix>
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const [url = 'http://127.0.0.1:4173/', out = 'out/run'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(m.text()));
await page.goto(url);
await page.waitForFunction(() => window.patrol, null, { timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.patrol, null, { timeout: 120000 });
await page.waitForTimeout(800);
await page.click('[data-a=new]');
await page.waitForTimeout(1500);
// out on the open snow below the station, the camera side-on
await page.evaluate(() => {
  window.patrol.setTime(11 * 60);
  window.patrol.teleport(40, 200, Math.PI / 2);
});
await page.waitForTimeout(1500);
const cdp = await ctx.newCDPSession(page);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })) });
const vp = page.viewportSize();
// left thumb down on the left of the screen, pushed fully up: a run
const sx = vp.width * 0.2;
const sy = vp.height * 0.7;
await touch('touchStart', [[sx, sy]]);
await touch('touchMove', [[sx, sy - 20]]);
await touch('touchMove', [[sx, sy - 70]]);
const speeds = [];
const track = [];
for (let i = 0; i < 16; i++) {
  await page.waitForTimeout(220);
  const st = await page.evaluate(() => window.patrol.state());
  speeds.push(+st.fps);
  track.push(await page.evaluate(() => window.patrol.actor()));
  await page.screenshot({ path: `${out}-${String(i).padStart(2, '0')}.png` });
}
// let go: the stop
await touch('touchEnd', []);
for (let i = 16; i < 22; i++) {
  await page.waitForTimeout(150);
  track.push(await page.evaluate(() => window.patrol.actor()));
  await page.screenshot({ path: `${out}-${String(i).padStart(2, '0')}.png` });
}
console.log(JSON.stringify({ fps: speeds, errors }));
for (const t of track) console.log(Object.entries(t).map(([k, v]) => `${k} ${(+v).toFixed(2)}`).join('  '));
await browser.close();
