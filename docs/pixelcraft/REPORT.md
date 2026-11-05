# PIXELCRAFT pass: keyboard, touch feedback, pause panel (2026-11-05)

Baseline: commit `aaebfb4` (main, the code live at https://rockslide-game.vercel.app/ before this work).
Final: commit `6e94054` on `claude/pixelcraft-z31mwy`. PIXELCRAFT method `pixelcraft-1.0` in every run: headless
Chromium 153, software WebGL, six emulated viewports (iPhone 17 402×874, iPhone 13 390×844, desktop 1440×900,
narrow, tablet, landscape), four screens (title, in-game HUD, map, pause), three journeys (start a patrol, open and
close the map, pause and resume).

**Everything here is browser emulation. Nothing was tested on a physical phone, in WebKit/Safari, or with a screen
reader.**

## What changed for the player

| | Change | Before |
|---|---|---|
| 1 | A keyboard-only player can start the game: Tab focuses Start/Continue, Enter or Space presses it | Once the valley had loaded, Tab (the map key) was swallowed on the title, nothing could take focus, and the game could not be started without a mouse or touch |
| 2 | Panels take focus when they open and keep Tab inside them; Enter/Space press the focused button and never leak into the game | In Pause, Tab wandered to the HUD buttons hidden behind the panel; "Back to patrol" could not be reached with Tab |
| 3 | Every button shows a press immediately (darker, sinks 1 px, 97 %), including on touch; hover on mouse; a cyan 2 px focus ring | The HUD map, Koda and pause buttons and the panels' buttons did not change at all when pressed or hovered; the focus ring was the browser's faint 1 px default |
| 4 | Pause settings toggles are 44 px tall (the minimum every other control meets) | 34 px, 4 px apart |
| 5 | "Back to patrol" is pinned to the bottom of the Pause panel; Save and quit / Start over stay at the end of the list | (After change 4) the list grew taller than a phone and pushed the way back to the game below the fold |
| 6 | Panel close button 44 px; title spacing on the 4 px scale; wrapped labels (the keys line) at 1.45 line height | 40 px; 10/14 px gaps; 1.2 |

Unchanged, on purpose: Tab and M still open and close the map in play; Esc/P still pause; the HUD layout, the title
card, the map and the 3D view are untouched. No game logic, physics or saves changed.

`scripts/keyboard.cjs` checks 1-3 in a real browser (`keyboard-before.json`, `keyboard-after.json`).

## Scores

`pixelcraft_verify` replays the baseline's exact screens, viewports and journeys and compares only metrics measured in
both runs (588 metrics):

| Category | Baseline (`aaebfb4`) | Final (`6e94054`) | Change |
|---|---|---|---|
| Visual Quality | 78.8 | 84.1 | +5.3 |
| Usability | 50.3 | 74.5 | +24.2 |
| Consistency | 73.2 | 76.8 | +3.6 |
| **Overall** | **67.4** | **78.5** | **+11.1** |

Confidence: **low** in every run (axe-core did not run; the 3D canvas is not described by the DOM; emulation only).

Resolved: no pressed state (7 occurrences), journey cannot be completed (4), touch target too small (10), controls too
close (6), cramped line height (6). New findings: none. Regressions: none.

**Verify status: FAILED, on one coverage check**: `type.readability` on the HUD in landscape was measured in the
baseline but not in the final run. That metric needs multi-line text on screen, and the only such text on that screen
is the DISPATCH radio line, which changes with the game clock. The same metric is also missing from the fonts-enabled
audit of the unchanged baseline build (`fonts-before`), so it is the probe catching a different moment, not something
this change removed. It is reported, not waived.

An earlier verify on `ae8950e` found two regressions; both were dealt with before this run:
- *Pressed treatment applied consistently* 78 % → 60 %: the Pause toggles were the last buttons without a press
  state. Fixed in `5f37a66` (one shared state list for every kind of button).
- *Layout stability* on map @ landscape 100 % → 81 %: the same build scored 100 % in a second run, and the baseline
  itself varies between 76 % and 100 % on other landscape screens, so this is run-to-run noise. It does not appear in
  the final verify.

### Historical measurements (kept, not overwritten)

All runs are in the append-only PIXELCRAFT history (`~/.gitcraft/pixelcraft/history/rockslide/`):

| Run | Build | Screens | Overall | V / U / C | Note |
|---|---|---|---|---|---|
| `20261105T142522Z-audit` | `aaebfb4` | title, HUD | 75.8 | 88.5 / 59.5 / 79.3 | first pass; map and pause were not reached (the start step looked for "Start your patrol", the button said "Continue") |
| `20261105T143808Z-audit` | `aaebfb4` | all four | 67.4 | 78.8 / 50.3 / 73.2 | **the baseline used for verify** |
| `20261105T163300Z-verify` | `6e94054` | all four | 78.5 (comparable) | 84.1 / 74.5 / 76.8 | final verify |

The 75.8 and 67.4 are not a regression: the 67.4 run sees two more screens (map, pause) and their defects.

### With web fonts loaded

The verify runs block every request outside the app (Jost, Courier Prime and IBM Plex Mono come from Google Fonts),
so text was measured in fallback fonts. Both builds were audited again with `fonts.googleapis.com` and
`fonts.gstatic.com` allowed (0 requests blocked):

| | Baseline build, fonts on | Final build, fonts on |
|---|---|---|
| Visual Quality | 79.0 | 84.1 |
| Usability | 62.5 | 81.2 |
| Consistency | 72.5 | 78.0 |
| Overall | 71.3 | 81.1 |
| Findings | 15 | 10 |

Layout with real fonts: no new overflow, clipping or spacing findings appear in either build. The title layout shift
on iPhone 17 (CLS 0.12) is the same with and without fonts, so fonts do not cause it (see *Design tradeoffs*).
These are separate audits, not a verify; their usability numbers also differ from the verify because the journeys ran
at a different moment. Reports: `fonts-before-report.md`, `fonts-after-report.md`.

## Keyboard, focus and touch (`scripts/keyboard.cjs`)

Chromium, desktop 1440×900 for keys; iPhone 13 profile with real CDP touch events for touch.

| Check | Baseline | Final |
|---|---|---|
| Title: Tab focuses Start | pass in the Enter run, **fail** in the Space run (once the game is loaded, Tab is swallowed) | pass |
| Title: focus ring visible | browser default, 1 px | 2 px cyan |
| Title: Enter starts the patrol | pass (only in the run where Tab got through) | pass |
| Title: Space starts the patrol | **fail** | pass |
| Play: Tab opens the map; Tab again closes it | pass | pass |
| Play: Esc opens Pause | pass | pass |
| Pause: "Back to patrol" reachable with Tab, ring visible | **fail** | pass |
| Pause: Tab stays inside the panel (30 presses) | **fail** (left the panel on 30 of 30) | pass |
| Pause: Space on "Back to patrol" resumes | not reached | pass |
| Touch: HUD Map chip and pause button change while held | **fail** (no change) | pass (brightness 0.82, scale 0.97) |
| Touch: they let go on release | pass | pass |

Baseline 8/16 (one check could not run), final 17/17.

Also checked separately, with the iPhone safe areas emulated through CDP: scrolled to the bottom, every Pause button
ends above the home indicator (iPhone 17: lowest button at 815 px, limit 840; landscape: 356, limit 381), and tapping
the pinned "Back to patrol" resumes in both orientations.

## Every finding, classified

**Defect**: objectively broken. **Design tradeoff**: intentional, with a reason. **Unverified risk**: cannot be
measured reliably here.

| Finding (baseline count) | Class | Status and reason |
|---|---|---|
| Keyboard cannot start the game; Tab escapes panels (found by `keyboard.cjs`, not by PIXELCRAFT) | Defect | **Fixed** (`631b4e7`) |
| No pressed state (7) | Defect | **Fixed**: delegated `.down` on pointerdown, because iOS Safari does not apply `:active` to a tap without a touch listener and the HUD buttons consume their pointerdown |
| No hover state (3) | Defect | **Fixed** except one: the round action button (Pet Koda) has no hover change. Open, polish |
| Touch target too small (10): Pause toggles 34 px, close 40 px | Defect | **Fixed** (44 px) |
| Controls too close (6): toggles 4 px apart | Defect (at 34 px) | **Fixed**: at 44 px the 4 px gap is a normal segmented control |
| Cramped line height (6): the keys line at 1.2 | Defect | **Fixed** (1.45) |
| Spacing off the 4 px scale (11) | Defect, minor | **Partly fixed**: the title now uses 16/12; the map card still uses 6/10/14 px (7 left). Open, polish |
| Back to patrol below the fold on phones (introduced by the 44 px toggles) | Defect (ours) | **Fixed** (`4df1081`) |
| Dead-end screen (12): title and HUD have no nav or back | Design tradeoff | A game's title card has one way in; in play the map and pause buttons are the navigation. Adding links would make it a web page |
| Main action at the top of the phone (12): pause and close top-right | Design tradeoff | Pause is the least-used control and top-right is where players look for it; the actions used all the time (action button, Map, Koda) are bottom-right under the thumb |
| Excessive empty gap (5) | Design tradeoff | The empty band is the 3D view |
| Control covered by another element (12): HUD under the map/pause panel | Design tradeoff | The panels are modal on purpose; the HUD behind them is not meant to be tappable |
| Content disappears at one size (2): title paragraph on short landscape | Design tradeoff | Hidden so the wordmark, lodge and Start fit 390 px of height; nothing needed to play is hidden |
| Layout jumps while loading (1): title @ iPhone 17, CLS 0.12 | Design tradeoff | Traced with a layout-shift observer: the shift is the loading card collapsing into the slim progress strip at the top as the title card starts to rise. The title's button is not visible yet, so nothing moves under a thumb. Same with web fonts on |
| Too many button variants (6) | Design tradeoff | Heights now 44 / 48 / 88 (were 32 / 40 / 44 / 48 / 88): 88 is the round action button and 48-50 the HUD chips, a deliberate hierarchy for a game HUD |
| Uneven spacing in Pause (6) | Design tradeoff | The larger gaps are the section breaks (above "Assists" and the keys line) |
| Bottom controls under the home indicator (3 → 7) | Unverified risk (probe) | The probe measures rows of a scrolling list without scrolling. Measured separately with the safe areas emulated: scrolled into view, every button sits above the home indicator. More occurrences now because the pinned button pushes the end of the list lower |
| Journey cannot be completed (4) | Unverified risk (probe) | Baseline clicks timed out while the screen was fully drawn and nothing covered the button; under software WebGL, frames are slow and the probe's "stable element" wait times out. Resolved in the final run, and the journeys pass in `keyboard.cjs` with real waits; still emulation |
| HUD readability @ landscape (coverage) | Unverified risk | Depends on which DISPATCH line is on screen (see above) |

## Accessibility: what was and was not tested

- **axe-core did not run.** It is not installed in the GITCRAFT Studio runtime, so no WCAG rule checks (contrast,
  names, roles, ARIA) ran in any audit. Accessibility scores rest on target sizes, the Tab walk and focus visibility only.
- **The 3D canvas is not measured.** Everything drawn in WebGL (the valley, the player, mission markers, the radio
  line's backdrop) is invisible to DOM metrics and to any accessibility tool. Only the HTML overlay (title, HUD, panels)
  was measured.
- **No screen reader** (VoiceOver, TalkBack, NVDA) was used. Buttons have names (the pause button has
  `aria-label="Pause"`; map zoom buttons have labels), but an icon-only control was not heard.
- **Keyboard**: verified in Chromium for the title, map toggle and Pause. Not verified: the mission board, the station
  shop, the debrief and the incoming-call card, where Enter/Space should now press the focused button, by the same code.
- **Touch** was emulated with CDP touch events in Chromium. iOS Safari's `:active` behaviour was the reason for the
  `.down` class, but it was not observed on an iPhone.
- **Reduced motion**: the new press transitions are disabled under `prefers-reduced-motion`; this was not measured.

## Exact results

| Command | Result |
|---|---|
| `npm run typecheck` (part of `npm run check`) | exit 0, no errors |
| `npm run test` | 23 test files, 156 tests passed |
| `npm run build` | built (`dist/assets/index-DWu4pLB8.js`, `index-CmaXZIfW.css`) |
| `npm run check` | exit 0 |
| `node scripts/keyboard.cjs` on the final build | 17/17 passed, exit 0 |
| `pixelcraft_verify` against the 67.4 baseline | scores above; 0 regressions, 0 new findings; status **failed** on one coverage check (HUD readability @ landscape) |
| `pixelcraft_audit`, fonts on, baseline and final builds | ok, ok |

A passing build only proves the code compiles. The production deployment is checked separately, after merge,
against these asset hashes.

Tooling note: PIXELCRAFT's evidence-crop step crashed on an element below the visible screen (the pinned button
pushes rows under the fold). The crop was patched locally in the GITCRAFT runtime
(`studio/departments/pixelcraft/report.py`: such an element gets a whole-screen evidence image). Scoring and
measurement are unchanged (method `pixelcraft-1.0`), and nothing was written to the GITCRAFT repo.

## Files

- `verify-report.md`, `verify-comparison.json`: the final verify
- `baseline-report.md`: the 67.4 baseline audit
- `fonts-before-report.md`, `fonts-after-report.md`: the fonts-enabled audits
- `keyboard-before.json`, `keyboard-after.json`: `scripts/keyboard.cjs` results
- `evidence/contact-before.jpg`, `evidence/contact-after.jpg`: every screen at every viewport
- `evidence/pause-before-after.jpg`: Pause on iPhone 17, before and after (scrolled to the end)
