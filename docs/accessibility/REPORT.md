# Accessibility pass (2026-11-05)

Baseline: `main` at `f9af323` (the code live at https://rockslide-game.vercel.app/). After: this branch.
Same audit both times: `scripts/a11y.ts`, axe-core 4.10.3 (WCAG 2.0 / 2.1 / 2.2 A and AA, plus best practice)
on eight screens (title, HUD, pause, map, mission table: calls / station / log, wardrobe) at iPhone 13
(390 x 844, touch) and desktop (1440 x 900), plus 35 scripted checks. Headless Chromium, software WebGL.
Full output: [`before/a11y.md`](before/a11y.md), [`after/a11y.md`](after/a11y.md) (and `.json`).

## Automated findings

| axe rule | Before (nodes, all 16 captures) | After | What it was |
|---|---|---|---|
| `color-contrast` (serious) | 143 | **0** | Locked mission rows, station buildings and shop items were drawn at 45-50% opacity, which took every line of their text under 4.5:1. The small "from" label on the paper brief card was #7a6a58 on cream (just under 4.5:1) |
| `region` (moderate, best practice) | 194 | **0** | Nothing on the page was inside a landmark |
| `meta-viewport` (critical) | 16 | 16 | `user-scalable=no`: kept on purpose, see below |

| Scripted check | Before | After |
|---|---|---|
| All 35 | 21 pass | **35 pass** |
| Radio and toasts announced (live regions) | ❌ | ✅ |
| Pause (every panel) is a modal dialog with a name | ❌ | ✅ |
| Pause toggles expose which option is on | ❌ | ✅ |
| Mission table tabs are a tab list with the open tab marked | ❌ | ✅ |
| The chosen call is marked as selected | ❌ | ✅ |
| Mission table controls 44 x 44 px on a phone (tabs were 34 px) | ❌ | ✅ |
| Mission table text at least 12 px (11 and 11.5 px before) | ❌ | ✅ |
| Reduced motion turns the camera shake and buffet down | ❌ | ✅ |
| Keyboard: Tab to Start, Enter starts, Tab stays in pause, Esc closes, mission table opens with E | ✅ | ✅ |
| Visible focus ring | ✅ | ✅ |
| No console or page errors | ✅ | ✅ |

## What changed

- Panels (`src/ui/panels.ts` `shell()`): `role="dialog"`, `aria-modal="true"`, named by their title. When a panel
  closes, focus goes back to where it was, except to a HUD button: in play the keyboard drives the game, and a
  focused chip would let Enter open things mid-ride (PIXELCRAFT caught that in an earlier build of this change).
- Tabs on the mission table and in the shops: `role="tablist"` / `role="tab"` / `aria-selected`. Pause toggles:
  `role="group"` with the setting's name, `aria-pressed` on each option. The chosen call: `aria-pressed`.
- HUD (`src/ui/hud.ts`): the radio is a polite `log`, toasts a polite `status`, the objective polite, the incoming
  call an assertive `alertdialog`.
- `index.html`: a `main` landmark; the 3D view is a labelled image; the loading card is a labelled `status`;
  the floating touch stick is `aria-hidden`.
- Locked rows and items: a dashed open card with quiet (muted-token) text instead of fading the whole card.
- Tabs 44 px; the 11 / 11.5 px labels are 12 px.
- Reduced motion (`src/game/camera.ts`): no handheld breathing or wind buffet, shake at a quarter. The CSS
  already stopped the panel and button animations.

The look is the same storybook card stock: no new colours, no new tokens; every colour used is already in
`src/ui/style.css :root`.

## Kept on purpose

- **`meta-viewport` (`user-scalable=no, maximum-scale=1`).** The map and the mission table's map own the pinch
  gesture, and a page zoom on a phone mid-play leaves the stick, the action button and the HUD off screen. Text is
  never below 12 px and the UI scales with the viewport. axe still reports it, and we report it here.

## Not tested (manual verification still needed)

- **No screen reader was used** (VoiceOver, TalkBack, NVDA). The roles, names and live regions are verified in the
  DOM; how they are actually spoken, and whether the radio's polite announcements are too chatty in play, is not.
- **The 3D view** (the valley, beacons, Koda, the avalanche) is a WebGL canvas: no automated tool can audit it.
  It has a label; what is drawn in it is not described. Mission state, objectives and the radio are text.
- **Colour contrast inside the canvas** (beacons and pins on snow) is not measured.
- **Real devices.** All of this is Chromium emulation. iOS Safari, Android Chrome and switch / voice control were
  not run. The prior iPhone Safari playtest covers touch.
- **Reduced motion on a device**: checked by emulating `prefers-reduced-motion` in Chromium, not with the OS setting.
- **Keyboard on the debrief and the incoming-call card**: they use the same dialog and button code as the
  panels that were tested, but were not walked with Tab in this audit.
