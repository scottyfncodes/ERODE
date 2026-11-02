// Renders the ROCKSLIDE icons and share image from public/icons/icon.svg and public/favicon.svg.
// usage: node scripts/brand-assets.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const icon = readFileSync('public/icons/icon.svg', 'utf8');
const fav = readFileSync('public/favicon.svg', 'utf8');
const b64 = (s) => `data:image/svg+xml;base64,${Buffer.from(s).toString('base64')}`;
const browser = await chromium.launch();

async function shot(html, w, h, out) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:#16181b}</style></head><body>${html}</body></html>`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out, omitBackground: false });
  await page.close();
}
const img = (src, w, h, style = '') => `<img src="${src}" width="${w}" height="${h}" style="display:block;${style}">`;

await shot(img(b64(icon), 512, 512), 512, 512, 'public/icons/icon-512.png');
await shot(img(b64(icon), 192, 192), 192, 192, 'public/icons/icon-192.png');
await shot(img(b64(icon), 180, 180), 180, 180, 'public/icons/apple-touch-icon.png');
// maskable: art is full-bleed with the boulder inside the safe zone
await shot(img(b64(icon), 512, 512), 512, 512, 'public/icons/icon-maskable-512.png');
await shot(img(b64(fav), 32, 32), 32, 32, 'public/icons/favicon-32.png');

// share card (1200×630)
const wm = (t) => `<div class="wm"><span class="t">${t}</span><span class="b">${t}</span></div>`;
await shot(
  `<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&display=swap" rel="stylesheet">
  <style>
    .card{position:relative;width:1200px;height:630px;overflow:hidden;font-family:Archivo,sans-serif;color:#f3ecdf}
    .art{position:absolute;right:-120px;top:-160px;width:900px;height:900px}
    .shade{position:absolute;inset:0;background:linear-gradient(90deg,#16181b 0%,#16181b 50%,rgba(22,24,27,.5) 66%,transparent 80%)}
    .copy{position:absolute;left:72px;top:190px}
    .wm{position:relative;display:inline-block;font-weight:900;font-stretch:125%;font-size:112px;line-height:.9;letter-spacing:-.012em;transform:skewX(-7deg);filter:drop-shadow(0 5px 0 #0f1012) drop-shadow(0 18px 30px rgba(0,0,0,.55));padding:0 .06em .04em 0}
    .wm span{display:block;color:transparent;-webkit-background-clip:text;background-clip:text}
    .t{background-image:linear-gradient(180deg,#fffaf0,#ece4d5 34%,#c3baab 62%,#9b9285);clip-path:polygon(0 0,100% 0,100% 34%,0 70%)}
    .b{position:absolute;inset:0;padding:inherit;background-image:linear-gradient(180deg,#f6d488,#e2b06f 46%,#b97b3f);clip-path:polygon(0 70%,100% 34%,100% 100%,0 100%);transform:translate(.045em,.05em)}
    .tag{margin-top:26px;font-weight:800;font-stretch:87%;font-size:30px;letter-spacing:.12em;text-transform:uppercase;color:#f6d488}
    .sub{margin-top:12px;font-size:24px;color:rgba(243,236,223,.8)}
    .bar{position:absolute;left:0;right:0;bottom:0;height:10px;background:linear-gradient(90deg,#bdb5a7 0 62%,#e0672e 62%)}
  </style>
  <div class="card">${img(b64(icon), 760, 760, 'position:absolute;right:-330px;top:-90px;-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 28%);mask-image:linear-gradient(90deg,transparent 0,#000 28%)')}<div class="shade"></div>
  <div class="copy">${wm('ROCKSLIDE')}<div class="tag">Keep it together. Get to the bottom.</div><div class="sub">Plan your descent. Break your path. Survive the mountain.</div></div><div class="bar"></div></div>`,
  1200,
  630,
  'public/og-image.png',
);
await browser.close();
console.log('brand assets written');
