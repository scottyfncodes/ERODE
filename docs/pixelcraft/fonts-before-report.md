# PIXELCRAFT audit: ROCKSLIDE

Target: `/home/user/ROCKSLIDE/gitcraft-out/builds/baseline` · method pixelcraft-1.0 · 2026-11-05T15:45:31+00:00 · commit `ae8950e397`

## 1. Overall PIXELCRAFT score: **71.3** / 100 (fair)

Evidence coverage 100% · confidence **low** — axe-core did not run; canvas-rendered screens: the DOM does not describe what is drawn; browser emulation only (no physical-device evidence)

Coverage and confidence are reported separately from quality: an area with no evidence is *not tested*, never zero and never capped.

## 2. Category scores

| Category | Score | Coverage | Not tested |
|---|---|---|---|
| Visual Quality | **79** | 100% | — |
| Usability | **62.5** | 100% | — |
| Consistency | **72.5** | 100% | — |

### Visual Quality

| Area | Points | Awarded | Evidence | Weakest metric |
|---|---|---|---|---|
| Spacing and rhythm | 25 | 14.8 | measured ×69 | related elements evenly spaced (30%) |
| Layout and composition | 25 | 22.6 | measured ×120 | controls not covered by other elements (70%) |
| Typography and hierarchy | 20 | 16.7 | measured ×82 | headings stand out from body text (43%) |
| Buttons and controls | 20 | 16.4 | measured ×96 | neighbouring targets not crowded (54%) |
| Visual consistency | 10 | 8.5 | measured ×42 | few font families (82%) |

### Usability

| Area | Points | Awarded | Evidence | Weakest metric |
|---|---|---|---|---|
| Interaction efficiency | 25 | 25 | measured ×18 | journeys complete (100%) |
| Navigation and discoverability | 20 | 8 | measured ×19 | navigation stays in the same place on every screen (0%) |
| Mobile ergonomics | 25 | 23.4 | measured ×78 | main actions within thumb reach (80%) |
| Feedback and interaction states | 15 | 6.1 | measured ×22 | controls react to hover (0%) |
| Accessibility | 15 | 0 | measured ×4 | controls reachable with Tab (0%) |

### Consistency

| Area | Points | Awarded | Evidence | Weakest metric |
|---|---|---|---|---|
| Cross-screen consistency | 25 | 16.2 | measured ×12 | primary buttons look the same on every screen (50%) |
| Component consistency | 25 | 19 | measured ×6 | few button variants (76%) |
| Responsive consistency | 20 | 15.3 | measured ×8 | the same content at every size (30%) |
| Design system adherence | 20 | 16.7 | measured ×24 | spacing tokens (4-px grid) (66%) |
| State consistency | 10 | 5.2 | measured ×3 | hover treatment applied consistently (50%) |

## 3. Strongest screens

- **title** — 93.2
- **hud** — 90.0

## 4. Weakest screens

- **pause** — 80.1
- **map** — 89.5

## 5. Critical usability defects

### No pressed (active) state — major · Measured (rendered DOM)

Pressing this control changes nothing visually until the action completes; on touch screens there is no hover, so this is the only immediate confirmation of a tap.

**Fix:** Add an :active style (darker tone, scale 0.97, or ripple) to every button and link variant.

Seen 7× — screens: hud, map, pause, title; viewports: desktop, iphone17 · priority 14.75 (fix now)

- `div.title-screen:nth-of-type(1) > div.inner > div.row:nth-of-type(3) > button.btn.red` on title @ iphone17: style_changed_when_pressed=false
- `#ui > div.hud > div.cond:nth-of-type(2) > button.iconbtn` on hud @ iphone17: style_changed_when_pressed=false
- `div.hud > div.actions:nth-of-type(3) > div.side:nth-of-type(1) > button.chip:nth-of-type(1)` on hud @ iphone17: style_changed_when_pressed=false
### Dead-end screen — major · Measured (rendered DOM)

Screen 'title' has no link, tab or back/close control: the only way out is the browser.

**Fix:** Give every screen persistent navigation or a visible back/close control.

Seen 12× — screens: hud, title; viewports: desktop, iphone13, iphone17, landscape, narrow, tablet · priority 14.74 (fix now)

- `—` on title @ iphone17: exits=0
- `—` on hud @ iphone17: exits=0
- `—` on title @ iphone13: exits=0
### Bottom controls sit under the home indicator — major · Measured (rendered DOM)

With the iPhone's 34-px bottom safe area emulated, this fixed control extends 52 px into the home-indicator zone, where swipes go to the system instead of the app.

**Fix:** Pad fixed bottom bars with env(safe-area-inset-bottom): padding-bottom: calc(8px + env(safe-area-inset-bottom)).

Seen 3× — screens: pause; viewports: iphone13, iphone17, landscape · priority 8.72 (next)

- `div.panel > div.body > div:nth-of-type(12) > button.btn.ghost:nth-of-type(2)` on pause @ iphone17: safe_area_bottom_px=34, overlap_px=52
- `div.panel > div.body > div:nth-of-type(12) > button.btn.ghost:nth-of-type(3)` on pause @ iphone17: safe_area_bottom_px=34, overlap_px=104
- `div.panel > div.body > div:nth-of-type(12) > button.btn:nth-of-type(1)` on pause @ iphone13: safe_area_bottom_px=34, overlap_px=15

## 6. Spacing and layout defects

### Uneven spacing between related elements — major · Measured (rendered DOM)

Items of the same kind in one list or stack are separated by different gaps, which reads as grouping that isn't there and makes the list look broken.

**Fix:** Give the container one gap (flex/grid `gap`, or one margin rule for all items) instead of per-item margins.

Seen 6× — screens: pause; viewports: desktop, iphone13, iphone17, landscape, narrow, tablet · priority 13.44 (fix now)

- `#ui > div.panel-wrap.enter:nth-of-type(2) > div.panel > div.body` on pause @ iphone17: gaps_px=[0, 0, 0, 0, 0, 14, 0, 0, 13], spread_px=14
- `#ui > div.panel-wrap.enter:nth-of-type(2) > div.panel > div.body` on pause @ iphone13: gaps_px=[0, 0, 0, 0, 0, 14, 0, 0, 13], spread_px=14
- `#ui > div.panel-wrap.enter:nth-of-type(2) > div.panel > div.body` on pause @ desktop: gaps_px=[0, 0, 0, 0, 0, 14, 0, 0, 11], spread_px=14
### Spacing does not follow a consistent scale — minor · Measured (rendered DOM)

Paddings, gaps and margins use many unrelated values, so the rhythm between elements looks accidental rather than designed.

**Fix:** Adopt a spacing scale (4/8-px steps: 4, 8, 12, 16, 24, 32) as tokens and replace one-off values with the nearest step.

Seen 11× — screens: map, title; viewports: desktop, iphone13, iphone17, landscape, narrow, tablet · priority 9.29 (fix now)

- `—` on title @ iphone17: on_scale_share=0.45, distinct_values=6, off_scale_values_px=[10, 14, 86, 62]
- `—` on map @ iphone17: on_scale_share=0.66, distinct_values=13, off_scale_values_px=[6, 10, 14]
- `—` on title @ iphone13: on_scale_share=0.55, distinct_values=6, off_scale_values_px=[10, 14, 62]
### Paragraph line height is cramped — minor · Measured (rendered DOM)

Multi-line text uses a 1.20 line-height ratio; below 1.3 lines crowd each other and reading slows.

**Fix:** Use line-height 1.4-1.6 for body text.

Seen 6× — screens: pause; viewports: desktop, iphone13, iphone17, landscape, narrow, tablet · priority 8.96 (next)

- `div.panel-wrap.enter:nth-of-type(2) > div.panel > div.body > div.label:nth-of-type(11)` on pause @ iphone17: line_height_ratio=1.2
- `div.panel-wrap.enter:nth-of-type(2) > div.panel > div.body > div.label:nth-of-type(11)` on pause @ iphone13: line_height_ratio=1.2
- `div.panel-wrap.enter:nth-of-type(2) > div.panel > div.body > div.label:nth-of-type(11)` on pause @ desktop: line_height_ratio=1.2
### Excessive empty gap between sections — minor · Measured (rendered DOM)

A 719-px band with no content separates sections — more than 40% of the screen height — so users may think the page ended.

**Fix:** Reduce the gap to the section spacing used elsewhere, or fill it intentionally (imagery, a section heading).

Seen 4× — screens: hud, map, pause; viewports: desktop, tablet · priority 7.0 (next)

- `#ui > div.hud > div.stack:nth-of-type(1) > div.radio.housing:nth-of-type(5)` on hud @ desktop: empty_gap_px=719, viewport_height=900
- `#ui > div.hud:nth-of-type(1) > div.stack:nth-of-type(1) > div.radio.housing:nth-of-type(5)` on map @ desktop: empty_gap_px=735, viewport_height=900
- `#ui > div.hud:nth-of-type(1) > div.stack:nth-of-type(1) > div.radio.housing:nth-of-type(5)` on pause @ desktop: empty_gap_px=735, viewport_height=900
### Layout jumps while the screen loads — minor · Measured (rendered DOM)

Cumulative layout shift 0.12 (Chromium's layout-shift entries; 0.1 is the 'good' limit): content moves under the user's thumb as images, fonts or data arrive.

**Fix:** Reserve space for late content (width/height or aspect-ratio on media, skeletons with final sizes, font-display with metric overrides).

Seen 1× — screens: title; viewports: iphone17 · priority 1.49 (polish)

- `—` on title @ iphone17: cls=0.1214, shifts=1

## 7. Button and control defects

### No pressed (active) state — major · Measured (rendered DOM)

Pressing this control changes nothing visually until the action completes; on touch screens there is no hover, so this is the only immediate confirmation of a tap.

**Fix:** Add an :active style (darker tone, scale 0.97, or ripple) to every button and link variant.

Seen 7× — screens: hud, map, pause, title; viewports: desktop, iphone17 · priority 14.75 (fix now)

- `div.title-screen:nth-of-type(1) > div.inner > div.row:nth-of-type(3) > button.btn.red` on title @ iphone17: style_changed_when_pressed=false
- `#ui > div.hud > div.cond:nth-of-type(2) > button.iconbtn` on hud @ iphone17: style_changed_when_pressed=false
- `div.hud > div.actions:nth-of-type(3) > div.side:nth-of-type(1) > button.chip:nth-of-type(1)` on hud @ iphone17: style_changed_when_pressed=false
### A control is covered by another element — major · Measured (rendered DOM)

Tapping the centre of this control hits a different element (often a fixed bar or floating button), so the control is hard or impossible to use.

**Fix:** Reserve space for fixed/floating elements (padding-bottom on the scroll area equal to their height) or move the floating element.

Seen 12× — screens: map, pause; viewports: desktop, iphone13, iphone17, landscape, narrow, tablet · priority 14.74 (fix now)

- `#ui > div.hud:nth-of-type(1) > div.cond:nth-of-type(2) > button.iconbtn` on map @ iphone17: covered_by="div.panel-wrap.enter:nth-of-type(2) > div.panel.mappanel > header > button.x"
- `div.hud:nth-of-type(1) > div.actions:nth-of-type(3) > div.side:nth-of-type(1) > button.chip:nth-of-type(1)` on map @ iphone17: covered_by="div.panel.mappanel > div.body > div.mapcard > div.mapview:nth-of-type(1)"
- `div.hud:nth-of-type(1) > div.actions:nth-of-type(3) > div.side:nth-of-type(1) > button.chip:nth-of-type(2)` on map @ iphone17: covered_by="div.panel.mappanel > div.body > div.mapcard > div.mapview:nth-of-type(1)"
### Touch target is too small — minor · Measured (rendered DOM)

40×40 px: under the 44×44 pt Apple HIG minimum (24 px is the WCAG 2.2 floor); thumbs miss and hit neighbours.

**Fix:** Enlarge the hit area to 44×44 (padding, min-height/min-width, or an ::after hit-area) while keeping the visible glyph size.

Seen 10× — screens: map, pause; viewports: iphone13, iphone17, landscape, narrow, tablet · priority 12.25 (fix now)

- `div.panel-wrap.enter:nth-of-type(2) > div.panel.mappanel > header > button.x` on map @ iphone17: width_px=40, height_px=40, minimum_px=44
- `div.body > div.setrow:nth-of-type(1) > div.seg > button.on:nth-of-type(1)` on pause @ iphone17: width_px=45, height_px=34, minimum_px=44
- `div.body > div.setrow:nth-of-type(1) > div.seg > button:nth-of-type(2)` on pause @ iphone17: width_px=46, height_px=34, minimum_px=44
### No hover state — minor · Measured (rendered DOM)

The pointer over this control changes nothing (colour, shadow, underline), so it does not signal that it is clickable.

**Fix:** Add a hover style (tone shift, underline, elevation) for every interactive component variant.

Seen 3× — screens: hud, map, pause; viewports: desktop · priority 5.82 (next)

- `#ui > div.hud > div.cond:nth-of-type(2) > button.iconbtn` on hud @ desktop: style_changed_on_hover=false
- `#ui > div.hud > div.actions:nth-of-type(3) > button.act.pop` on hud @ desktop: style_changed_on_hover=false
- `div.panel-wrap.enter:nth-of-type(2) > div.panel.mappanel > header > button.x` on map @ desktop: style_changed_on_hover=false

## 8. Mobile-specific findings

### Touch target is too small — minor · Measured (rendered DOM)

40×40 px: under the 44×44 pt Apple HIG minimum (24 px is the WCAG 2.2 floor); thumbs miss and hit neighbours.

**Fix:** Enlarge the hit area to 44×44 (padding, min-height/min-width, or an ::after hit-area) while keeping the visible glyph size.

Seen 10× — screens: map, pause; viewports: iphone13, iphone17, landscape, narrow, tablet · priority 12.25 (fix now)

- `div.panel-wrap.enter:nth-of-type(2) > div.panel.mappanel > header > button.x` on map @ iphone17: width_px=40, height_px=40, minimum_px=44
- `div.body > div.setrow:nth-of-type(1) > div.seg > button.on:nth-of-type(1)` on pause @ iphone17: width_px=45, height_px=34, minimum_px=44
- `div.body > div.setrow:nth-of-type(1) > div.seg > button:nth-of-type(2)` on pause @ iphone17: width_px=46, height_px=34, minimum_px=44
### Main action is at the top of the phone screen — minor · Measured (rendered DOM)

The primary action sits in the top fifth of a tall phone screen, the hardest zone to reach one-handed.

**Fix:** Repeat or move the main action to the lower half (a bottom action bar or floating button).

Seen 12× — screens: hud, map, pause; viewports: iphone13, iphone17, narrow, tablet · priority 9.82 (fix now)

- `#ui > div.hud > div.cond:nth-of-type(2) > button.iconbtn` on hud @ iphone17: centre_y_share=0.11
- `#ui > div.hud:nth-of-type(1) > div.cond:nth-of-type(2) > button.iconbtn` on map @ iphone17: centre_y_share=0.11
- `div.panel-wrap.enter:nth-of-type(2) > div.panel.mappanel > header > button.x` on map @ iphone17: centre_y_share=0.12
### Controls are too close together — minor · Measured (rendered DOM)

'On' and 'Off' are 4 px apart and at least one is under 44 px: an easy mis-tap.

**Fix:** Keep at least 8 px between targets (more next to destructive actions), or merge rarely used actions into one overflow menu.

Seen 6× — screens: pause; viewports: desktop, iphone13, iphone17, landscape, narrow, tablet · priority 8.96 (next)

- `div.body > div.setrow:nth-of-type(1) > div.seg > button.on:nth-of-type(1)` on pause @ iphone17: gap_px=4, neighbour="div.body > div.setrow:nth-of-type(1) > div.seg > button:nth-of-type(2)"
- `div.body > div.setrow:nth-of-type(2) > div.seg > button.on:nth-of-type(1)` on pause @ iphone17: gap_px=4, neighbour="div.body > div.setrow:nth-of-type(2) > div.seg > button:nth-of-type(2)"
- `div.body > div.setrow:nth-of-type(3) > div.seg > button:nth-of-type(1)` on pause @ iphone17: gap_px=4, neighbour="div.body > div.setrow:nth-of-type(3) > div.seg > button.on:nth-of-type(2)"
### Bottom controls sit under the home indicator — major · Measured (rendered DOM)

With the iPhone's 34-px bottom safe area emulated, this fixed control extends 52 px into the home-indicator zone, where swipes go to the system instead of the app.

**Fix:** Pad fixed bottom bars with env(safe-area-inset-bottom): padding-bottom: calc(8px + env(safe-area-inset-bottom)).

Seen 3× — screens: pause; viewports: iphone13, iphone17, landscape · priority 8.72 (next)

- `div.panel > div.body > div:nth-of-type(12) > button.btn.ghost:nth-of-type(2)` on pause @ iphone17: safe_area_bottom_px=34, overlap_px=52
- `div.panel > div.body > div:nth-of-type(12) > button.btn.ghost:nth-of-type(3)` on pause @ iphone17: safe_area_bottom_px=34, overlap_px=104
- `div.panel > div.body > div:nth-of-type(12) > button.btn:nth-of-type(1)` on pause @ iphone13: safe_area_bottom_px=34, overlap_px=15
### Content disappears at one screen size — minor · Measured (rendered DOM)

At landscape, 'title' shows only 24% of the words other sizes show; hidden content on phones is a common source of 'where did it go?'.

**Fix:** Reflow content instead of hiding it; move secondary content behind a disclosure rather than display: none.

Seen 2× — screens: hud, title; viewports: iphone17, landscape · priority 3.1 (polish)

- `—` on title @ landscape: word_share=0.24
- `—` on hud @ iphone17: word_share=0.44
### Layout jumps while the screen loads — minor · Measured (rendered DOM)

Cumulative layout shift 0.12 (Chromium's layout-shift entries; 0.1 is the 'good' limit): content moves under the user's thumb as images, fonts or data arrive.

**Fix:** Reserve space for late content (width/height or aspect-ratio on media, skeletons with final sizes, font-display with metric overrides).

Seen 1× — screens: title; viewports: iphone17 · priority 1.49 (polish)

- `—` on title @ iphone17: cls=0.1214, shifts=1

## 9. Screenshot gallery

Browser emulation (Playwright + Chromium); safe-area insets emulated through CDP. No physical-device evidence.

- title @ iphone17: 
- hud @ iphone17: 
- map @ iphone17: 
- pause @ iphone17: 
- title @ iphone13: 
- hud @ iphone13: 
- map @ iphone13: 
- pause @ iphone13: 
- title @ desktop: 
- hud @ desktop: 
- map @ desktop: 
- pause @ desktop: 
- title @ narrow: 
- hud @ narrow: 
- map @ narrow: 
- pause @ narrow: 
- title @ tablet: 
- hud @ tablet: 
- map @ tablet: 
- pause @ tablet: 
- title @ landscape: 
- hud @ landscape: 
- map @ landscape: 
- pause @ landscape: 

## 10. Prioritised improvement plan

| # | Tier | Fix | Severity | Seen | Cost | Area |
|---|---|---|---|---|---|---|
| 1 | fix now | **No pressed (active) state** — Add an :active style (darker tone, scale 0.97, or ripple) to every button and link variant. | major | 7× | low | feedback |
| 2 | fix now | **A control is covered by another element** — Reserve space for fixed/floating elements (padding-bottom on the scroll area equal to their height) or move the floating element. | major | 12× | medium | controls |
| 3 | fix now | **Dead-end screen** — Give every screen persistent navigation or a visible back/close control. | major | 12× | medium | navigation |
| 4 | fix now | **Uneven spacing between related elements** — Give the container one gap (flex/grid `gap`, or one margin rule for all items) instead of per-item margins. | major | 6× | low | spacing |
| 5 | fix now | **Touch target is too small** — Enlarge the hit area to 44×44 (padding, min-height/min-width, or an ::after hit-area) while keeping the visible glyph size. | minor | 10× | low | controls |
| 6 | fix now | **Main action is at the top of the phone screen** — Repeat or move the main action to the lower half (a bottom action bar or floating button). | minor | 12× | medium | mobile |
| 7 | fix now | **Spacing does not follow a consistent scale** — Adopt a spacing scale (4/8-px steps: 4, 8, 12, 16, 24, 32) as tokens and replace one-off values with the nearest step. | minor | 11× | medium | spacing |
| 8 | next | **Controls are too close together** — Keep at least 8 px between targets (more next to destructive actions), or merge rarely used actions into one overflow menu. | minor | 6× | low | mobile |
| 9 | next | **Paragraph line height is cramped** — Use line-height 1.4-1.6 for body text. | minor | 6× | low | typography |
| 10 | next | **Bottom controls sit under the home indicator** — Pad fixed bottom bars with env(safe-area-inset-bottom): padding-bottom: calc(8px + env(safe-area-inset-bottom)). | major | 3× | low | mobile |
| 11 | next | **Excessive empty gap between sections** — Reduce the gap to the section spacing used elsewhere, or fill it intentionally (imagery, a section heading). | minor | 4× | low | spacing |
| 12 | next | **Too many button variants** — Define 2-3 button sizes and 3 emphasis levels (primary, secondary, tertiary) as one component and use it everywhere. | minor | 6× | medium | component |
| 13 | next | **No hover state** — Add a hover style (tone shift, underline, elevation) for every interactive component variant. | minor | 3× | low | feedback |
| 14 | polish | **Content disappears at one screen size** — Reflow content instead of hiding it; move secondary content behind a disclosure rather than display: none. | minor | 2× | medium | responsive |
| 15 | polish | **Layout jumps while the screen loads** — Reserve space for late content (width/height or aspect-ratio on media, skeletons with final sizes, font-display with metric overrides). | minor | 1× | medium | layout |

## Journeys

| Journey | Viewport | Result | Taps | Expected | Confirmations | Feedback (ms) |
|---|---|---|---|---|---|---|
| start a patrol | iphone17 | ok | 1 | 1 | 0 | 1610 |
| open and close the map | iphone17 | ok | 2 | 3 | 0 | 1261, 1917 |
| pause and resume | iphone17 | ok | 2 | 3 | 0 | 1517, 1640 |
| start a patrol | desktop | ok | 1 | 1 | 0 | 1829 |
| open and close the map | desktop | ok | 2 | 3 | 0 | 1763, 1359 |
| pause and resume | desktop | ok | 2 | 3 | 0 | 1994, 1768 |

## Evidence and limits

- Every viewport is browser emulation (Playwright + Chromium 153.0.8010.12); iPhone sizes are CSS pixels and safe-area insets are emulated through CDP (Emulation.setSafeAreaInsetsOverride). Safari-specific rendering (WebKit), the real on-screen keyboard and physical reach are not reproduced.
- Browser chrome: the first screen is re-measured with the viewport shortened by 120 px (Safari's toolbars); dynamic toolbar collapse is not reproduced.
- Keyboard interference: fields that would zoom on focus (font-size < 16 px) are measured; whether the on-screen keyboard covers a field is not testable in emulation.
- Hover/pressed/focus states are sampled once per visual variant of control; focus visibility comes from real Tab presses (desktop).
- Canvas-drawn interfaces (games): the DOM does not describe what is drawn, so DOM-geometry metrics cover only the HTML overlay (HUD, menus); use judgements for the canvas.
- No physical-device evidence: findings are emulation results, not device results.
- axe-core is not installed in the Studio runtime: accessibility rules did not run (scripts/install-studio.sh).
