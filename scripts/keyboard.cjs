// Usage: npx vite preview --port 4173 & node scripts/keyboard.cjs http://localhost:4173/ out.json
// Exits 0 only when every check passes. Browser emulation (Playwright Chromium), not a physical device.
// Keyboard navigation, focus visibility, Enter/Space activation and touch press feedback.
const { chromium, devices } = require('playwright');
const URL = process.argv[2] || 'http://localhost:4173/';
const out = []; const rec = (name, ok, detail) => { out.push({ name, ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : '')); };
const ready = (p) => p.waitForFunction(() => { const b = document.querySelector('.title-screen .btn.red'); return b && !b.classList.contains('busy') && !document.getElementById('loading')?.offsetParent; }, null, { timeout: 60000 }).catch(() => {});
const focusInfo = (p) => p.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const cs = getComputedStyle(e); return { tag: e.tagName, text: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 30), outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, visible: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 1 }; });
const titleGone = (p) => p.waitForFunction(() => !document.querySelector('.title-screen'), null, { timeout: 15000 }).then(() => true).catch(() => false);
(async () => {
  const browser = await chromium.launch();
  for (const key of ['Enter', 'Space']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
    await p.goto(URL); await ready(p); await p.waitForTimeout(1500);
    await p.keyboard.press('Tab'); const f = await focusInfo(p);
    rec(`title: Tab focuses a control (${key} run)`, !!f && f.tag === 'BUTTON', f && `${f.tag} "${f.text}"`);
    rec(`title: focus ring visible (${key} run)`, !!f && f.visible, f && f.outline);
    await p.keyboard.press(key); rec(`title: ${key} on focused button starts the patrol`, await titleGone(p));
    if (key === 'Enter') { await p.waitForTimeout(5000);
      await p.waitForTimeout(3000);
      let map = false, ms = 0; const t0 = Date.now();
      // one press per attempt, and a long wait: frames are slow under software WebGL, and a second Tab would close the map
      for (let i = 0; i < 4 && !map; i++) { await p.keyboard.press('Tab'); map = await p.waitForSelector('.panel-wrap', { timeout: 8000 }).then(() => true).catch(() => false); }
      ms = Date.now() - t0;
      rec('play: Tab still opens the map', map, `first worked ${ms} ms after the 5 s settle`);
      if (map) {
        await p.waitForTimeout(1000); await p.keyboard.press('Tab');
        await p.waitForFunction(() => !document.querySelector('.panel-wrap'), null, { timeout: 8000 }).catch(() => {});
        rec('map: Tab again closes it (Tab/M toggle the map by design)', !(await p.$('.panel-wrap')));
      }
      await p.waitForTimeout(1500); await p.keyboard.press('Escape'); const pause = await p.waitForSelector('.panel-wrap', { timeout: 8000 }).then(() => true).catch(() => false);
      rec('play: Escape opens pause', pause);
      if (pause) {
        await p.waitForTimeout(600);
        let hit = null; for (let i = 0; i < 40; i++) { await p.keyboard.press('Tab'); const f2 = await focusInfo(p); if (f2 && /back to patrol/i.test(f2.text)) { hit = f2; break; } }
        rec('pause: "Back to patrol" reachable with Tab', !!hit, hit && hit.outline);
        rec('pause: focus ring visible on "Back to patrol"', !!hit && hit.visible, hit && hit.outline);
        const escaped = []; for (let i = 0; i < 30; i++) { await p.keyboard.press('Tab'); const inside = await p.evaluate(() => !!document.activeElement?.closest('.panel-wrap')); if (!inside) escaped.push(i); }
        rec('pause: Tab stays inside the panel (30 presses)', escaped.length === 0, escaped.length ? `left the panel on ${escaped.length} presses` : '');
        for (let i = 0; i < 40; i++) { const f3 = await focusInfo(p); if (f3 && /back to patrol/i.test(f3.text)) break; await p.keyboard.press('Tab'); }
        if (hit) { await p.keyboard.press('Space'); await p.waitForFunction(() => !document.querySelector('.panel-wrap'), null, { timeout: 8000 }).catch(() => {}); rec('pause: Space on "Back to patrol" resumes', !(await p.$('.panel-wrap'))); }
      }
    }
    await ctx.close();
  }
  // touch: a real CDP touch on the HUD chip, held, then released
  const ctx = await browser.newContext({ ...devices['iPhone 13'] }); const p = await ctx.newPage();
  await p.goto(URL); await ready(p); await p.waitForTimeout(1500); await p.tap('.title-screen .btn.red'); await titleGone(p); await p.waitForTimeout(6000);
  const cdp = await ctx.newCDPSession(p);
  for (const sel of ['.hud .chip:not(.hidden)', '.hud .iconbtn']) {
    const el = await p.$(sel); if (!el) { rec(`touch: ${sel} present`, false); continue; }
    const b = await el.boundingBox(); const x = b.x + b.width / 2, y = b.y + b.height / 2;
    const before = await el.evaluate((e) => getComputedStyle(e).filter + '|' + getComputedStyle(e).transform);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await p.waitForTimeout(600);
    const during = await el.evaluate((e) => getComputedStyle(e).filter + '|' + getComputedStyle(e).transform);
    const cls = await el.evaluate((e) => e.classList.contains('down'));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p.waitForTimeout(400);
    const after = await el.evaluate((e) => e.classList.contains('down') + '|' + getComputedStyle(e).filter);
    rec(`touch: ${sel} changes while held`, before !== during && cls, `${before} → ${during} (.down=${cls})`);
    rec(`touch: ${sel} lets go on release`, after.startsWith('false'), after);
    await p.keyboard.press('Escape'); await p.waitForTimeout(300); if (await p.$('.panel-wrap')) { await p.keyboard.press('Escape'); await p.waitForTimeout(300); }
  }
  await browser.close();
  require('fs').writeFileSync(process.argv[3] || 'kb.json', JSON.stringify(out, null, 1));
  process.exit(out.every((r) => r.ok) ? 0 : 1);
})();
