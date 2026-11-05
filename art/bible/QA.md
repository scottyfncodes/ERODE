# Art bible, edition 2: visual review

The review of `art/kessel-art-bible.pdf` before it shipped. Every page was rendered and read at full
size (1200 x 800) in two renderers: DesignCraft's own (`export_png`) and Poppler (`pdftoppm`, from
the exported PDF). The two agree on every page (mean pixel difference 1.6 to 4.3 out of 255,
anti-aliasing only). `qa-contact-sheet.jpg` is the Poppler render of all 20 pages.

## Automated checks (every build)

- Fonts: all nine files match their pinned SHA-256 (`fonts.json`); DesignCraft's `font.list`
  reports every face `exact`, none substituted. `pdffonts` lists seven embedded, subset faces:
  Jost Regular, Medium, SemiBold, Bold; Courier Prime Regular; IBM Plex Mono Medium, SemiBold.
  No fallback face appears anywhere.
- Text: no story is overset (`inspect_document`); the build fails if one is.
- Images: every capture the layout names exists (`cap()` fails otherwise); 41 captures, 2 derived
  crops, 2 shipped assets (the emblem, the share card).
- Colour: every value on pages 4, 5, 11, 12 and 17 comes from `tokens.json`, which `tokens.ts`
  reads from `src/ui/style.css`, `src/render/kit.ts` (through `grade()`), `src/render/rig.ts`,
  `huskyMesh.ts`, `missionProps.ts`, `catalog.ts` and `game.ts`. `tests/art-direction.test.ts`
  fails if the stylesheet or the rendered world colours move away from it.

## Page by page

Found in the first full render, fixed, and checked again in the final render:

| Page | Checked | Found and fixed |
| --- | --- | --- |
| 1 Cover | Hero crop, wordmark legibility over the fade, inset rule, emblem | Nothing to fix |
| 2 How to use | Precedence, tag legend, contents | Numbered list carried a bullet as well as a number; legend lacked the "shipped asset" tag |
| 3 Direction | Two-layer split, both exemplar images | Mission-table crop cut its title off (now top-aligned); a dead band under the bullets; the chapter frame described as "cream-on-ink" (it is ink on blush) |
| 4 Colour: interface | Every swatch against `:root`, chapter tones against `.chapter.tone-*` | `--slate` in running text read as a dash (Jost's tight hyphens): CSS properties are now set in Plex Mono |
| 5 Colour: world | Rendered values against `grade()`; ungraded light kept apart | Snow-pole tip first listed as ungraded (it goes through `mat()`, so it renders #D38851); empty space now holds a capture of the grade at work |
| 6 Typography | Specimens, weights, sizes and tracking against the stylesheet | The wordmark crop showed sky, not the wordmark (the title sets it in the lower third): now an exact crop of the capture; it overlapped the footer |
| 7 Shapes | Specimen numbers against `.panel`, `.chip`, `.btn`, `.tab`, `.act`, `.chapter .frame` | Panel shadow cast up and left (light angle); tab labels were capitals (the game uses sentence case); button labels replaced with the game's own |
| 8 Interface 1 | Title and table captures, phone frames | Heading collided with a caption; unbalanced grid; title description said the wordmark sits "over" the lodge |
| 9 Interface 2 | HUD captures on foot, sled, helicopter, phone | Helicopter frame ran into the footer; copy said "no compass ribbon" (there is one, top centre) |
| 10 Interface 3 | Mission HUD, map, pause, wardrobe | Nothing to fix |
| 11 Vince | Close-ups against `setLook()` defaults | Spec said a red and cream beanie and a cream yoke: the default is a charcoal beanie with a mustard band, amber goggles and charcoal trim; "never black outerwear" contradicted the wardrobe's Night shift jacket; heading collided with captions |
| 12 Koda and Hollin | Koda and villager colours against the code | Lineup first captured with the villagers facing away and Koda out of frame (retaken); text overlapped the cast image |
| 13 Station | Lodge, interior, yard, pad | Lodge crop clipped the chimney; yard caption collided with the footer |
| 14 Valley | Aerials and ground view | Ground captures of Hollin's chapel, the pass road and the lake were inside the forest: replaced by aerials (the helicopter hidden, tagged staged) |
| 15 Light | Four times, one camera; sky ramp against `rig.ts` | Captions described sky colours that are out of frame: now they describe what is visible |
| 16 Weather | Four states, forecast | Snow and storm differ only a little in these frames: captions now state the forecast for each; the forecast crop overlapped the footer |
| 17 Wayfinding | Beacon, sign, route line, machines | The "beacon" frame did not show the beam: replaced by the dusk lodge, where the waiting call's amber beam is in frame |
| 18 Identity | Emblem and share card | Both were tagged in-game captures; they are shipped assets |
| 19 Checklist | Rules, retired list | Retired-font note said the game never loaded Inter (it did, before #9); Archivo added; empty half now holds the review procedure |
| 20 Sources | Commands and figures | Nothing to fix |

## Compared against the live game

The captures were taken from a production build of `main` at 78eecc9 (the deployed commit) served
locally, at 1440 x 900 and on a 390 x 844 phone at 2x, under SwiftShader. Colour values were read
from that commit's code. The PDF was compared by eye against those frames and the live site's title
screen.

## Open items (not changed here)

- `.mrow.sel` in `src/ui/style.css` (the selected call on the mission table) uses #2F3D4B, the one
  interface colour that is not a token. It is not edition 1's #141C24, so the guard allows it; it
  should become a token or `--slate-2`.
- The emblem's patch keeps its dark ground (#141C24/#1D2731 inside `public/icons/`). Page 18 treats
  it as the patch's own colours; recolouring the emblem would be a separate brand decision.
- Captures come from SwiftShader (software WebGL): no MSAA, softer than a phone's GPU. Rebuild with
  `capture.mjs` on a GPU machine for sharper frames; the layout does not change.
- Nils is shown crouched (his mission pose) in the lineup.
