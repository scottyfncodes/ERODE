# Art bible edition 2: what changed

Edition 2 (`art/kessel-art-bible.pdf`, 20 pages) replaces edition 1 (3 pages: an emblem, a palette
and a ten-piece kit contact sheet on dark slate). It was rebuilt from the game as it ships, not edited
from edition 1.

## Retired references

| Edition 1 said or showed | Today | Where it is now stated |
| --- | --- | --- |
| Slate ink pages and "slate instrument housings" (#141C24, #1D2731), muted #9FB0BF, paper #F1ECE1 | Aubergine and burgundy card stock, cream paper (`src/ui/style.css :root`) | Pages 4, 7, 19 |
| Inter Display, Inter, JetBrains Mono | Jost, Courier Prime, IBM Plex Mono (Archivo and Inter belonged to earlier versions of the game) | Page 6, 19 |
| "Flat palette colour, lit like a clear winter morning" | A hard warm sun, a cold blue skylight, aerial perspective, the lens grade | Pages 3, 15, 16 |
| A palette of 26 storybook roles as the colours | Those roles are the paints; `grade()` turns them into the rendered colours | Page 5 |
| Pole orange #FF7A1A as an interface accent | Survives only as the snow-pole tip's picked colour (renders #D38851) | Pages 5, 17, 19 |
| The kit sheet as the direction | The kit is in the game; the direction is the two layers | Pages 3, 19 |

Also out of date and corrected in this change: `art/README.md`'s "storybook valley" section
(a raspberry lodge, a pastel Hollin, the plum print), the header comment in `src/ui/style.css`
("slate instrument housings") and `public/manifest.webmanifest`, which still gave the installed app
#141C24 as its theme and splash colour (now `--slate` #4A2330 and the page background #2A1C26).

## New standards

- **Two layers**: a storybook interface over a Colorado high-country world; never mixed (page 3).
- **Colour from code**: interface values are the CSS tokens; world values are `grade()` outputs;
  light (sky, sun, beacon) is ungraded. `tokens.json` is generated, never typed (pages 4, 5).
- **Three faces, three jobs** with sizes and tracking from the stylesheet; 12 px minimum on phones,
  44 px touch targets (page 6).
- **Card treatments**: 8 radius panels with a 1 px cream rule and a soft deep shadow, 44 px chips,
  paper, red and ghost buttons, the double-ruled chapter frame, the lens grade (page 7).
- **Character continuity**: Vince's honey-blonde curls, red shell, green scarf; Koda's flopped left
  ear; one strong jacket colour per villager; the shared skeletons (pages 11, 12).
- **Lighting reference**: one camera at 06:40, 12:00, 18:40, 21:30 and in four weathers (15, 16).
- **Picture tags**: in-game capture, staged in engine, illustrative, generated, shipped asset,
  retired (page 2).
- **Checklist and review procedure** for any new asset, screen or document (page 19).

## Guards

`tests/art-direction.test.ts` runs in `npm test` and CI:

- the stylesheet's `:root` must equal the bible's interface tokens;
- every kit colour's `grade()` output must equal the bible's world colours;
- the bible, its layout, captures, fonts list and QA record must be in the repository;
- nothing that ships (`src/`, `index.html`, the web manifest) may use #141C24, #1D2731, #F1ECE1,
  #9FB0BF, Inter, Inter Display, JetBrains Mono or Archivo;
- `index.html` loads exactly Jost, Courier Prime and IBM Plex Mono; the theme colour is `--slate`.

`CLAUDE.md` at the repository root points future Claude Code sessions at the bible.
