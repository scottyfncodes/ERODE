// Usage: node scripts/levels.mjs <url> <outdir> <level...> — planning + descent screenshots per level (phone size)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [url, out, ...levels] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await page.goto(url);
await page.waitForFunction(() => window.erode, null, { timeout: 120000 });
await page.evaluate(() => window.erode.unlockAll());
for (const id of levels) {
  await page.evaluate((l) => window.erode.load(l), id);
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.erode.snapCamera());
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.erode.routes());
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${id}-plan.png`, timeout: 180000 });
  await page.evaluate(() => window.erode.release());
  await page.waitForTimeout(9000);
  await page.screenshot({ path: `${out}/${id}-run.png`, timeout: 180000 });
  await page.evaluate(() => window.erode.finishNow());
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.erode.mountains());
  await page.waitForTimeout(500);
}
console.log('errors:', errs.slice(0, 10).join('\n'));
await browser.close();
