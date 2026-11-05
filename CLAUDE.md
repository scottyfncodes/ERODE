# ROCKSLIDE: notes for Claude Code

## Visual direction: the art bible is canonical

`art/kessel-art-bible.pdf` (edition 2.1, built from `art/bible/`) is the visual reference for every
DesignCraft, PixelCraft, PLAYCRAFT and Claude Code task. Before any visual, UI, asset or marketing
work, check the relevant pages; page 19 is the checklist for new assets.

- Two layers: a **storybook interface** (aubergine/burgundy card stock, cream paper, the CSS tokens in
  `src/ui/style.css :root`) over a **Colorado high-country world** (kit colours in
  `src/render/kit.ts` passed through `grade()`). Do not mix them.
- Type: Jost, Courier Prime and IBM Plex Mono only, in the jobs the bible gives them.
- Retired, never reintroduce: dark slate housings (#141C24, #1D2731), Inter / Inter Display /
  JetBrains Mono, the plum print grade, pastels in the 3D world, pure black or neon.
- When the game changes how it looks, rebuild the bible in the same pull request:
  `node art/bible/capture.mjs`, `npx tsx art/bible/tokens.ts > art/bible/tokens.json`,
  `python3 art/bible/build_bible.py` (see `art/bible/build_bible.py`). `tests/art-direction.test.ts`
  fails if the stylesheet tokens or rendered world colours drift from the bible.

## Checks

`npm run check` (typecheck, tests, build) must pass before a pull request.
