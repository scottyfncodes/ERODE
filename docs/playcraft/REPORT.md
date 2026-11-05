# PLAYCRAFT pass: evidence, assists, startup (2026-11-05)

Baseline: commit `5e57e37` (the code live at https://rockslide-game.vercel.app/ before this work), PLAYCRAFT 80/100,
confidence low. Same PLAYCRAFT probe and method before and after (headless Chromium, software WebGL, desktop + iPhone 13).

## What changed

| | Change | Why |
|---|---|---|
| 1 | `scripts/playthrough.ts`: every mission end to end on the production build, with a report (`evidence/`) | Most categories rested on source keywords only |
| 2 | `window.game`: a read-only, frozen snapshot of the live game | The probe could not see the game's state change |
| 3 | Assists in the pause menu, all off by default: helicopter hover and landing, sled hill hold, route line | Nothing for a player who gets stuck |
| 4 | Title card up at once; the valley builds behind it in stages; an early tap is kept | The card only appeared after the whole build |
| 4b | The sharp map draws on a CPU-backed canvas | One 6.4-6.9 s frame about a second after load (found while measuring 4) |

Gameplay, physics, controls and the look are unchanged with the assists off: `stepHeli` and `stepGlider` produce
step-for-step identical results to before (`tests/assists.test.ts`).

## Scores

Two verify runs against the same baseline, so the effect of the game changes and the effect of the new evidence can be told
apart:

| Category | Baseline | After: game changes only (same evidence as the baseline) | After: with the playthrough, test report and playtest notes |
|---|---|---|---|
| Core gameplay | 83 | 85 | 90 |
| Game feel | 79 | 79 | 81 |
| Controls and responsiveness | 85 | 85 | 87 |
| Progression and rewards | 70 (capped: inferred only) | 70 | 80 |
| Difficulty and balance | 68 | 70 | 85 |
| Player experience | 79 | 79 | 82 |
| Replayability | 70 (capped: inferred only) | 70 | 81 |
| Technical gameplay quality | 90 | 90 | 92 |
| Presentation and immersion | 83 | 83 | 83 |
| Mobile experience | 95 | 95 | 95 |
| **Overall** | **80, low confidence** | **81, low** | **85, medium** (strong evidence 29% → 43%) |

Resolved: *Assist / difficulty options*; *Game state advances during play* (now verified: heading, Koda's distance, the clock
and position change while playing, read from `window.game`). New findings: none. Regressions: none. Guardrails: no source
deleted, no deployment settings, secrets or data touched, on a branch.

The jump from 81 to 85 is mostly evidence, not new gameplay: the same game, measured in play instead of guessed from the
source. PLAYCRAFT keeps its source-only checks alongside the new evidence, which is why most categories are still at
"medium" or "low" confidence rather than "high".

## Verified in play

- `docs/playcraft/evidence/playthrough.md`: **84/84 checks** in 487 s. All six story missions and both callouts, each paying
  its advertised reward; rank Recruit → Lead patroller; the workshop built from the mission table; the Mountain 800 bought
  and measured faster (speed after 60 m from a standstill, two runs each); Koda leading on both scent trails (on the line
  once on it) and finding a badge from 20 m; quit mid-mission, reload, Continue restores it; the bunk ends the day with a new
  forecast; no firing while on the slab; hit-stop and the vibration request on the blast; every step's objective on the HUD;
  0 page or console errors. 59 real key inputs (19 holds) and 31 clicks; 125 travel shortcuts (teleports) and 2 callout-timer
  shortcuts, counted in the report.
- `npm run check`: typecheck, **156/156 tests**, build. 14 new tests: assists (11), snapshot (3).
- `scripts/verify.mjs` (the release check): **PASS** on 5 iPhone sizes, upright and on their side.
- Startup, `docs/playcraft/startup.md`: title card up at 0.89 s (live 4.6 s), play begins at 2.66 s after an early tap
  (live 10.6 s), the worst frame in the first 2 s of play unchanged within the spread; at 4x CPU throttle 2.6 s / 6.7 s
  (live 7.5 s / 16.4 s).

PLAYCRAFT's own "time to play" figure (load + its start sequence, which includes about 1.8 s of the probe's fixed waits)
went 4.2 → 4.7 s, inside the 4.2-5.6 s it has measured for the unchanged baseline code. Its 3 s target stays open on that
measure.

## Not tested (honestly)

- **Real-device frame rate.** Every number here comes from software WebGL. Frame rate, and how long the first frames and
  the shader compile take, on an actual iPhone (Safari) and Android phone are not measured. Whether those phones take the
  parallel shader compile path (`KHR_parallel_shader_compile`) is not known.
- **iPhone Safari itself.** All runs are Chromium. Title card, early tap and sound unlock in Safari: not run.
- **The long journeys by hand.** The playthrough teleports between places, so what a ride up the pass road or a flight
  across the valley feels like over an hour is not measured. Nor is where the game gets repetitive.
- **Haptics on a phone.** Observed as a request to `navigator.vibrate`, not felt. iPhone Safari has no vibration API.
- **The assists in a player's hands.** Tested in the simulation (unit tests) and seen in the menu and on the snow, but not
  flown, driven or followed by a person.
