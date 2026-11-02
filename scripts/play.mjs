// Drive a real run in a browser and screenshot it.
// Usage: node scripts/play.mjs <url> <outprefix> [mobile] ; env LEVEL, SIDES (e.g. "left,right,left"), SHOTS (seconds between shots)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [url, out, mobile] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForFunction(() => window.rockslide, null, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}-0title.png` });
if (process.env.LEVEL) {
  await page.evaluate(() => window.rockslide.unlockAll());
  await page.evaluate((id) => window.rockslide.load(id), process.env.LEVEL);
  await page.waitForTimeout(1500);
} else await page.evaluate(() => window.rockslide.begin());
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}-1ready.png` });
await page.evaluate(() => window.rockslide.release());
const FAST = !!process.env.FAST;
if (FAST) await page.evaluate(() => window.rockslide.fast(true));
let lastSeg = '';
let segShotAt = 0;
const sides = (process.env.SIDES ?? 'left,right,left').split(',');
let shot = 0;
let lastFrom = '';
let k = 0;
const t0 = Date.now();
while (Date.now() - t0 < Number(process.env.MAXMS ?? 240000)) {
  const st = await page.evaluate(() => {
    const r = window.rockslide;
    const d = r.decision;
    return { state: r.state, dec: d && { from: d.from, chosen: d.chosen, t: d.timeLeft }, cam: r.camInfo() };
  });
  if (st.state !== 'run') break;
  if (st.dec && st.dec.from !== lastFrom) {
    lastFrom = st.dec.from;
    if (FAST) await page.evaluate(() => window.rockslide.fast(false));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}-d${k}a.png` });
    await page.evaluate((s) => window.rockslide.choose(s), sides[k % sides.length]);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}-d${k}b.png` });
    k++;
    if (FAST) await page.evaluate(() => window.rockslide.fast(true));
  }
  if (st.cam.seg && st.cam.seg !== lastSeg) {
    lastSeg = st.cam.seg;
    segShotAt = Date.now() + Number(process.env.SEGDELAY ?? 6000);
  }
  if (segShotAt && Date.now() > segShotAt) {
    segShotAt = 0;
    await page.screenshot({ path: `${out}-s-${lastSeg}.png` });
    console.log('seg', lastSeg, JSON.stringify(st.cam), JSON.stringify(await page.evaluate(() => window.rockslide.renderInfo())));
  }
  if (Date.now() - t0 > (shot + 1) * Number(process.env.SHOTS ?? 9000)) {
    shot++;
    await page.screenshot({ path: `${out}-r${String(shot).padStart(2, '0')}.png` });
    console.log('shot', shot, JSON.stringify(st.cam), JSON.stringify(await page.evaluate(() => window.rockslide.renderInfo())));
  }
  await page.waitForTimeout(150);
}
await page.screenshot({ path: `${out}-8end.png` });
await page.waitForTimeout(5000);
await page.screenshot({ path: `${out}-8recap.png` });
await page.evaluate(() => window.rockslide.results());
await page.waitForTimeout(3500);
await page.screenshot({ path: `${out}-9results.png` });
const r = await page.evaluate(() => { const r = window.rockslide.result; return r && { reason: r.reason, total: r.score.total, route: r.route.join('>'), dur: r.duration }; });
console.log('result', JSON.stringify(r), 'real s', ((Date.now() - t0) / 1000).toFixed(0));
console.log(logs.slice(0, 30).join('\n'));
await browser.close();
