// title → start (straight into the run) → a few run frames → results
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [url, out, mobile] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 900, height: 560 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.rockslide, null, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}-title.png`, timeout: 120000 });
await page.evaluate(() => window.rockslide.begin());
for (const i of [1, 2, 3]) {
  await page.waitForTimeout(Number(process.env.RUNWAIT ?? 6000));
  await page.screenshot({ path: `${out}-run${i}.png`, timeout: 120000 });
}
await page.evaluate(() => window.rockslide.finishNow());
await page.waitForTimeout(6000);
await page.screenshot({ path: `${out}-results.png`, timeout: 120000 });
await browser.close();
