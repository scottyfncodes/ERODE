// Usage: node scripts/shot.mjs <url> <outprefix> [mobile]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [url, out, mobile] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 800) } });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForFunction(() => window.erode, null, { timeout: 120000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}-title.png`, timeout: 120000 });
const steps = (process.env.STEPS ?? 'plan').split(',');
await page.evaluate(() => window.erode.begin());
await page.waitForTimeout(500);
await page.evaluate(() => window.erode.snapCamera());
await page.waitForTimeout(Number(process.env.PLANWAIT ?? 2000));
await page.screenshot({ path: `${out}-plan.png`, timeout: 120000 });
if (steps.includes('select')) {
  await page.evaluate(() => window.erode.select('log-a'));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}-select.png`, timeout: 120000 });
  await page.evaluate(() => window.erode.select(null));
}
if (steps.includes('run')) {
  if (process.env.PLAN) await page.evaluate((p) => window.erode.setPlan(JSON.parse(p)), process.env.PLAN);
  await page.evaluate(() => window.erode.release());
  for (const t of [1, 2, 3]) {
    await page.waitForTimeout(Number(process.env.RUNWAIT ?? 3000));
    await page.screenshot({ path: `${out}-run${t}.png`, timeout: 120000 });
  }
  await page.evaluate(() => window.erode.fast());
  await page.waitForFunction(() => window.erode.result !== null || false, null, { timeout: 180000 }).catch(() => {});
  for (let i = 0; i < 60; i++) { const st = await page.evaluate(() => document.querySelector('.results.show') ? 1 : 0); if (st) break; await page.waitForTimeout(1000); }
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}-results.png`, timeout: 120000 });
  console.log('result', JSON.stringify(await page.evaluate(() => { const r = window.erode.result; return r && { success: r.success, delivered: r.deliveredFraction, fractures: r.fractures.length, dest: r.destination }; })));
  if (steps.includes('replay')) {
    await page.evaluate(() => window.erode.replay());
    await page.waitForTimeout(6000);
    await page.screenshot({ path: `${out}-replay.png`, timeout: 120000 });
  }
}
console.log(logs.slice(0, 30).join('\n'));
await browser.close();
