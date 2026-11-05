"""ROCKSLIDE: the Kessel art bible, edition 2.1. Laid out in GITCRAFT DesignCraft from captures of the
running game and colour tokens read from the game's own code. Reproducible end to end:

  npm ci && npx vite build && (npx vite preview --port 4173 &)
  node art/bible/capture.mjs                     # in-game captures -> gitcraft-out/bible/shots/*.png
  npx tsx art/bible/tokens.ts > art/bible/tokens.json
  python3 art/bible/build_bible.py               # captures -> art/bible/captures/*.jpg, layout, PDF

Outputs: art/kessel-art-bible.pdf (the bible), art/bible/kessel-art-bible.designcraft (the editable
layout; open it next to a "Document Fonts" folder holding the fonts in art/bible/fonts.json),
gitcraft-out/bible/pages/*.png (every page rendered, for review). The build fails on a missing or
substituted font, overset text or a missing capture.
"""
import hashlib, json, os, shutil, sys, urllib.request
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "../.."))
sys.path.insert(0, HERE)
from dc import DC  # noqa: E402

SHOTS = os.path.join(REPO, "gitcraft-out/bible/shots")
CAPS = os.path.join(HERE, "captures")
WORK = os.path.join(REPO, "gitcraft-out/bible")
FONTDIR = os.path.join(WORK, "Document Fonts")
DOC = os.path.join(WORK, "kessel-art-bible.designcraft")
PDF = os.path.join(REPO, "art/kessel-art-bible.pdf")
TOKENS = json.load(open(os.path.join(HERE, "tokens.json")))
UI = TOKENS["ui"]
WORLD = {k: v["rendered"] for k, v in TOKENS["world"].items()}
WORLD.update({k: v["rendered"] for k, v in TOKENS["extra"].items()})
UNLIT = TOKENS["unlit"]

W, H, M = 1200, 800, 56
PAGES = 20
# the interface tokens (src/ui/style.css :root)
INK, BURG, BURG2 = "#3A2632", "#4A2330", "#5C2F3D"
PAPER, PAPER2, CREAM, MUTED = "#F6ECDC", "#ECDCC6", "#FBF3E6", "#E0BFB6"
RED, AMBER, CYAN, GREEN, PINK, POWDER = "#D4422F", "#E0B042", "#A9D6EA", "#9CD1B0", "#E7AAA6", "#A9C8E0"
BTN = "#7B2F3B"  # button text, burgundy
J, C, P = "Jost", "Courier Prime", "IBM Plex Mono"
RETIRED = ["#141C24", "#1D2731", "#F1ECE1", "#FF7A1A", "#9FB0BF"]


# ---------------------------------------------------------------- inputs
def fonts():
    os.makedirs(FONTDIR, exist_ok=True)
    spec = json.load(open(os.path.join(HERE, "fonts.json")))["fonts"]
    for name, f in spec.items():
        path = os.path.join(FONTDIR, name)
        if not os.path.exists(path) or hashlib.sha256(open(path, "rb").read()).hexdigest() != f["sha256"]:
            b = urllib.request.urlopen(f["url"]).read()
            if hashlib.sha256(b).hexdigest() != f["sha256"]:
                raise SystemExit(f"{name}: downloaded file does not match its pinned sha256")
            open(path, "wb").write(b)
    print("fonts ok:", ", ".join(spec))


def captures():
    """PNG shots -> JPEG captures kept in the repo (the PDF is rebuilt from these)."""
    os.makedirs(CAPS, exist_ok=True)
    if os.path.isdir(SHOTS):
        meta = json.load(open(os.path.join(SHOTS, "shots.json")))
        for s in meta["shots"]:
            src = os.path.join(SHOTS, s["name"] + ".png")
            Image.open(src).convert("RGB").save(os.path.join(CAPS, s["name"] + ".jpg"), quality=86, optimize=True, progressive=True)
        json.dump(meta, open(os.path.join(CAPS, "shots.json"), "w"), indent=1)
    meta = json.load(open(os.path.join(CAPS, "shots.json")))
    # derived crops, all from captures: the in-game wordmark and the emblem without its square field
    title = Image.open(os.path.join(CAPS, "ui-title.jpg"))
    # crops of captures (recorded in shots.json under "derived"): the wordmark and the forecast strip
    derived = {"ui-title-wordmark": ("ui-title", (440, 540, 1000, 740)), "ui-forecast": ("ui-board", (728, 222, 1165, 334))}
    for name, (src, box) in derived.items():
        Image.open(os.path.join(CAPS, src + ".jpg")).crop(box).save(os.path.join(CAPS, name + ".jpg"), quality=90)
    meta["derived"] = {k: {"from": v[0], "crop": v[1]} for k, v in derived.items()}
    json.dump(meta, open(os.path.join(CAPS, "shots.json"), "w"), indent=1)
    emb = Image.open(os.path.join(REPO, "public/icons/icon-512.png")).convert("RGBA")
    c, r = 256, 208
    m = Image.new("L", (2048, 2048), 0)
    ImageDraw.Draw(m).ellipse([(c - r) * 4, (c - r) * 4, (c + r) * 4, (c + r) * 4], fill=255)
    emb.putalpha(m.resize((512, 512), Image.LANCZOS))
    emb.crop((c - r, c - r, c + r, c + r)).save(os.path.join(WORK, "emblem-round.png"))
    return {s["name"]: s for s in meta["shots"]}, title.size


def cap(name):
    p = os.path.join(CAPS, name + ".jpg")
    if not os.path.exists(p):
        raise SystemExit(f"missing capture {name}")
    return p


# ---------------------------------------------------------------- page kit
d = None


def chrome(sp, n, section, source, dark=False):
    ink = MUTED if dark else BTN
    d.text(sp, [M, 26, 600, 38], "ROCKSLIDE  ·  KESSEL ART BIBLE  ·  EDITION 2.1", J, "SemiBold", 7.5, ink, tracking=300)
    d.text(sp, [W - M - 300, 26, W - M, 38], f"{section}   {n:02d} / {PAGES}", J, "SemiBold", 7.5, ink, tracking=300, align="right")
    d.rect(sp, [M, 42, W - M, 42.75], fill=MUTED if not dark else "#6A4552")
    if source:
        d.text(sp, [M, H - 30, W - M, H - 20], "SOURCE  " + source, P, "Medium", 6.5, ink, tracking=40)


def head(sp, kicker, title, deck, dark=False, width=780):
    d.text(sp, [M, 62, 1000, 74], kicker, J, "Medium", 9.5, PINK if dark else BTN, tracking=420)
    d.text(sp, [M, 80, 1100, 116], title, J, "SemiBold", 28, CREAM if dark else INK, tracking=140)
    d.rect(sp, [M, 124, M + 46, 125.5], fill=CREAM if dark else INK)
    if deck:
        d.text(sp, [M, 136, M + width, 176], deck, C, "Regular", 12.5, CREAM if dark else INK, leading=17)


def h3(sp, x, y, w, s, color=BTN):
    d.text(sp, [x, y, x + w, y + 12], s, J, "SemiBold", 8.5, color, tracking=220)


def body(sp, r, s, size=10.5, color=INK, leading=None, font=J, style="Regular", space=5):
    return d.text(sp, r, s, font, style, size, color, leading=leading or size * 1.42, space_after=space)


TAGS = {
    "capture": ("IN-GAME CAPTURE · APPROVED", GREEN, INK),
    "staged": ("STAGED IN ENGINE · APPROVED", POWDER, INK),
    "illustrative": ("ILLUSTRATIVE · NOT A CAPTURE", PAPER2, INK),
    "generated": ("GENERATED FROM THE GAME'S CODE", AMBER, INK),
    "retired": ("RETIRED · DO NOT USE", RED, CREAM),
    "asset": ("SHIPPED ASSET · APPROVED", GREEN, INK),
}


def tag(sp, x, y, kind):
    label, bg, fg = TAGS[kind]
    w = len(label) * 4.6 + 12
    d.rect(sp, [x, y, x + w, y + 12], fill=bg, stroke=INK if kind == "illustrative" else None, weight=0.5, radius=2)
    d.text(sp, [x + 6, y + 3, x + w, y + 11], label, J, "SemiBold", 6, fg, tracking=160)
    return x + w


def figure(sp, r, shot, kind, caption, align=4, dark=False, dx=0, dy=0):
    i = d.image(sp, r, cap(shot), align=align, stroke=MUTED if dark else INK, weight=0.5)
    if dx or dy:
        d.shift_content(i, dx, dy)
    e = tag(sp, r[0], r[3] + 6, kind)
    if r[2] - e < 200:  # narrow figure: the caption goes under the tag, full width
        d.text(sp, [r[0], r[3] + 22, r[2], r[3] + 44], caption, P, "Medium", 6.8, MUTED if dark else INK, leading=9)
    else:
        d.text(sp, [e + 7, r[3] + 7.5, r[2], r[3] + 28], caption, P, "Medium", 6.8, MUTED if dark else INK, leading=9)
    return i


def swatch(sp, x, y, w, h, hexcol, name, meta, light=None):
    d.rect(sp, [x, y, x + w, y + h], fill=hexcol, stroke=INK if light else None, weight=0.5, radius=3)
    d.text(sp, [x, y + h + 5, x + w + 20, y + h + 16], name, J, "SemiBold", 8, INK, tracking=120)
    d.text(sp, [x, y + h + 17, x + w + 14, y + h + 54], meta, P, "Medium", 6.8, BTN, leading=9)


def bullets(sp, r, items, size=10, color=INK, gap=4):
    return d.text(sp, r, "\n".join("·  " + s for s in items), J, "Regular", size, color, leading=size * 1.42, space_after=gap)


# ---------------------------------------------------------------- pages
def p_cover(sp):
    d.rect(sp, [0, 0, W, H], fill=INK)
    hero = d.image(sp, [430, 0, W, H], cap("env-lodge-dusk"), align=4)
    d.shift_content(hero, 90, 0)
    d.gradient(sp, [428, 0, 800, H], [{"location": 0, "color": INK, "opacity": 100}, {"location": 40, "color": INK, "opacity": 78}, {"location": 100, "color": INK, "opacity": 0}])
    d.rect(sp, [20, 20, W - 20, H - 20], stroke=CREAM, weight=1.5)
    d.tool("place_image", {"path": os.path.join(WORK, "emblem-round.png"), "x": 72, "y": 76, "width": 96, "spread": sp})
    d.text(sp, [72, 214, 1000, 226], "THE KESSEL PATROL  ·  ART BIBLE  ·  EDITION 2.1", J, "Medium", 10, PINK, tracking=420)
    d.text(sp, [66, 236, 900, 330], "ROCKSLIDE", J, "SemiBold", 86, CREAM, tracking=110, leading=90)
    d.text(sp, [72, 334, 800, 360], "MOUNTAIN PATROL", J, "Medium", 20, PINK, tracking=520)
    d.rect(sp, [72, 386, 118, 387.5], fill=CREAM)
    d.text(sp, [72, 402, 520, 520], "Storybook card stock over a working Colorado mountain. The canonical visual reference for the game as it ships today: interface, colour, type, characters, places, light and the rules for anything new.", C, "Regular", 14, CREAM, leading=20)
    d.text(sp, [72, 690, 700, 702], "NOVEMBER 2026  ·  SUPERSEDES EDITION 1 (THE DARK-SLATE KIT SHEET)", J, "SemiBold", 8, AMBER, tracking=260)
    d.text(sp, [72, 708, 700, 730], "Every picture in this book is a frame of the running game unless it is tagged otherwise.", P, "Medium", 7.5, MUTED)


def p_howto(sp):
    chrome(sp, 2, "HOW TO USE THIS BOOK", "art/bible/build_bible.py · art/bible/capture.mjs · art/bible/tokens.json")
    head(sp, "BEFORE YOU MAKE ANYTHING", "How to use this book", "One valley, two layers. Read the layer you are working in, check the values, and when this book and the game disagree, the game wins and this book gets rebuilt.")
    x2 = 640
    h3(sp, M, 210, 500, "WHAT IS CANONICAL, IN ORDER")
    d.text(sp, [M, 230, 560, 420], "\n".join([
        "1.  The running game: rockslide-game.vercel.app. It is the source of truth.",
        "2.  This book: every capture is a frame of that game; every colour value is read from its code by art/bible/tokens.ts.",
        "3.  art/README.md and the comments in src/: how things are built. Where their wording differs from this book, follow this book and fix them.",
        "Edition 1 of this book (dark slate, Inter and JetBrains Mono, a ten-piece kit sheet) is retired. It no longer describes the game.",
    ]), J, "Regular", 10.5, INK, leading=15, space_after=7)
    h3(sp, M, 440, 500, "THE TWO LAYERS")
    body(sp, [M, 460, 560, 600], "The interface is storybook card stock: aubergine and burgundy cards, cream paper, tracked Jost capitals, Courier Prime for anything spoken. The world is a working Colorado mountain in winter: cobalt sky, cold granite, weathered timber, dark standing-seam roofs, tomato-red patrol kit. The interface never takes on the world's grit, and the world never takes on the interface's pastels.", size=10.5)
    h3(sp, M, 610, 500, "USING IT FOR REVIEW")
    body(sp, [M, 630, 560, 740], "DesignCraft, PixelCraft and Claude Code reviews check new work against pages 4 to 7 (colour, type, shapes), 8 to 10 (interface), 11 and 12 (people) and 13 to 17 (places, light, markers). Page 19 is the checklist for new assets, and lists what must not come back.", size=10.5)
    h3(sp, x2, 210, 480, "HOW PICTURES ARE TAGGED")
    y = 232
    for k, desc in [
        ("capture", "A frame of the running game, untouched. The approved reference."),
        ("staged", "The game's own models and renderer, arranged for the camera (a lineup, a close-up distance). Approved."),
        ("illustrative", "Drawn for this book in DesignCraft: specimens, swatches, diagrams. Explains a rule; is not the game."),
        ("generated", "Values read from the game's source by a script. Approved."),
        ("asset", "A file the game ships (the emblem, the share card), shown as it is."),
        ("retired", "Shown only so it can be recognised and kept out."),
    ]:
        tag(sp, x2, y, k)
        body(sp, [x2 + 190, y - 1, W - M, y + 30], desc, size=9.5)
        y += 36
    h3(sp, x2, 462, 480, "CONTENTS")
    toc = [("01", "Cover"), ("02", "How to use this book"), ("03", "Two layers, one valley"), ("04", "Colour: the interface"), ("05", "Colour: the world, as it renders"),
           ("06", "Typography"), ("07", "Shapes, borders and treatments"), ("08", "Interface: title and mission table"), ("09", "Interface: the HUD"), ("10", "Interface: calls, map and progression"),
           ("11", "Vince"), ("12", "Koda and the people of Hollin"), ("13", "The patrol station"), ("14", "The valley"), ("15", "Light through the day"), ("16", "Weather and air"),
           ("17", "Markers, wayfinding and machines"), ("18", "The emblem and the share card"), ("19", "New assets: checklist and retired references"), ("20", "Sources and how to rebuild")]
    col = [toc[:10], toc[10:]]
    for ci, items in enumerate(col):
        d.text(sp, [x2 + ci * 250, 482, x2 + ci * 250 + 240, 750], "\n".join(f"{a}   {b}" for a, b in items), J, "Regular", 9.5, INK, leading=13.5, space_after=4)


def p_direction(sp):
    chrome(sp, 3, "DIRECTION", "git history: #17 storybook direction, #33 Colorado high country (the world), #35 modernization · src/render/kit.ts grade()")
    head(sp, "DIRECTION", "Two layers, one valley", "The patrol's paperwork is storybook; the mountain is real. That contrast is the look: a warm, hand-made interface laid over cold, honest weather.")
    cw = (W - 2 * M - 40) / 2
    for i, (k, t, shot, kind, cap_, pts) in enumerate([
        ("THE INTERFACE", "Storybook card stock", "ui-board", "capture", "ui-board · the mission table: burgundy card, cream rules, tracked Jost, a paper topo map",
         ["Aubergine and burgundy cards with a thin cream rule; cream paper for maps and primary buttons.",
          "Tracked Jost capitals for titles and labels; Courier Prime for the radio and anything said aloud.",
          "Colour only where it means something: red is the patrol and emergencies, mustard is caution, cyan is navigation and on, mint is done.",
          "Chapter cards in a soft family tone with a double ink frame."]),
        ("THE WORLD", "A working Colorado mountain", "env-air-hollin", "staged", "env-air-hollin · Hollin from the air at 11:00: the row, the chapel, spruce stands, granite (helicopter hidden)",
         ["Faceted, low-poly forms with flat Lambert shading; clear silhouettes at phone size.",
          "Every material passes once through grade(): weathered paint, darks lifted to cold near-neutral (never black), greens toward olive.",
          "Cobalt zenith over a pale horizon, a hard warm sun, cold blue shadows, aerial perspective that pools in the valley.",
          "Patrol kit stays tomato red with a cream cross; orange-tipped poles mark every road."]),
    ]):
        x = M + i * (cw + 40)
        h3(sp, x, 196, cw, k)
        d.text(sp, [x, 210, x + cw, 232], t, J, "SemiBold", 16, INK, tracking=60)
        figure(sp, [x, 240, x + cw, 240 + cw * 0.6], shot, kind, cap_, align=1 if shot == "ui-board" else 4)
        bullets(sp, [x, 590, x + cw, 722], pts, size=10, gap=5)
    d.rect(sp, [M, 728, W - M, 752], fill=PAPER2, radius=3)
    d.text(sp, [M + 12, 735, W - M - 12, 748], "NEVER:  dark slate housings (#141C24)  ·  Inter, Inter Display, JetBrains Mono  ·  pure black  ·  neon or toy-bright colour in the world  ·  pastels on the mountain", J, "SemiBold", 7.5, BTN, tracking=160)


def p_colour_ui(sp):
    chrome(sp, 4, "COLOUR", "src/ui/style.css :root (read by art/bible/tokens.ts) · chapter tones: .chapter.tone-* in the same file")
    head(sp, "COLOUR  ·  THE INTERFACE", "Card stock, paper and signal", "The interface palette, exactly as the game's stylesheet defines it. Names are the CSS custom properties; use the property, never a copied hex.")
    tag(sp, W - M - 186, 66, "generated")
    rows = [
        [("--ink", UI["ink"], "Aubergine. Ink on paper; the deepest card."), ("--slate", UI["slate"], "Burgundy card stock: panels, chips, the theme colour."),
         ("--slate-2", UI["slate-2"], "Raised controls on a card."), ("--paper", UI["paper"], "Cream paper: maps, primary buttons, tabs on."),
         ("--paper-2", UI["paper-2"], "Paper in shade; the button's lip."), ("--text", UI["text"], "Text on card stock."), ("--muted", UI["muted"], "Labels and secondary text on card.")],
        [("--red", UI["red"], "The patrol and emergencies; the act button in an emergency."), ("--amber", UI["amber"], "Caution; who is speaking on the radio."),
         ("--cyan", UI["cyan"], "Navigation; a chip that is on."), ("--green", UI["green"], "Done; good news."), ("--pink", UI["pink"], "Blush: the default chapter tone."),
         ("--powder", UI["powder"], "Powder blue: recon."), ("button text", BTN, "Burgundy on paper buttons and the act button.")],
    ]
    sw, sh, gx = 128, 58, 22
    for ri, row in enumerate(rows):
        for ci, (nm, hx, meta) in enumerate(row):
            x = M + ci * (sw + gx)
            y = 200 + ri * 150
            swatch(sp, x, y, sw, sh, hx, nm, hx.upper() + "  ·  " + meta, light=hx.upper() in ("#F6ECDC", "#FBF3E6", "#ECDCC6"))
    h3(sp, M, 512, 600, "CHAPTER TONES  ·  ONE PER MISSION FAMILY (.chapter.tone-*)")
    tones = [("Default", "#E7AAA6", "blush, 90%"), ("Recon", "#A9C8E0", "powder, 92%"), ("Avalanche", "#E0B042", "mustard, 90%"), ("Rescue", "#9CC9B3", "mint, 92%"), ("Community", "#B7A9D1", "lavender, 92%")]
    for i, (n, hx, o) in enumerate(tones):
        x = M + i * 150
        d.rect(sp, [x, 532, x + 136, 590], fill=hx, radius=3)
        d.rect(sp, [x + 10, 541, x + 126, 581], stroke=BURG, weight=1)
        d.text(sp, [x + 10, 553, x + 126, 570], n.upper(), J, "SemiBold", 9, BURG, tracking=200, align="center")
        d.text(sp, [x, 596, x + 140, 606], f"{hx}  ·  {o}", P, "Medium", 6.8, BTN)
    h3(sp, 830, 512, 320, "RULES")
    bullets(sp, [830, 530, W - M, 740], [
        "Cards are --slate on a dimmed scene (rgba 42, 22, 32 at 55%); never an opaque full-screen colour except a chapter card.",
        "Text on card is --text; secondary is --muted. Text on paper is --ink or the burgundy button colour.",
        "Signal colours carry meaning and nothing else. A decorative red or cyan is a bug.",
        "Chapter tones are the only pastels at full screen, and only for a moment.",
    ], size=9.5)


def p_colour_world(sp):
    chrome(sp, 5, "COLOUR", "src/render/kit.ts PAL through grade() · src/render/rig.ts sky · src/render/worldView.ts poles · src/render/markers.ts beacon")
    head(sp, "COLOUR  ·  THE WORLD", "The mountain, as it renders", "World colours are picked in src/render/kit.ts and pass once through grade(), the high-country grade. These are the values that reach the screen (before light), not the values typed in.")
    tag(sp, W - M - 186, 66, "generated")
    groups = [
        ("SNOW", [("snow", "Snow"), ("snowShade", "Snow in shade"), ("roofSnow", "Snow on roofs")]),
        ("ROCK AND STONE", [("stone", "Granite"), ("stoneDark", "Granite, dark")]),
        ("TIMBER", [("log", "Logs"), ("logDark", "Logs, dark"), ("logLight", "Logs, light"), ("wood", "Planks")]),
        ("ROOFS AND STEEL", [("roof", "Standing seam"), ("metal", "Galvanised"), ("dark", "Painted steel")]),
        ("THE PATROL", [("red", "Patrol red"), ("white", "Cross cream"), ("yellow", "Caution yellow"), ("brass", "Brass")]),
        ("HOLLIN'S ROW", [("blush", "Barn red"), ("powder", "Slate blue"), ("mustard", "Ochre"), ("mint", "Sage"), ("lavender", "Weathered grey"), ("burgundy", "Oxblood")]),
        ("FOREST AND PEOPLE", [("green", "Forest-service green"), ("trousers", "Soft-shell"), ("pack", "Pack"), ("window", "Lamp-lit window")]),
        ("THE WAY", [("poleShaft", "Pole shaft"), ("poleTip", "Pole tip")]),
    ]
    x, y = M, 198
    sw, sh = 70, 34
    for gname, items in groups:
        need = len(items) * (sw + 12)
        if x + need > W - M + 4:
            x, y = M, y + 110
        h3(sp, x, y, need, gname)
        for i, (k, label) in enumerate(items):
            xx = x + i * (sw + 12)
            d.rect(sp, [xx, y + 16, xx + sw, y + 16 + sh], fill=WORLD[k], radius=2, stroke=INK if WORLD[k] in ("#E7EBF0", "#E8ECF0", "#E2DFD9") else None, weight=0.5)
            d.text(sp, [xx, y + 55, xx + sw + 10, y + 65], label, J, "SemiBold", 7.2, INK, tracking=60)
            d.text(sp, [xx, y + 66, xx + sw + 10, y + 86], WORLD[k] + "\n" + k, P, "Medium", 6.3, BTN, leading=8)
        x += need + 24
    figure(sp, [900, 312, W - M, 312 + 152], "env-yard", "capture", "env-yard · the grade at work: weathered timber, forest-service green, cold snow")
    # beyond the grade
    y2 = 548
    h3(sp, M, y2, 520, "NOT GRADED: LIGHT, SKY AND MARKERS")
    sky = TOKENS["sky"]
    specials = [("Zenith, day", sky["zenith"][1]), ("Zenith, golden", sky["zenith"][2]), ("Horizon, day", sky["horizon"][1]), ("Horizon, golden", sky["horizon"][2]),
                ("Zenith, night", sky["zenith"][0]), ("Sun, day", sky["sun"][1]), ("Sun, golden", sky["sun"][2]), ("Skylight, day", "#9FBBE6"), ("Beacon: active call", UNLIT["beaconActive"]), ("Beacon: waiting call", UNLIT["beaconWaiting"])]
    for i, (label, hx) in enumerate(specials):
        xx = M + i * 66
        d.rect(sp, [xx, y2 + 16, xx + 58, y2 + 44], fill=hx, radius=2)
        d.text(sp, [xx, y2 + 49, xx + 62, y2 + 70], label, J, "SemiBold", 6.6, INK, leading=8)
        d.text(sp, [xx, y2 + 70, xx + 62, y2 + 80], hx, P, "Medium", 6.3, BTN)
    h3(sp, 740, y2, 400, "THE GRADE, IN ONE BREATH")
    bullets(sp, [740, y2 + 16, W - M, 750], [
        "Lightness is compressed into 0.10 to 0.96: no black, no blown white.",
        "Saturation caps at 0.68; pale, chalky colours lose the most (x0.7).",
        "Near-blacks lean to a cold slate blue. Greens lean olive.",
        "Old storybook paints are repainted first: mint boards become forest-service green, raspberry becomes oxblood, teal becomes spruce.",
        "Sky, sun, skylight and the mission beacon are light, not paint: they are not graded.",
    ], size=9)


def p_type(sp, title_size):
    chrome(sp, 6, "TYPOGRAPHY", "src/ui/style.css (--sans, --type, --mono; .wordmark, .label, .btn, .radio, .chapter) · index.html Google Fonts · art/bible/fonts.json")
    head(sp, "TYPOGRAPHY", "Three faces, each with one job", "Jost speaks for the patrol, Courier Prime for people on the radio, IBM Plex Mono for instruments. Nothing else is set in the game or its materials.")
    cw = (W - 2 * M - 48) / 3
    cols = [
        ("JOST", "Geometric sans: titles, labels, buttons, the wordmark", J, "SemiBold", "MOUNTAIN PATROL", "Medium", 0.42,
         ["Wordmark: Bold 700, tracking 0.16em, cut across in two (see below)", "Panel titles: SemiBold 600 caps, 15 px, 0.22em", "Labels: SemiBold 600 caps, 12 px, 0.16em, --muted", "Buttons: SemiBold 600 caps, 13 px, 0.12em", "Chapter title: SemiBold 600 caps, 24 to 40 px, 0.16em"],
         "Jost 4.x (Google Fonts v20), SIL OFL 1.1. Weights 400 to 700."),
        ("COURIER PRIME", "Typewriter: the radio, chapter sub-lines, anything said", C, "Regular", "Kessel Patrol, it's Greta at the Kettle.", "Regular", 0,
         ["Radio subtitles: 13.5 px (12 px on phones), line height 1.35", "The speaker's name above it is Jost SemiBold caps in --amber", "Chapter sub-line: 13 px under a 46 px rule", "Sentence case. Never in capitals, never tracked"],
         "Courier Prime (Google Fonts v11), SIL OFL 1.1. 400, 400 italic, 700."),
        ("IBM PLEX MONO", "Readouts: altitude, numbers, stats, coordinates", P, "Medium", "ALT 2,412 m   -7 °C   WIND 18", "Medium", 0.04,
         ["Altitude and small readouts: 12 px, --muted", "Map coordinates and debug readouts", "Tabular, never for prose or titles", "Medium 500 and SemiBold 600 only"],
         "IBM Plex Mono (Google Fonts v20), SIL OFL 1.1. 500, 600."),
    ]
    for i, (name, role, fam, sty, sample, sty2, tr, rules, src) in enumerate(cols):
        x = M + i * (cw + 24)
        d.rect(sp, [x, 196, x + cw, 386], fill=BURG, radius=8, stroke=PAPER, weight=0.8)
        d.text(sp, [x + 18, 212, x + cw - 18, 224], name, J, "SemiBold", 8.5, MUTED, tracking=260)
        d.text(sp, [x + 18, 234, x + cw - 18, 300], "Aa" if fam != P else "0123", fam, sty, 52, CREAM, leading=58)
        d.text(sp, [x + 18, 304, x + cw - 18, 340], sample, fam, sty2, 15 if fam == J else 13, CREAM, tracking=int(tr * 1000), leading=19)
        d.text(sp, [x + 18, 350, x + cw - 18, 376], role, fam if fam != J else J, "Regular" if fam != P else "Medium", 8.5, MUTED, leading=11)
        bullets(sp, [x, 400, x + cw, 540], rules, size=9.2, gap=3)
        d.text(sp, [x, 545, x + cw, 566], src, P, "Medium", 6.6, BTN, leading=8.5)
    # the wordmark, from the game
    h3(sp, M, 588, 500, "THE WORDMARK, AS THE GAME SETS IT")
    i = d.image(sp, [M, 606, M + 392, 606 + 392 / 2.8], cap("ui-title-wordmark"), align=4, stroke=INK, weight=0.5)
    tag(sp, M, 606 + 392 / 2.8 + 6, "capture")
    d.text(sp, [M + 140, 606 + 392 / 2.8 + 7.5, M + 476, 606 + 392 / 2.8 + 18], "ui-title, cropped: emblem, cut wordmark, MOUNTAIN PATROL", P, "Medium", 6.8, INK)
    bullets(sp, [M + 420, 606, W - M, 742], [
        "Jost Bold, tracking 0.16em, in --paper. Two copies of the word, clipped along a line that falls from 58% to 38% of its height, the lower half nudged 0.06em right and 0.05em down: a rockslide in the letters.",
        "Above it, the Kessel Patrol emblem, clipped to its rim. Below it, MOUNTAIN PATROL in Jost Medium, widely tracked, in --pink.",
        "In a layout that cannot cut the word (a PDF, a share card), set ROCKSLIDE in Jost SemiBold or Bold with 0.11 to 0.16em tracking and leave the cut to the game.",
        "Minimum sizes: 12 px for any text on a phone (PLAYCRAFT legibility rule), 44 px touch targets for anything you press.",
    ], size=9.2, gap=4)
    return i


def p_shapes(sp):
    chrome(sp, 7, "SHAPES AND TREATMENTS", "src/ui/style.css: .panel, .chip, .btn, .tab, .act, .chapter .frame, #grade · drawn here in DesignCraft from those values")
    head(sp, "SHAPES, BORDERS AND TREATMENTS", "Card stock, cut and ruled", "Soft corners, one thin cream rule, a deep soft shadow. Specimens below are drawn from the stylesheet's own numbers; the frames at right are the game.")
    tag(sp, M, 186, "illustrative")
    # a panel specimen
    d.rect(sp, [M, 206, 560, 486], fill="#8C7A76", radius=0)  # dimmed scene stand-in
    d.text(sp, [M + 8, 210, 400, 220], "SCENE DIMMED: rgba(42, 22, 32, .55)", P, "Medium", 6.2, CREAM)
    pid = d.rect(sp, [M + 40, 228, 520, 452], fill=BURG, stroke="#E8DDD0", weight=1, radius=8)
    d.x("object.dropShadow", {"on": True, "distance": 12, "angle": 90, "size": 28, "opacity": 0.4, "ids": [pid]})
    d.text(sp, [M + 40, 244, 520, 260], "MISSION TABLE", J, "SemiBold", 11, CREAM, tracking=220, align="center")
    d.rect(sp, [M + 41, 270, 519, 270.6], fill="#7A5A63")
    d.rect(sp, [480, 238, 506, 264], fill=BURG2, stroke="#7A5A63", weight=1, radius=7)
    d.text(sp, [480, 245, 506, 258], "×", J, "Medium", 12, CREAM, align="center")
    for k, (lbl, on) in enumerate([("Calls and forecast", True), ("Build the station", False), ("Patrol log", False)]):
        tx = M + 58 + [0, 112, 222][k]
        d.rect(sp, [tx, 282, tx + [104, 102, 72][k], 304], fill=PAPER if on else None, stroke=PAPER if on else "#7A5A63", weight=1, radius=6)
        d.text(sp, [tx, 289, tx + [104, 102, 72][k], 300], lbl, J, "Bold", 8, INK if on else MUTED, tracking=0, align="center")
    d.rect(sp, [M + 58, 320, 300, 348], fill=PAPER, radius=4)
    d.text(sp, [M + 58, 330, 300, 342], "CONTINUE", J, "SemiBold", 8.5, BTN, tracking=120, align="center")
    d.rect(sp, [310, 320, 420, 348], fill=RED, radius=4)
    d.text(sp, [310, 330, 420, 342], "TAKE THIS CALL", J, "SemiBold", 8.5, "#FFFFFF", tracking=120, align="center")
    d.rect(sp, [430, 320, 500, 348], stroke="#7A5A63", weight=1, radius=4)
    d.text(sp, [430, 330, 500, 342], "LATER", J, "SemiBold", 8.5, CREAM, tracking=120, align="center")
    for k, (lbl, on) in enumerate([("MAP", False), ("KODA: STAY", True), ("SKIS ON", False)]):
        cx = M + 58 + k * 92
        d.rect(sp, [cx, 366, cx + 82, 396], fill=BURG, stroke=CYAN if on else "#E8DDD0", weight=1, radius=4)
        d.text(sp, [cx, 377, cx + 82, 389], lbl, J, "SemiBold", 8, CYAN if on else CREAM, tracking=80, align="center")
    a = d.rect(sp, [400, 360, 462, 422], fill=PAPER, stroke="#B08A8E", weight=1, shape="ellipse")
    d.text(sp, [400, 386, 462, 398], "REPAIR", J, "SemiBold", 7.5, BTN, tracking=60, align="center")
    d.x("object.dropShadow", {"on": True, "distance": 3, "angle": 90, "size": 0, "opacity": 1, "color": d.swatch("#CBB79C"), "ids": [a]})
    d.text(sp, [M + 8, 458, 552, 484], "Panel 8 radius, 1 px cream rule at 45%, shadow 0 20 50 black 40%. Tabs 34 tall, 8 radius. Buttons 44 tall, 6 radius: paper, red, ghost. Chips 44, 6 radius, burgundy 90%, cyan when on. Act button 86 round, paper with a burgundy inner ring and a 4 px lip.", P, "Medium", 6.4, MUTED, leading=8.5)
    # chapter frame specimen
    d.rect(sp, [M, 494, 560, 700], fill="#E7AAA6", radius=0)
    d.rect(sp, [M + 120, 520, 440, 668], stroke=BURG, weight=1.5)
    d.rect(sp, [M + 113, 513, 447, 675], stroke="#A7737A", weight=1)
    d.text(sp, [M + 120, 546, 440, 558], "CHAPTER TWO", J, "Medium", 9, BURG, tracking=420, align="center")
    d.text(sp, [M + 120, 568, 440, 596], "EYES ON KESSEL BOWL", J, "SemiBold", 17, BURG, tracking=160, align="center")
    d.rect(sp, [277, 606, 323, 607.5], fill=BURG)
    d.text(sp, [M + 120, 618, 440, 640], "Recon · called in by the avalanche service", C, "Regular", 10, BURG, align="center")
    d.text(sp, [M, 706, 560, 730], "Chapter frame: 1.5 px ink rule at 70% with a 1 px outline at 35%, 5 px outside it; kicker 0.42em, title 0.16em, a 46 x 1.5 rule, Courier Prime sub-line.", P, "Medium", 6.4, INK, leading=8.5)
    # real frames
    x0 = 600
    figure(sp, [x0, 206, W - M, 206 + (W - M - x0) * 0.42], "ui-chapter", "capture", "ui-chapter · a call accepted: the chapter card in its family tone")
    h3(sp, x0, 480, 520, "THE LENS: ONE GRADE OVER THE 3D VIEW (#grade)")
    bullets(sp, [x0, 498, W - M, 640], [
        "A cold, slight vignette (radial, to rgba 14, 22, 38 at 30%) and a cool-sky, warm-snow split, multiplied over the frame by the browser: no extra render pass.",
        "Fine film grain at 9% (an SVG noise tile, overlay).",
        "At night and in storms the lens closes in (#grade.dim).",
        "It sits under the interface: cards and type are never graded.",
    ], size=9.2, gap=4)
    h3(sp, x0, 650, 520, "SHAPE LANGUAGE IN THE WORLD")
    body(sp, [x0, 668, W - M, 750], "Faceted primitives: icosahedron gems for people and Koda, eight-sided cylinders, boxes, cones for spruce tiers. Flat shading so every face reads as a cut plane. No bevels, no smooth plastic, no outlines; silhouettes carry the read.", size=9.2)


def p_ui_title(sp):
    chrome(sp, 8, "INTERFACE", "capture.mjs: ui-title, ui-board, ui-board-station, phone-title, phone-board · src/ui/panels.ts board()")
    head(sp, "INTERFACE  ·  1", "Title and the mission table", "The title is a symmetrical, one-point view of the lodge front; the emblem, the cut wordmark, a few lines of copy and one red button sit in the lower third. The mission table is the day's plan on card stock.")
    lw, ph = 400, 120
    figure(sp, [M, 196, M + lw, 196 + lw * 0.625], "ui-title", "capture", "ui-title · 1440 x 900 · first launch")
    figure(sp, [M + lw + 16, 196, M + 2 * lw + 16, 196 + lw * 0.625], "ui-board", "capture", "ui-board · calls, the forecast in four periods, avalanche danger")
    figure(sp, [M + 2 * lw + 32, 196, M + 2 * lw + 32 + ph, 196 + ph * 2.164], "phone-title", "capture", "phone-title · 390 x 844")
    figure(sp, [W - M - ph, 196, W - M, 196 + ph * 2.164], "phone-board", "capture", "phone-board · 390 x 844")
    figure(sp, [M, 500, M + 360, 500 + 360 * 0.625], "ui-board-station", "capture", "ui-board-station · building the station")
    x2 = M + 390
    h3(sp, x2, 500, W - M - x2, "WHAT MAKES IT")
    bullets(sp, [x2, 518, W - M, 750], [
        "Title: the camera square on to the lodge door, Vince and Koda either side of it, a slow push in and out. In the lower third: the emblem, the cut wordmark, MOUNTAIN PATROL in blush, two or three lines of Jost, one red button (Start your patrol, or Continue).",
        "The table: one burgundy card on the dimmed lodge. Centred title in tracked caps; sentence-case tabs, paper when selected; a paper topo map; the forecast as four periods (sky, temperature, wind); avalanche danger as a mustard number and its name; the next rank above the forecast as one line and a thin mustard bar; the calls as cards, locked ones as dashed open cards with quiet text (never faded below 4.5:1 contrast); the selected call's brief on paper with a red Take this call and a ghost Free patrol.",
        "On a phone the card is one column that fits the width inside the safe area; nothing shrinks below 12 px; every target, the tabs included, is 44 px. Every card button lifts under a mouse, sinks when pressed and shows a 2 px cyan focus ring.",
    ], size=9.5, gap=5)


def p_ui_hud(sp):
    chrome(sp, 9, "INTERFACE", "capture.mjs: ui-hud-foot, ui-hud-sled, ui-hud-heli, phone-hud · src/ui/hud.ts · src/ui/style.css .hud, .act, .chip, .radio")
    head(sp, "INTERFACE  ·  2", "The HUD: as little as possible", "A floating stick under the left thumb, look anywhere on the right, one big act button, a few chips. The radio speaks in a single line of Courier Prime.")
    fw = 400
    figure(sp, [M, 196, M + fw, 196 + fw * 0.625], "ui-hud-foot", "capture", "ui-hud-foot · on foot, a dispatch line on the radio")
    figure(sp, [M + fw + 16, 196, M + 2 * fw + 16, 196 + fw * 0.625], "ui-hud-sled", "capture", "ui-hud-sled · on the snowmobile")
    figure(sp, [M, 196 + fw * 0.625 + 40, M + fw, 196 + fw * 0.625 * 2 + 40], "ui-hud-heli", "capture", "ui-hud-heli · the helicopter over Kessel Bowl")
    figure(sp, [W - M - 180, 196, W - M, 196 + 180 * 2.164], "phone-hud", "capture", "phone-hud · iPhone-sized, upright")
    x2 = M + fw + 16
    y2 = 196 + fw * 0.625 + 40
    h3(sp, x2, y2, fw, "THE RULES OF THE HUD")
    bullets(sp, [x2, y2 + 18, x2 + fw, 760], [
        "One act button, bottom right: paper, burgundy type, 86 px; red in an emergency. Hold to work (repairs, charges, first aid): a ring fills. Under a mouse it brightens and rises a pixel off its rim.",
        "Chips: 44 px, burgundy at 90%, a cream rule; cyan when on. Map, Koda, Skis on, Get off.",
        "Top: a slim compass ribbon naming the objective and its distance; top right the clock and temperature, the danger number, funds and pause, in Plex Mono.",
        "The radio sits centred above the controls; toasts centred near the top in tracked caps (mint good, mustard warning). No minimap, no health bars: poles, beacons and the route line carry the rest.",
    ], size=9.2, gap=4)


def p_ui_missions(sp):
    chrome(sp, 10, "INTERFACE", "capture.mjs: ui-hud-mission, ui-map, ui-wardrobe, ui-pause · src/ui/panels.ts map(), outfit(), pause()")
    head(sp, "INTERFACE  ·  3", "Calls, the map and progression", "A call opens with a chapter card, puts a beacon over the objective and, if the player wants it, a dotted line on the snow. Progress is spent at the station.")
    fw = (W - 2 * M - 32) / 3
    for i, (s, c_) in enumerate([("ui-hud-mission", "ui-hud-mission · during a call: the objective line and the route line assist"), ("ui-map", "ui-map · the valley map on paper"), ("ui-pause", "ui-pause · settings and the assists, all off by default")]):
        figure(sp, [M + i * (fw + 16), 196, M + i * (fw + 16) + fw, 196 + fw * 0.625], s, "capture", c_)
    figure(sp, [M, 470, M + fw, 470 + fw * 0.625], "ui-wardrobe", "capture", "ui-wardrobe · gear, bought with funds and unlocked by rank")
    x2 = M + fw + 16
    h3(sp, x2, 470, 700, "PROGRESSION, AS THE PLAYER SEES IT")
    bullets(sp, [x2, 488, W - M, 760], [
        "Funds and reputation after every job; reputation is the patrol rank. A rank up gets the stinger and a line on the debrief card.",
        "The station grows in the yard: kennel, workshop, equipment room, hangar, radio mast, the bunkhouse wing, yard lights. Each is a real building, not a menu icon.",
        "Gear for Vince, the sled, the helicopter, the skis and Koda: colours and kit in the same card layout, the price in the button.",
        "After the story Kessel Bowl reloads with new snow: a recon call and a control call share one pin, and a reward that depends on the result reads 'up to'. The next rank is always on the mission table.",
        "The map is a paper topo sheet on an 8 px card, pinch to zoom, paper zoom buttons on the 4 px grid; calls are pinned on it in their family tones.",
        "Every one of these is a card on the dimmed scene. No full-screen menus, no store front.",
    ], size=9.4, gap=5)


def p_vince(sp):
    chrome(sp, 11, "PEOPLE", "src/game/game.ts (VINCE_HAIR) · src/render/characterMesh.ts · art/3d/scripts/patrol_people.py (rs_patroller) · src/render/gait.ts")
    head(sp, "PEOPLE  ·  VINCE", "Vince, the newest hand", "Twenty, long honey-blonde hair with a bit of a curl, the patrol red shell. Cheerful and a little green: he walks like someone who has not yet learned to hurry on snow.")
    fw = 250
    figure(sp, [M, 196, M + fw, 196 + fw * 1.25], "env-vince-front", "staged", "env-vince-front · close camera", dx=0)
    figure(sp, [M + fw + 14, 196, M + 2 * fw + 14, 196 + fw * 1.25], "env-vince-three", "staged", "env-vince-three · three-quarter")
    figure(sp, [M + 2 * fw + 28, 196, M + 3 * fw + 28, 196 + fw * 1.25], "env-vince-back", "staged", "env-vince-back · the pack and scarf")
    x2 = M + 3 * fw + 52
    h3(sp, x2, 196, W - M - x2, "THE SPEC")
    E = WORLD
    rows = [("Hair", f"Honey blonde ({E['vinceHair']}), shoulder length: a ring of faceted curls at the nape, locks over the ears, a fringe under the hat band. Always out from under the hat"),
            ("Jacket", f"Patrol red shell ({E['jacketRed']}) with charcoal trim ({E['jacketTrim']}) at the yoke, cuffs and pack straps; a cream cross on the chest"),
            ("Scarf", f"Forest-service green ({WORLD['green']}), knitted, two tails on springs"),
            ("Hat", f"Charcoal wool beanie ({E['beanie']}) with a mustard band and pom-pom ({E['beanieBand']}); amber goggles ({E['goggles']}) pushed up on it"),
            ("Below", f"Soft-shell trousers ({WORLD['trousers']}), gaiters, worn boots, charcoal mitts"),
            ("Pack", f"Patrol pack with the cross; the old wooden tourers ({E['skisWood']}) ride on it"),
            ("Build", "Faceted and jointed: pelvis, two-piece spine, neck, shoulders, elbows, hips, knees, ankles; 25 bones in rs_patroller"),
            ("Face", "Dark round eyes with a highlight, brows, a small nose, pink blush, a smile; he blinks")]
    y = 216
    for k, v in rows:
        d.text(sp, [x2, y, x2 + 60, y + 11], k.upper(), J, "SemiBold", 7.5, BTN, tracking=160)
        f = d.text(sp, [x2 + 62, y, W - M, y + 40], v, J, "Regular", 8.8, INK, leading=11.5)
        y += 40 if len(v) > 70 else 28
    h3(sp, M, 562, 700, "HOW HE MOVES, AND WHAT MUST STAY TRUE")
    cw = (W - 2 * M - 30) / 2
    bullets(sp, [M, 580, M + cw, 760], [
        "Feet are placed by a two-bone leg solver and stay planted; strides lengthen and the bob changes from walk (inverted pendulum) to run (spring).",
        "Hips sway over the planted foot and counter-turn the shoulders; arms swing with the opposite foot; the body banks into turns and leans into slopes.",
        "Loose things (scarf tails, pom-pom, pack) wobble on underdamped springs. Snow dusts whatever faces the sky.",
    ], size=9.2, gap=4)
    bullets(sp, [M + cw + 30, 580, W - M, 760], [
        "Always: the honey-blonde curls out from under the hat, the red shell, the green scarf. Those three read him at 40 px tall; the wardrobe may change the jacket and hat, never the hair.",
        "Never: a different hair colour or length for Vince, a hood over the hair, a smooth (unfaceted) figure, outlines. Reference and marketing images show the default outfit (patrol red, charcoal beanie).",
        "New gear fits the same joints and pivots, and is painted in palette roles through grade().",
    ], size=9.2, gap=4)


def p_koda(sp):
    chrome(sp, 12, "PEOPLE", "src/render/huskyMesh.ts · art/3d/scripts/patrol_people.py (rs_koda, rs_villager) · src/render/missionProps.ts (Greta, Nils, the van driver)")
    head(sp, "PEOPLE  ·  KODA AND HOLLIN", "Koda, and the people you help", "Koda is a grey-and-white husky with one ear that has never once stood up. The villagers share Vince's skeleton but wear their own knitted cardigans.")
    figure(sp, [M, 196, M + 420, 196 + 420 * 0.625], "env-koda", "staged", "env-koda · close camera, Koda at Vince's side")
    figure(sp, [M + 436, 196, W - M, 196 + 420 * 0.625], "env-cast", "staged", "env-cast · lineup staged in engine: the game's own villager models moved into one frame")
    y = 196 + 420 * 0.625 + 44
    cw = 420
    h3(sp, M, y, cw, "KODA: THE SPEC")
    rows = [("Coat", "Grey #6A737E saddle and mask over white #ECEAE5, dark #4A5059 points"), ("Ears", "Right ear stands tall; the left flops over. Always the left."),
            ("Eyes", "Pale ice blue #9FC9DD with dark pupils; open and shut eyes for blinking"), ("Face", "Jaw, tongue, a pink inner ear; tongue and ears flop on springs"),
            ("Tail", "Four segments that wag in a wave"), ("Gear", f"Red collar ({WORLD['kodaCollar']}) with a mustard tag; the patrol harness, saddle pack and bandanas from the kennel")]
    yy = y + 18
    for k, v in rows:
        d.text(sp, [M, yy, M + 56, yy + 11], k.upper(), J, "SemiBold", 7.5, BTN, tracking=160)
        d.text(sp, [M + 58, yy, M + cw, yy + 24], v, J, "Regular", 8.8, INK, leading=11.5)
        yy += 26
    x2 = M + 436
    h3(sp, x2, y, W - M - x2, "THE PEOPLE OF HOLLIN")
    ppl = [("Greta Holm", "The Kettle's landlady. Green cardigan #497952 with cream trim, a mustard bobble hat. Calls about firewood and Pepper the cat."),
           ("Nils", "The Tannberg skier who gets lost. Blue #3C88BE with yellow trim, a helmet and goggles, red skis."),
           ("The van driver", "Orange #D18547 with dark trim and a dark beanie; stuck in the drift by his van on the valley road.")]
    yy = y + 18
    for n, v in ppl:
        d.text(sp, [x2, yy, x2 + 120, yy + 11], n.upper(), J, "SemiBold", 7.5, BTN, tracking=160)
        d.text(sp, [x2 + 124, yy, W - M, yy + 30], v, J, "Regular", 8.8, INK, leading=11.5)
        yy += 34
    bullets(sp, [x2, yy + 6, W - M, 760], [
        "Villagers: a knitted cardigan with a Fair Isle yoke, a button band, ribbed cuffs, elbow patches, fur-cuffed boots. No shell, no patrol gear.",
        "Every person is faceted like Vince and carries the same snow dusting. Each has one strong jacket colour so they read across a slope.",
    ], size=8.8, gap=3)


def p_station(sp):
    chrome(sp, 13, "PLACES", "capture.mjs: env-lodge-day, env-yard, env-lodge-inside, env-pad · art/3d/scripts/valley_buildings.py (rs_lodge) · src/world/station.ts")
    head(sp, "PLACES  ·  HOME", "The patrol station", "A 16 by 12 m log lodge with notched corners, a lean-to porch and a stone chimney, in a yard that grows as the patrol does. Walk in and the roof lifts away.")
    figure(sp, [M, 196, 700, 196 + 644 * 0.5], "env-lodge-day", "capture", "env-lodge-day · the lodge front at 12:00, interface hidden")
    fw = (W - M - 716)
    figure(sp, [716, 196, W - M, 196 + fw * 0.55], "env-lodge-inside", "capture", "env-lodge-inside · the dollhouse cut-away: hearth, table, bunk, Koda's bed")
    figure(sp, [716, 196 + fw * 0.55 + 40, W - M, 196 + fw * 1.1 + 40], "env-yard", "capture", "env-yard · the yard at 09:00: garage, kennel, poles")
    figure(sp, [M, 560, M + 300, 560 + 300 * 0.5], "env-pad", "capture", "env-pad · the helipad and hangar")
    bullets(sp, [M + 320, 560, 700, 760], [
        "Logs weathered grey-brown (#886C5C), end grain showing at the corners; dark standing-seam roof under a thick snow load.",
        "Shuttered windows that glow warm (#DFC8A6) from dusk; a lantern by the door that swings.",
        "The yard: garage, kennel, equipment room, hangar, radio mast; signs, lights, the flag and the beacon stay simple.",
        "Inside: hearth, mission table, bunk, wardrobe, armchair, books, Koda's bed, a hanging lamp.",
    ], size=9, gap=4)


def p_valley(sp):
    chrome(sp, 14, "PLACES", "capture.mjs: env-air-hollin, env-air-tannberg, env-hollin, env-air-bowl, env-air-lake · src/world/places.ts · art/3d/scripts/working_mountain.py")
    head(sp, "PLACES  ·  THE VALLEY", "Kessel valley, two kilometres of it", "Hollin's working row, the Tannberg ski area, Kessel Bowl above the pass road, the Grauhorn weather station, Mirror Lake. Every road lined with orange-tipped poles.")
    big = (W - 2 * M - 16) / 2
    figure(sp, [M, 196, M + big, 196 + big * 0.5], "env-air-hollin", "staged", "env-air-hollin · Hollin from the air: the row, the chapel and its onion dome (helicopter hidden)")
    figure(sp, [M + big + 16, 196, W - M, 196 + big * 0.5], "env-air-tannberg", "staged", "env-air-tannberg · the Tannberg: base lodge, the chairlift, the run (helicopter hidden)")
    y = 196 + big * 0.5 + 40
    sm = (W - 2 * M - 32) / 3
    for i, (s, k_, c_) in enumerate([("env-hollin", "capture", "env-hollin · on the ground in Hollin: the Kettle"), ("env-air-bowl", "staged", "env-air-bowl · the open track of the Kessel Bowl avalanche path, fences on the ridge"), ("env-air-lake", "staged", "env-air-lake · Mirror Lake, frozen")]):
        figure(sp, [M + i * (sm + 16), y, M + i * (sm + 16) + sm, y + sm * 0.45], s, k_, c_)
    y2 = y + sm * 0.45 + 42
    bullets(sp, [M, y2, W / 2 - 20, 760], [
        "The ground knows what it is: packed (roads, pistes, yards), powder, wind crust on the steeps, lake ice.",
        "Exposed granite from about 30 degrees and on wind-scoured crests, snow clinging in streaks down the fall line.",
    ], size=9, gap=3)
    bullets(sp, [W / 2, y2, W - M, 760], [
        "A real avalanche operation: snow fences, remote exploders on Kessel Ridge, warning signs where the road crosses the runout, an old silver-mine headframe.",
        "Engelmann blue-green spruce in stands, snow-capped on the broad lower tiers; the eroded range rising 2 to 5 km out.",
    ], size=9, gap=3)


def p_light(sp):
    chrome(sp, 15, "LIGHT", "capture.mjs: env-lodge-dawn, -day, -dusk, -night (one camera, four times) · src/render/rig.ts (sky, sun, hemisphere, fog)")
    head(sp, "LIGHT", "Light through the day", "06:00 to 22:00 in about twenty minutes. One camera on the lodge front, four times of day: these frames are the reference for any lighting change.")
    fw = (W - 2 * M - 3 * 14) / 4
    for i, (s, t, c_) in enumerate([("env-lodge-dawn", "06:40  DAWN", "low sun, long blue shadows, windows still lit"),
                                     ("env-lodge-day", "12:00  DAY", "hard sun, bright snow, short blue shadows"),
                                     ("env-lodge-dusk", "18:40  DUSK", "cooling light, windows lit, the evening snow begins"),
                                     ("env-lodge-night", "21:30  NIGHT", "deep blue, lamp light, the lens closes in")]):
        x = M + i * (fw + 14)
        d.text(sp, [x, 196, x + fw, 208], t, J, "SemiBold", 8.5, BTN, tracking=240)
        figure(sp, [x, 214, x + fw, 214 + fw * 1.0], s, "capture", f"{s} · {c_}", align=4)
    y = 214 + fw + 58
    h3(sp, M, y, 500, "THE SKY RAMP (src/render/rig.ts)")
    sky = TOKENS["sky"]
    for r_, (nm, vals) in enumerate([("ZENITH", sky["zenith"]), ("HORIZON", sky["horizon"]), ("SUN", sky["sun"])]):
        yy = y + 18 + r_ * 30
        d.text(sp, [M, yy + 6, M + 70, yy + 16], nm, J, "SemiBold", 7.5, INK, tracking=160)
        d.gradient(sp, [M + 74, yy, M + 330, yy + 22], [{"location": 0, "color": vals[0]}, {"location": 50, "color": vals[1]}, {"location": 100, "color": vals[1]}])
        d.rect(sp, [M + 340, yy, M + 380, yy + 22], fill=vals[2], radius=2)
        d.text(sp, [M + 390, yy + 6, M + 650, yy + 16], f"night {vals[0]} · day {vals[1]} · golden {vals[2]}", P, "Medium", 6.5, BTN)
    d.text(sp, [M + 74, y + 110, M + 600, y + 120], "night  ->  day; golden-hour tint at right (blended in at the ends of the day)", P, "Medium", 6.3, INK)
    bullets(sp, [720, y, W - M, 760], [
        "A hard, warm sun against a low, cold blue skylight: form reads, shadows are blue, never grey.",
        "Exposure is held down so snow keeps its shape. Nothing in the world reaches pure white.",
        "Aerial perspective, not fog: distance glows warm toward the sun and cold away, pools in the valley, thins with altitude.",
        "Lamps and windows come on at dusk; the hearth's fire is a particle flipbook. The amber column in every frame is the beacon of a call waiting at the lodge.",
    ], size=9.2, gap=4)


def p_weather(sp):
    chrome(sp, 16, "WEATHER", "capture.mjs: env-lodge-day, env-overcast, env-snow, env-storm (day 30 forecast) · src/world/weather.ts · src/render/atmosphere.ts")
    head(sp, "WEATHER AND AIR", "Clear, overcast, snow, storm", "The forecast has four periods a day and blends between them. Snow thickens the air and fills tracks in; a storm grounds the helicopter and closes the lens.")
    fw = (W - 2 * M - 3 * 14) / 4
    for i, (s, t, c_) in enumerate([("env-lodge-day", "CLEAR", "day 1, 12:00"), ("env-overcast", "OVERCAST", "day 1, 15:30"),
                                     ("env-snow", "SNOW", "day 30, 08:00 (forecast: snow)"), ("env-storm", "STORM", "day 30, 12:00 (forecast: storm)")]):
        x = M + i * (fw + 14)
        d.text(sp, [x, 196, x + fw, 208], t, J, "SemiBold", 8.5, BTN, tracking=240)
        figure(sp, [x, 214, x + fw, 214 + fw * 1.0], s, "capture", f"{s} · {c_}")
    y = 214 + fw + 40
    cw = (W - 2 * M - 30) / 2
    bullets(sp, [M, y, M + cw, 760], [
        "Wind is visible: grains and wisps stream past at boot height, spindrift tears off the summits, the camera breathes more on an exposed day.",
        "Snowfall is particles that thicken with the forecast; tracks from boots, the sled and skis fill in faster while it falls.",
        "Sky values per state (weather.ts): cloud 0.05 / 0.7 / 0.85 / 1, fog 0 / 0.25 / 0.5 / 1 for clear, overcast, snow, storm.",
    ], size=9.2, gap=4)
    bullets(sp, [M + cw + 30, y, W - M, 760], [
        "Effects: powder puff, powder burst, the charge blast and the hearth fire share one flipbook atlas (public/fx/kessel-fx.png).",
        "The avalanche itself: a slab released from the start zone under the cornice, a powder cloud, debris that settles into the runout.",
        "Weather never changes the interface's colours; only the lens grade (#grade.dim) responds.",
    ], size=9.2, gap=4)
    h3(sp, M, 612, 500, "THE FORECAST, AS THE PLAYER READS IT")
    figure(sp, [M, 630, M + 360, 630 + 360 / 3.86], "ui-forecast", "capture", "ui-board, cropped: the four periods with sky, temperature and wind")


def p_markers(sp):
    chrome(sp, 17, "WAYFINDING", "capture.mjs: env-lodge-dusk, env-ops-sign, ui-hud-mission, env-sled, env-heli · src/render/markers.ts · src/render/worldView.ts snow poles")
    head(sp, "MARKERS, WAYFINDING AND MACHINES", "How the world shows the way", "Information lives in the world: poles you can follow in a whiteout, a beam of light over where you are needed, the patrol's machines in patrol red.")
    fw = (W - 2 * M - 32) / 3
    figure(sp, [M, 196, M + fw, 196 + fw * 0.625], "env-lodge-dusk", "capture", "env-lodge-dusk · a call waiting: the amber beam over the lodge (cyan once accepted)")
    figure(sp, [M + fw + 16, 196, M + 2 * fw + 16, 196 + fw * 0.625], "env-ops-sign", "capture", "env-ops-sign · AVALANCHE AREA where the road crosses the runout")
    figure(sp, [M + 2 * fw + 32, 196, W - M, 196 + fw * 0.625], "ui-hud-mission", "capture", "ui-hud-mission · the route line on the snow and the cyan beacon of an accepted call")
    y = 196 + fw * 0.625 + 40
    figure(sp, [M, y, M + fw, y + fw * 0.625], "env-sled", "staged", "env-sled · the snowmobile, Koda on the rack (close camera)")
    figure(sp, [M + fw + 16, y, M + 2 * fw + 16, y + fw * 0.625], "env-heli", "capture", "env-heli · the rescue helicopter in flight")
    x3 = M + 2 * fw + 32
    bullets(sp, [x3, y, W - M, 760], [
        f"Snow poles: dark {WORLD['poleShaft']} shafts with an orange tip ({WORLD['poleTip']}, picked as #FF7A1A), along every road and track, about 1.6 m tall.",
        "Beacon: a soft vertical beam and a ground ring. Amber #F2C230 for a call waiting, cyan #5AD1FF for the active objective. Additive, never graded.",
        "Route line (assist): dotted along the roads to the objective, on the snow, not on the screen.",
        "Machines: the snowmobile and helicopter carry the patrol red and cream cross; the helicopter is SKYTRACE's.",
    ], size=9, gap=4)


def p_emblem(sp):
    chrome(sp, 18, "IDENTITY", "public/icons/icon.svg (VectorCraft) · public/og-image.jpg (DesignCraft, art/pipeline/4_share_card.py)")
    head(sp, "IDENTITY", "The emblem and the share card", "The Kessel Patrol patch is the one mark. It is a patch, so it keeps its own colours wherever it goes; the share card shows how it sits on card stock.")
    d.rect(sp, [M, 196, 420, 560], fill=INK, radius=8)
    d.tool("place_image", {"path": os.path.join(WORK, "emblem-round.png"), "x": M + 62, "y": 236, "width": 240, "spread": sp})
    tag(sp, M, 566, "asset")
    d.text(sp, [M + 136, 567.5, 420, 578], "public/icons/icon-512.png, clipped to its rim", P, "Medium", 6.8, INK)
    figure(sp, [440, 196, W - M, 196 + (W - M - 440) * 0.525], "share-card", "asset", "public/og-image.jpg · 1200 x 630 · the link preview")
    bullets(sp, [M, 600, 560, 760], [
        "The patch: a white peak on a dark ground, a pole-orange inner ring, a cream rim, the red band with the cream cross. Shown clipped to its rim; never the square tile.",
        "Its dark ground is the patch's own: it is not a licence to use dark slate anywhere else.",
        "Minimum size 32 px (favicon). Do not recolour, outline, rotate or put type inside it.",
    ], size=9.2, gap=4)
    bullets(sp, [600, 600, W - M, 760], [
        "Share card: aubergine card stock, an inset 1.5 pt cream rule, the emblem, ROCKSLIDE in Jost SemiBold, MOUNTAIN PATROL in blush, Courier Prime copy, a mustard URL line, the lodge at dusk fading in from the right.",
        "Any new marketing image follows the same build: a real capture, a card-stock panel, the three faces.",
    ], size=9.2, gap=4)


def p_checklist(sp):
    chrome(sp, 19, "RULES", "this page is the review checklist for DesignCraft, PixelCraft and Claude Code work · tests/art-direction.test.ts guards the retired tokens")
    head(sp, "FOR ANYTHING NEW", "The checklist, and what must not come back", "Run a new asset, screen or document through these before it ships. Anything on the right is a regression, whatever else is good about it.")
    cw = 520
    h3(sp, M, 196, cw, "NEW WORK MUST")
    checks = [
        ("Layer", "Belong to one layer: storybook interface or high-country world. Never mix them."),
        ("Colour", "Interface: only the CSS tokens on page 4. World: palette roles picked in kit.ts and passed through grade() (page 5)."),
        ("Type", "Jost, Courier Prime or IBM Plex Mono, in the jobs on page 6. 12 px minimum on a phone."),
        ("Shape", "Cards: 8 radius, 1 px cream rule, the soft deep shadow. 44 px touch targets. World: faceted, flat shaded, no outlines."),
        ("People", "Fit the 25-bone patroller or 21-bone Koda skeleton at the code's pivots; Vince keeps his hair, shell and scarf."),
        ("Light", "Look right at 06:40, 12:00, 18:40 and 21:30 and in a storm (pages 15 and 16)."),
        ("Proof", "Be checked in the running game: a capture at 1440 x 900 and on a 390 x 844 phone."),
    ]
    y = 216
    for k, v in checks:
        d.rect(sp, [M, y + 1, M + 9, y + 10], stroke=INK, weight=0.8, radius=1.5)
        d.text(sp, [M + 18, y, M + 80, y + 11], k.upper(), J, "SemiBold", 7.5, BTN, tracking=160)
        d.text(sp, [M + 82, y, M + cw, y + 34], v, J, "Regular", 9.2, INK, leading=12)
        y += 38
    x2 = 620
    h3(sp, x2, 196, 520, "RETIRED IN EDITION 2")
    tag(sp, x2 + 150, 194, "retired")
    for i, hx in enumerate(RETIRED):
        d.rect(sp, [x2 + i * 64, 216, x2 + i * 64 + 56, 244], fill=hx, radius=2, stroke=INK if hx == "#F1ECE1" else None, weight=0.5)
        d.text(sp, [x2 + i * 64, 248, x2 + i * 64 + 62, 258], hx, P, "Medium", 6.5, BTN)
    d.text(sp, [x2, 262, W - M, 290], "Edition 1's slate ink #141C24 and #1D2731, paper #F1ECE1, orange #FF7A1A as an interface colour and muted #9FB0BF. (#FF7A1A survives only as the pole tip's picked colour, graded to #D38851, and in the emblem's ring.)", J, "Regular", 8.8, INK, leading=11.5)
    gone = [
        ("Dark slate instrument housings", "panels and cards in #141C24 / #1D2731"),
        ("Inter, Inter Display, JetBrains Mono, Archivo", "edition 1's faces and the pre-#17 game's; the game has set Jost since #17"),
        ("The plum print grade", "replaced by the lens grade in #33"),
        ("Raspberry lodge, pastel Hollin, teal spruce", "the storybook world; now oxblood, weathered timber and the barn-red row"),
        ("'Lit like a clear winter morning, flat palette colour'", "now: a hard sun, cold skylight, aerial perspective"),
        ("The ten-piece kit sheet as the art bible", "the kit is still in the game, but it is not the direction"),
        ("Pure black, pure white, neon", "grade() makes them impossible in the world; keep them out of the interface"),
    ]
    y = 304
    for a, b in gone:
        d.text(sp, [x2, y - 1, x2 + 14, y + 12], "×", J, "SemiBold", 10, RED)
        d.text(sp, [x2 + 16, y, W - M, y + 12], a, J, "SemiBold", 9, INK)
        d.text(sp, [x2 + 16, y + 13, W - M, y + 24], b, J, "Regular", 8.5, BTN)
        y += 34
    h3(sp, M, 500, cw, "HOW TO RUN A REVIEW")
    d.text(sp, [M, 518, M + cw, 680], "\n".join([
        "1.  Build the change and capture it the way this book does: node art/bible/capture.mjs (add a staged view if it needs one).",
        "2.  Put the frames beside the page that covers them; check colour, type, shape, people and light against it.",
        "3.  npx vitest run tests/art-direction.test.ts: tokens and rendered colours still match this book; nothing retired is back.",
        "4.  If the change is meant to move the look, rebuild this book in the same pull request.",
    ]), J, "Regular", 9.5, INK, leading=13, space_after=6)
    d.rect(sp, [M, 690, W - M, 750], fill=BURG, radius=8)
    d.text(sp, [M + 20, 704, W - M - 20, 740], "Found a difference between this book and the game? The game is right. Capture it, fix the book's source (art/bible/), rebuild, and say what changed in the pull request.", C, "Regular", 12, CREAM, leading=17)


def p_sources(sp, stats):
    d.rect(sp, [0, 0, W, H], fill=INK)
    d.rect(sp, [20, 20, W - 20, H - 20], stroke=CREAM, weight=1.5)
    chrome(sp, 20, "SOURCES", None, dark=True)
    head(sp, "HOW THIS BOOK IS MADE", "Sources and how to rebuild", "Nothing here is pasted by hand. Rebuild it whenever the game changes, and commit the captures, the layout and the PDF together.", dark=True)
    d.text(sp, [M, 200, 640, 520], "\n".join([
        "npm ci && npx vite build",
        "npx vite preview --port 4173 &",
        "node art/bible/capture.mjs",
        "npx tsx art/bible/tokens.ts > art/bible/tokens.json",
        "python3 art/bible/build_bible.py",
    ]), P, "Medium", 10.5, CREAM, leading=19, space_after=2)
    rows = [
        ("capture.mjs", "Playwright and the game's QA handle (window.patrol): every frame staged, the interface hidden for env shots. shots.json records each one."),
        ("tokens.ts", "Reads src/ui/style.css, src/render/kit.ts (through grade()) and src/render/rig.ts into tokens.json. Colour values in this book come only from there."),
        ("build_bible.py", "Drives GITCRAFT DesignCraft headless through GITCRAFT's guard and sandbox; fonts from fonts.json, pinned by SHA-256; fails on a missing font, overset text or a missing capture; exports this PDF and renders every page for review."),
        ("kessel-art-bible.designcraft", "The editable layout (art/bible/). Open it beside a Document Fonts folder holding the fonts in fonts.json."),
        ("QA.md", "The page-by-page review of this edition."),
    ]
    y = 320
    for k, v in rows:
        d.text(sp, [M, y, M + 200, y + 12], k, P, "SemiBold", 8.5, AMBER)
        d.text(sp, [M + 210, y, 700, y + 40], v, J, "Regular", 9.2, CREAM, leading=12.5)
        y += 46
    d.text(sp, [760, 200, W - M, 700], "\n".join([
        f"Pages: {PAGES}",
        f"Captures: {stats['captures']} ({stats['env']} interface hidden, {stats['ui']} with interface)",
        f"Fonts: {stats['fonts']} files, SIL OFL 1.1",
        f"DesignCraft commands: {stats['calls']}",
        f"Built: {stats['built']}",
        f"Game build: {stats['commit']}",
        "",
        "Fonts: Jost, Courier Prime, IBM Plex Mono (Google Fonts). Rock and snow relief in the captures: Poly Haven CC0 scans (CREDITS.md). Everything else in the game and in this book is made in this repository or with GITCRAFT.",
    ]), J, "Regular", 9.5, MUTED, leading=14, space_after=2)
    d.tool("place_image", {"path": os.path.join(WORK, "emblem-round.png"), "x": W - M - 64, "y": H - M - 84, "width": 64, "spread": sp})


# ---------------------------------------------------------------- build
def main():
    global d
    os.makedirs(WORK, exist_ok=True)
    fonts()
    shots, _ = captures()
    shutil.copy(os.path.join(REPO, "public/og-image.jpg"), os.path.join(CAPS, "share-card.jpg"))
    d = DC(REPO, os.path.join(WORK, "designcraft.log"))
    d.tool("new_document", {"width": W, "height": H, "pages": PAGES, "facingPages": False, "intent": "print", "margins": 0, "title": "ROCKSLIDE: the Kessel art bible, edition 2.1"})
    d.tool("save_document", {"path": DOC})
    r = d.tool("open_document", {"path": DOC})
    print("document fonts:", r.get("documentFonts"))
    for sp in range(PAGES):
        if sp not in (0, PAGES - 1):
            d.rect(sp, [0, 0, W, H], fill=PAPER)
    pages = [p_cover, p_howto, p_direction, p_colour_ui, p_colour_world, lambda sp: p_type(sp, 0), p_shapes, p_ui_title, p_ui_hud, p_ui_missions,
             p_vince, p_koda, p_station, p_valley, p_light, p_weather, p_markers, p_emblem, p_checklist]
    for sp, fn in enumerate(pages):
        fn(sp)
        print("page", sp + 1, "laid out")
    commit = os.popen(f"git -C {REPO} rev-parse --short HEAD").read().strip()
    import datetime
    stats = {"captures": len(shots), "env": sum(1 for s in shots.values() if s["kind"] == "env"), "ui": sum(1 for s in shots.values() if s["kind"] == "ui"),
             "fonts": len(json.load(open(os.path.join(HERE, "fonts.json")))["fonts"]), "calls": d.calls, "built": datetime.date.today().isoformat(), "commit": commit}
    p_sources(PAGES - 1, stats)
    # checks: every font exact, nothing overset
    bad = [f for f in d.x("font.list") if f["missing"] or f["matchStatus"] != "exact"]
    if bad:
        raise SystemExit(f"fonts not resolved exactly: {json.dumps(bad)[:600]}")
    doc = d.tool("inspect_document")
    over = [s for s in doc["stories"] if s.get("overset")]
    if over and "--draft" in sys.argv:
        print("DRAFT, overset:", json.dumps([(s['id'], s.get('preview')) for s in over])[:1500])
    elif over:
        raise SystemExit(f"overset text: {json.dumps([(s['id'], s.get('preview')) for s in over])[:1500]}")
    d.tool("save_document", {"path": DOC})
    r = d.x("file.exportPdf", {"path": PDF, "title": "ROCKSLIDE: the Kessel art bible, edition 2.1", "author": "The Kessel Patrol (ROCKSLIDE)", "compressImages": True})
    print("pdf:", r)
    os.makedirs(os.path.join(WORK, "pages"), exist_ok=True)
    for i in range(PAGES):
        d.tool("export_png", {"page": i, "path": os.path.join(WORK, "pages", f"page-{i + 1:02d}.png"), "scale": 1})
    shutil.copy(DOC, os.path.join(HERE, "kessel-art-bible.designcraft"))
    d.close()
    print(json.dumps(stats))


if __name__ == "__main__":
    main()
