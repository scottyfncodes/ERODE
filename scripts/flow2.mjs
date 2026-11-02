// Usage: node scripts/flow2.mjs <url> <outdir> [level] [plan-json]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [url, out, level, plan] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const shot = (n) => page.screenshot({ path: `${out}/${n}.png`, timeout: 120000 });
await page.goto(url);
await page.waitForFunction(() => window.erode, null, { timeout: 120000 });
await page.waitForTimeout(2500);
await shot('1-title');
await page.evaluate(() => window.erode.unlockAll());
await page.evaluate(() => window.erode.mountains());
await page.waitForTimeout(800);
await shot('2-mountains');
await page.evaluate((l) => window.erode.load(l ?? 'pine-hollow'), level);
await page.waitForTimeout(2500);
await page.evaluate(() => window.erode.snapCamera());
await page.waitForTimeout(1500);
await shot('3-plan');
await page.evaluate(() => window.erode.routes());
await page.waitForTimeout(800);
await shot('4-routes');
const firstObj = await page.evaluate(() => window.erode.plan && Object.keys(window.erode.plan)[0]);
if (firstObj) {
  await page.evaluate((id) => window.erode.select(id), firstObj);
  await page.waitForTimeout(1200);
  await shot('5-select');
  await page.evaluate(() => window.erode.select(null));
}
await page.click('.comp-pick');
await page.waitForTimeout(500);
await shot('6-comps');
await page.click('.comp-sheet .close-x');
if (plan) await page.evaluate((p) => window.erode.setPlan(JSON.parse(p)), plan);
await page.evaluate(() => window.erode.release());
for (const t of [1, 2, 3]) {
  await page.waitForTimeout(Number(process.env.RUNWAIT ?? 3500));
  await shot(`7-run${t}`);
}
await page.evaluate(() => window.erode.finishNow());
for (let i = 0; i < 40; i++) { if (await page.evaluate(() => !!document.querySelector('.results.show'))) break; await page.waitForTimeout(500); }
await page.waitForTimeout(2500);
await shot('8-results');
console.log(JSON.stringify(await page.evaluate(() => { const r = window.erode.result; return r && { finished: r.finished, retained: r.retained, medal: r.medal, cause: r.cause }; })));
console.log(logs.filter((l) => !l.includes('GPU stall') && !l.includes('WebGL')).slice(0, 30).join('\n'));
await browser.close();
