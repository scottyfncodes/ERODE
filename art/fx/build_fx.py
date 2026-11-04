"""Pack the FXCraft flipbooks into the game's one particle atlas (public/fx/kessel-fx.png).

Inputs: gitcraft-out/fx/<name>/fx-<name>_flipbook.png from studiocraft fxcraft_flipbook (see
art/fx/README.md for the calls). Each is 4x4 frames of 64 px; the atlas is 512 px, one quadrant per
effect, frames left to right, top to bottom:

  top left     puff     (the smoke simulation, centred and rounded: powder spray, downwash, the cloud)
  top right    powder   (the dust burst, centred: a landing, a fall, Koda's paws)
  bottom left  blast    (the explosion, recoloured to the palette: no black, darks lift to granite)
  bottom right fire     (the fire loop, for the hearth)

The particle shader reads a frame by the particle's age, so every frame is centred on the point.
Run with the GITCRAFT studio venv (numpy + Pillow): python3 art/fx/build_fx.py
"""

import json
import pathlib

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "gitcraft-out" / "fx"
PAL = json.loads((ROOT / "art" / "rockslide-palette.json").read_text())
F = 64


def hexrgb(h):
    return np.array([int(h[i : i + 2], 16) for i in (1, 3, 5)], dtype=np.float32) / 255


def frames(name):
    im = np.asarray(Image.open(SRC / name / f"fx-{name}_flipbook.png").convert("RGBA"), dtype=np.float32) / 255
    return [im[r * F : (r + 1) * F, c * F : (c + 1) * F] for r in range(4) for c in range(4)]


yy, xx = np.mgrid[0:F, 0:F]
R = np.hypot(xx + 0.5 - F / 2, yy + 0.5 - F / 2) / (F / 2)


def soft_disc(edge=0.95):
    return np.clip((edge - R) / 0.45, 0, 1) ** 1.5


def centre(fr, fill=0.8):
    """Move a frame's content to the middle, scaled so its larger side is `fill` of the frame."""
    a = fr[..., 3]
    ys, xs = np.nonzero(a > 0.04)
    if len(xs) == 0:
        return fr
    crop = Image.fromarray((fr[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1] * 255).astype(np.uint8))
    s = fill * F / max(crop.size)
    crop = crop.resize((max(1, round(crop.size[0] * s)), max(1, round(crop.size[1] * s))), Image.LANCZOS)
    out = Image.new("RGBA", (F, F))
    out.paste(crop, ((F - crop.size[0]) // 2, (F - crop.size[1]) // 2))
    return np.asarray(out, dtype=np.float32) / 255


def puff(fr, i):
    # the smoke's billows as the texture of a round puff that loosens as it ages
    a = fr[..., 3] / max(1e-3, fr[..., 3].max())
    shape = soft_disc(0.98 - 0.08 * (i / 15))
    out = np.zeros_like(fr)
    out[..., :3] = 1
    out[..., 3] = np.clip(shape * (0.55 + 0.45 * a), 0, 1)
    return out


def ramp(stops, t):
    t = np.clip(t, 0, 1)
    xs = [s[0] for s in stops]
    return np.stack([np.interp(t, xs, [s[1][k] for s in stops]) for k in range(3)], -1)


BLAST = [
    (0.0, hexrgb(PAL["Granite Dark"])),
    (0.35, hexrgb(PAL["Granite Light"])),
    (0.6, hexrgb(PAL["Kessel Snow"])),
    (0.8, hexrgb(PAL["Lamp Glow"])),
    (1.0, np.array([1.0, 0.97, 0.9])),
]


def blast(fr):
    out = fr.copy()
    lum = fr[..., :3] @ np.array([0.3, 0.59, 0.11], dtype=np.float32)
    out[..., :3] = ramp(BLAST, lum)
    out[..., 3] = fr[..., 3] * soft_disc(1.0)
    return out


def sheet(fs):
    s = np.zeros((4 * F, 4 * F, 4), dtype=np.float32)
    for i, fr in enumerate(fs):
        r, c = divmod(i, 4)
        s[r * F : (r + 1) * F, c * F : (c + 1) * F] = fr
    return s


def main():
    quads = [
        sheet([puff(fr, i) for i, fr in enumerate(frames("smoke"))]),
        sheet([centre(fr, 0.85) * np.dstack([np.ones((F, F, 3)), soft_disc(1.0)]) for fr in frames("powder")]),
        sheet([blast(fr) for fr in frames("blast")]),
        sheet([fr * np.dstack([np.ones((F, F, 3)), soft_disc(1.05)]) for fr in frames("fire")]),
    ]
    atlas = np.zeros((512, 512, 4), dtype=np.float32)
    for q, s in enumerate(quads):
        atlas[(q // 2) * 256 : (q // 2 + 1) * 256, (q % 2) * 256 : (q % 2 + 1) * 256] = s
    img = Image.fromarray((np.clip(atlas, 0, 1) * 255).astype(np.uint8))
    out = ROOT / "public" / "fx" / "kessel-fx.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, optimize=True)
    # preview on the lodge's aubergine and on snow
    bg = Image.new("RGBA", (1024, 512), PAL["Aubergine"])
    bg.paste(Image.new("RGBA", (512, 512), PAL["Kessel Snow"]), (512, 0))
    bg.alpha_composite(img, (0, 0))
    bg.alpha_composite(img, (512, 0))
    (SRC / "atlas_preview.png").parent.mkdir(parents=True, exist_ok=True)
    bg.convert("RGB").save(SRC / "atlas_preview.png")
    print(out, out.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
