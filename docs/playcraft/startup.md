# Startup: before and after

Measured 2026-11-05 on the production builds, served locally, in headless Chromium with **software WebGL** (SwiftShader)
and the iPhone 13 device profile (390x844 at 3x). Each run is a fresh page with an empty save. "Tap" is a touch on
Start the moment the title card is fully risen (opacity over 0.9). "Play begins" is the HUD up and the card gone.
"Worst frame" is the longest frame in the first 2 s of play.

| Build | CPU | Title card fully visible | Play begins | Worst frame, first 2 s of play | Runs |
|---|---|---|---|---|---|
| Live (main, 9d17740) | normal | 4.6 s (3.6-11.0) | 10.6 s (9.3-11.3) | 591 ms (474-639) | 4 |
| This branch | normal | **0.89 s** (0.84-0.89) | **2.66 s** (2.53-2.66) | 568 ms (414-617) | 4 |
| Live (main, 9d17740) | 4x slower | 7.5 s (6.7-7.5) | 16.4 s (8.5-16.4) | 635 ms, and 5,815 ms in the run where the map stall landed in play | 2 |
| This branch | 4x slower | **2.6 s** (2.6-2.6) | **6.7 s** (6.7-6.7) | 612-906 ms | 2 |

Medians, ranges in brackets. 0 page errors in every run. On this branch an early tap shows "Getting the valley ready" on
the button (seen in 4 of 4 normal-speed runs; at 4x the valley was ready before the card had finished rising) and play starts by itself when the valley is up.

## Where the time went (live build)

1. Fonts (up to 1.5 s wait), then the GLB models (~0.2-0.4 s).
2. The valley built in one synchronous block (1.0-1.4 s at normal CPU).
3. Two frames of the valley, compiling every shader on the way (0.8-2.3 s here).
4. Only then the title card, rising in over 1.15 s.
5. About a second later, one 6.4-6.9 s frame: the sharp 1536 px map finishing on a GPU-backed 2D canvas (upload, ~200 clipped
   strokes, read-back for the PNG). In the live build it lands on the title card, which is why the card took up to 10 s
   to finish rising here.

## What changed

- The title card goes up as soon as the fonts are in, over the loading backdrop (`src/ui/title.ts`, `src/main.ts`).
- `Game.build()` builds the valley in stages and hands the main thread back between them.
- Where the browser has `KHR_parallel_shader_compile`, `renderer.compileAsync()` compiles the shaders in parallel while the
  card is up; without it (this software renderer, so not in these numbers) the first frames behind the card compile them,
  as before.
- A tap before the valley is ready is kept and play begins when it is up (sound unlocked inside that tap, for iOS).
- The sharp map draws on a CPU-backed canvas (`willReadFrequently`), which removes step 5 here.

## Read this with care

- Software rendering makes every frame and canvas operation far slower than on a phone's GPU. The **6.5 s stall in step 5
  is probably much smaller on real hardware**, so the live build's 10 s here overstates what players see. Without it the
  live title would have been fully up at roughly 3.5-5 s here, against 0.9 s now.
- The worst frame in the first seconds of play did not get better or worse beyond the run-to-run spread.
- **Not measured: any real device.** Time to title and to play on an actual iPhone (Safari) and Android phone, and whether
  `compileAsync` runs in parallel there (it needs `KHR_parallel_shader_compile`), are still to be checked on hardware.
