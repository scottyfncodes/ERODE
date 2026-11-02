import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [url, out] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 640, height: 400 } })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.erode, null, { timeout: 120000 });
for (const z of (process.env.ZONES ?? 'summit,forest,falls,rapids,delta,beach').split(',')) {
  await page.evaluate((z) => window.erode.look(z), z);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}-${z}.png`, timeout: 120000 });
}
await browser.close();
